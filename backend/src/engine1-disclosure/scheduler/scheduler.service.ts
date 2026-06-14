import { Injectable, Logger, Optional } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../../prisma/prisma.service';
import {
  DartApiService,
  DartDisclosureItem,
} from '../dart-api/dart-api.service';
import { ExpoPushService } from '../../expo-push/expo-push.service';
import { ExpoPushMessage } from 'expo-server-sdk';
import { DisclosureCollectionLog } from '@prisma/client';
import { DisclosureDocumentsService } from '../disclosure-documents/disclosure-documents.service';
import { KST_TIMEZONE, formatKstDateCompact } from '../../common/time/kst';
import { CronRunRecorderService } from '../../cron-health/cron-run-recorder.service';
import { CRON_JOB_KEYS } from '../../cron-health/cron-health.jobs';

@Injectable()
export class SchedulerService {
  private readonly logger = new Logger(SchedulerService.name);
  private isCollecting = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly dartApiService: DartApiService,
    private readonly expoPushService: ExpoPushService,
    /**
     * @Optional: DisclosureDocumentsModule이 등록되지 않은 환경(테스트 등)에서도
     * SchedulerService가 정상 동작하도록 Optional 처리
     */
    @Optional()
    private readonly disclosureDocumentsService?: DisclosureDocumentsService,
    /**
     * @Optional: CronHealthModule 미등록 환경(일부 테스트)에서도 동작.
     * 미주입 시 정리 본업은 그대로 수행하고 CronRunLog 기록만 생략(DAR-232).
     */
    @Optional()
    private readonly cronRunRecorder?: CronRunRecorderService,
  ) {}

  /**
   * 공시 수집 - 평일 08:00~18:00 10분 간격(KST)
   */
  @Cron('*/10 8-17 * * 1-5', { timeZone: KST_TIMEZONE })
  async collectDisclosures() {
    const today = this.formatDate(new Date());
    return this.collectByDate(today, today, 'CRON');
  }

  /**
   * 날짜 범위 지정 수집 (수동 트리거용)
   *
   * @param bgnDe - 수집 시작일 (YYYYMMDD)
   * @param endDe - 수집 종료일 (YYYYMMDD)
   * @param triggeredBy - 'CRON' | 'MANUAL' (기본값: 'MANUAL')
   * @param options.isBackfill - DAR-129: 과거 공시 백필 모드.
   *   true면 저장 행에 isBackfill=true 표식을 남기고, 사용자 알림(matchAndNotify)을
   *   ★건너뛴다(과거 공시 푸시 폭탄 방지). 파싱·이벤트추출 큐 등록은 그대로 수행(분석 baseline).
   *   라이브 신호 생성은 isBackfill=true 공시를 항상 제외(SignalGenerationService).
   */
  async collectByDate(
    bgnDe: string,
    endDe: string,
    triggeredBy: 'CRON' | 'MANUAL' = 'MANUAL',
    options: { isBackfill?: boolean } = {},
  ): Promise<{ saved: number; total?: number; message?: string }> {
    const isBackfill = options.isBackfill ?? false;
    // ① isCollecting 락 — 중복 실행 시 로그를 생성하지 않고 조기 반환
    if (this.isCollecting) {
      this.logger.warn('이전 수집 작업이 아직 진행 중입니다. 건너뜁니다.');
      return { saved: 0, message: '이전 작업 진행 중' };
    }

    this.isCollecting = true;

    // ② CollectionLog RUNNING 상태로 생성
    const log = await this.prisma.disclosureCollectionLog.create({
      data: { bgnDe, endDe, triggeredBy, status: 'RUNNING' },
    });

    let fetchedCount = 0;
    let newCount = 0;
    let failedCount = 0;

    try {
      this.logger.log(
        `공시 수집 시작... (${bgnDe} ~ ${endDe}) [triggeredBy=${triggeredBy}]`,
      );

      const disclosures = await this.dartApiService.getAllDisclosures(
        bgnDe,
        endDe,
      );
      fetchedCount = disclosures.length;

      if (disclosures.length === 0) {
        this.logger.log('새로운 공시가 없습니다.');
        // ③-a 결과 없음도 정상 완료 → SUCCESS
        await this.prisma.disclosureCollectionLog.update({
          where: { id: log.id },
          data: {
            endedAt: new Date(),
            fetchedCount: 0,
            newCount: 0,
            skippedCount: 0,
            failedCount: 0,
            status: 'SUCCESS',
          },
        });
        return { saved: 0, total: 0 };
      }

      // 신규 공시 필터링 (DB에 없는 것만)
      const newDisclosures = await this.filterNewDisclosures(disclosures);
      const skippedCount = fetchedCount - newDisclosures.length;

      if (newDisclosures.length === 0) {
        this.logger.log('모든 공시가 이미 수집되었습니다.');
        await this.prisma.disclosureCollectionLog.update({
          where: { id: log.id },
          data: {
            endedAt: new Date(),
            fetchedCount,
            newCount: 0,
            skippedCount,
            failedCount: 0,
            status: 'SUCCESS',
          },
        });
        return { saved: 0, total: fetchedCount };
      }

      // DB 저장 — 백필 모드면 isBackfill=true 표식 동반
      newCount = await this.saveDisclosures(newDisclosures, isBackfill);
      this.logger.log(
        `${newCount}개 신규 공시 저장 완료${isBackfill ? ' [백필]' : ''}`,
      );

      // M1 연결점: 신규 저장된 공시 rcpNo를 파싱 큐에 등록
      // DAR-233: 기존 setImmediate fire-and-forget는 콜백 실패를 logger.error로만
      // 삼키고, CollectionLog는 이미 SUCCESS로 마감돼 "파싱 미등록"이 수집상태에
      // 드러나지 않았다(드레인 복구가 지연되면 신규 공시가 영영 미파싱).
      // → await 경로로 옮기되, 실패 시 해당 건수를 failedCount로 반영해
      //   상태를 PARTIAL로 마감한다(PipelineDrainScheduler.backfillMissingDocuments
      //   복구 대상임을 수집상태에 명시).
      let parseEnqueueFailedCount = 0;
      if (this.disclosureDocumentsService && newDisclosures.length > 0) {
        const newRcpNos = newDisclosures.map((d) => d.rcept_no);
        try {
          await this.disclosureDocumentsService.enqueueParsing(newRcpNos);
        } catch (enqueueError) {
          this.logger.error('파싱 큐 등록 오류', enqueueError);
          // 큐 등록 실패분은 파싱 미등록 상태 — 최소 실패건수로 신규 저장 전체를
          // 반영한다(부분실패가 수집상태에 드러나도록 / 드레인 backfill 복구 대상).
          parseEnqueueFailedCount = newRcpNos.length;
        }
      }

      // 알림 매칭 및 발송 — 오류 시 failedCount 증가, throw하지 않음
      // ★DAR-129: 백필 모드는 사용자 알림을 절대 발송하지 않는다(과거 공시 푸시 폭탄 방지).
      if (isBackfill) {
        this.logger.log('[백필] 사용자 알림 매칭·발송 건너뜀');
      } else {
        try {
          await this.matchAndNotify(newDisclosures);
        } catch (notifyError) {
          this.logger.error('알림 발송 오류', notifyError);
          failedCount = newDisclosures.length; // 매칭 전체 실패로 간주
        }
      }

      const skippedFinal = fetchedCount - newCount;
      // 파싱 큐 등록 실패분을 합산 — 알림 실패와 함께 부분실패 메트릭에 반영(DAR-233)
      const failedTotal = failedCount + parseEnqueueFailedCount;
      const finalStatus = failedTotal > 0 ? 'PARTIAL' : 'SUCCESS';

      // ③-b SUCCESS / PARTIAL 로 갱신
      await this.prisma.disclosureCollectionLog.update({
        where: { id: log.id },
        data: {
          endedAt: new Date(),
          fetchedCount,
          newCount,
          skippedCount: skippedFinal,
          failedCount: failedTotal,
          status: finalStatus,
        },
      });

      this.logger.log(`공시 수집 완료. [status=${finalStatus}]`);
      return { saved: newCount, total: fetchedCount };
    } catch (error) {
      this.logger.error('공시 수집 실패', error);

      // ③-c FAILED 로 갱신
      await this.prisma.disclosureCollectionLog.update({
        where: { id: log.id },
        data: {
          endedAt: new Date(),
          fetchedCount,
          newCount,
          skippedCount: fetchedCount - newCount,
          failedCount,
          status: 'FAILED',
          errorMessage: error instanceof Error ? error.message : String(error),
        },
      });

      throw error; // 컨트롤러 레이어에서 500 응답 처리
    } finally {
      this.isCollecting = false;
    }
  }

  /**
   * 수집 이력 조회 — 최근 50건, 상태 필터 선택
   *
   * @param status - 'RUNNING' | 'SUCCESS' | 'PARTIAL' | 'FAILED' (미지정 시 전체)
   */
  async getCollectionLogs(status?: string): Promise<DisclosureCollectionLog[]> {
    return this.prisma.disclosureCollectionLog.findMany({
      where: status ? { status } : undefined,
      orderBy: { startedAt: 'desc' },
      take: 50,
    });
  }

  /**
   * 공시 수집 - 평일 장외시간(06~07, 18~22, KST) 1시간 간격
   * 이른 아침/저녁 공시 대비
   */
  @Cron('0 6-7,18-22 * * 1-5', { timeZone: KST_TIMEZONE })
  async collectDisclosuresOffHours() {
    // collectDisclosures가 'CRON' 전달하므로 변경 없음
    await this.collectDisclosures();
  }

  /**
   * 만료 토큰 및 오래된 알림 정리 - 매일 자정(KST)
   *
   * DAR-232: 기존에는 실패를 logger.error 로만 삼켜 dead-token·읽은알림이 조용히
   * 무한 누적될 수 있었다. 본 작업을 CronRunRecorder 로 감싸 실패를 CronRunLog 에
   * FAILED 로 남기고(데이터 신선도 안전망에 노출), cron 스케줄은 throw 없이 유지한다.
   */
  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT, { timeZone: KST_TIMEZONE })
  async cleanupExpiredTokens(): Promise<{
    notifications: number;
    devices: number;
  }> {
    // 본업: 예외를 삼키지 않고 던진다 → recorder 가 FAILED 로 기록한 뒤 재던짐.
    const run = async (): Promise<{ notifications: number; devices: number }> => {
      this.logger.log('만료 데이터 정리 시작...');

      const ninetyDaysAgo = new Date();
      ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);

      // 90일 이상 된 읽은 알림 삭제
      const deletedNotifications =
        await this.prisma.notificationHistory.deleteMany({
          where: {
            isRead: true,
            readAt: { lt: ninetyDaysAgo },
          },
        });

      // 90일 이상 사용되지 않은 디바이스 토큰 삭제
      const deletedDevices = await this.prisma.userDevice.deleteMany({
        where: {
          lastUsedAt: { lt: ninetyDaysAgo },
        },
      });

      this.logger.log(
        `정리 완료 - 알림 ${deletedNotifications.count}개, 디바이스 ${deletedDevices.count}개 삭제`,
      );
      return {
        notifications: deletedNotifications.count,
        devices: deletedDevices.count,
      };
    };

    try {
      if (!this.cronRunRecorder) return await run();
      // DAR-110/232: 마지막 성공시각/삭제건수 기록(신선도 판정 입력 + 실패 표면화).
      return await this.cronRunRecorder.record(CRON_JOB_KEYS.CLEANUP_DAILY, run, {
        countOf: (r) => r.notifications + r.devices,
      });
    } catch (error) {
      // recorder 가 FAILED 기록 후 재던진 예외(또는 미주입 시 본업 예외)를 흡수해
      // cron 스케줄을 유지한다(기존 거동 보존).
      this.logger.error('만료 데이터 정리 실패', error);
      return { notifications: 0, devices: 0 };
    }
  }

  /**
   * DB에 없는 신규 공시만 필터링
   */
  private async filterNewDisclosures(
    items: DartDisclosureItem[],
  ): Promise<DartDisclosureItem[]> {
    const rcpNos = items.map((item) => item.rcept_no);

    const existing = await this.prisma.disclosure.findMany({
      where: { rcpNo: { in: rcpNos } },
      select: { rcpNo: true },
    });

    const existingSet = new Set(existing.map((e) => e.rcpNo));
    return items.filter((item) => !existingSet.has(item.rcept_no));
  }

  /**
   * 공시 데이터 DB 저장
   */
  private async saveDisclosures(
    items: DartDisclosureItem[],
    isBackfill = false,
  ): Promise<number> {
    const data = items.map((item) => ({
      rcpNo: item.rcept_no,
      corpCode: item.corp_code,
      corpName: item.corp_name,
      reportName: item.report_nm,
      rcpDt: item.rcept_dt,
      flrName: item.flr_nm,
      rmk: item.rm || '',
      disclosureType: this.dartApiService.classifyDisclosureType(
        item.report_nm,
      ),
      // DAR-129: 백필 모드면 라이브 신호·알림 격리 표식
      isBackfill,
    }));

    const result = await this.prisma.disclosure.createMany({
      data,
      skipDuplicates: true,
    });

    return result.count;
  }

  /**
   * 관심 기업 매칭 + 알림 생성 + 푸시 발송
   */
  private async matchAndNotify(items: DartDisclosureItem[]) {
    const corpCodes = [...new Set(items.map((item) => item.corp_code))];

    // 해당 기업을 관심 등록한 사용자 조회
    const watchListEntries = await this.prisma.watchList.findMany({
      where: { corpCode: { in: corpCodes } },
      include: {
        user: {
          include: {
            notificationSettings: true,
            devices: true,
          },
        },
      },
    });

    if (watchListEntries.length === 0) {
      this.logger.log('매칭된 관심 기업 사용자가 없습니다.');
      return;
    }

    // 사용자별 매칭 공시 그룹핑
    const userDisclosureMap = new Map<
      string,
      { userId: string; pushTokens: string[]; disclosures: DartDisclosureItem[] }
    >();

    for (const entry of watchListEntries) {
      const { user } = entry;

      // 알림 비활성화 체크
      if (user.notificationSettings && !user.notificationSettings.isEnabled) {
        continue;
      }

      // 해당 기업의 공시 필터링
      const matchedDisclosures = items.filter(
        (item) => item.corp_code === entry.corpCode,
      );

      // 공시 유형 필터 적용
      const filteredDisclosures = matchedDisclosures.filter((item) => {
        const type = this.dartApiService.classifyDisclosureType(item.report_nm);
        const settings = user.notificationSettings;

        // 설정이 없거나 유형 필터가 비어있으면 모든 유형 허용
        if (!settings || settings.disclosureTypes.length === 0) {
          return true;
        }

        return settings.disclosureTypes.includes(type);
      });

      // 키워드 필터 적용
      const keywordFiltered = filteredDisclosures.filter((item) => {
        const keywords = user.notificationSettings?.keywords ?? [];
        if (keywords.length === 0) return true;
        const reportName = item.report_nm.toLowerCase();
        return keywords.some((kw) => reportName.includes(kw.toLowerCase()));
      });

      if (keywordFiltered.length === 0) continue;

      const existing = userDisclosureMap.get(user.id);
      const pushTokens = user.devices
        .map((d) => d.deviceToken)
        .filter((t) => this.expoPushService.isValidExpoPushToken(t));

      if (existing) {
        existing.disclosures.push(...keywordFiltered);
      } else {
        userDisclosureMap.set(user.id, {
          userId: user.id,
          pushTokens,
          disclosures: keywordFiltered,
        });
      }
    }

    // 알림 히스토리 생성 + 푸시 발송
    const pushMessages: ExpoPushMessage[] = [];

    for (const [, userData] of userDisclosureMap) {
      for (const disclosure of userData.disclosures) {
        const disclosureRcpNo = disclosure.rcept_no;

        // 중복 알림 방지 — DAR-84: (userId, type, refId) 멱등키. 공시는 refId=rcpNo
        const exists = await this.prisma.notificationHistory.findUnique({
          where: {
            userId_type_refId: {
              userId: userData.userId,
              type: 'DISCLOSURE',
              refId: disclosureRcpNo,
            },
          },
        });

        if (exists) continue;

        // NotificationHistory 생성 — 다형 인박스 필드 동봉(공시 타입)
        await this.prisma.notificationHistory.create({
          data: {
            userId: userData.userId,
            type: 'DISCLOSURE',
            refId: disclosureRcpNo,
            disclosureRcpNo,
            title: `${disclosure.corp_name} 새 공시`,
            body: disclosure.report_nm,
            deepLink: `/disclosure/${disclosureRcpNo}`,
          },
        });

        // 푸시 메시지 생성
        for (const token of userData.pushTokens) {
          pushMessages.push({
            to: token,
            title: `${disclosure.corp_name} 새 공시`,
            body: disclosure.report_nm,
            data: { disclosureRcpNo },
          });
        }
      }
    }

    // 푸시 발송
    if (pushMessages.length > 0) {
      await this.expoPushService.sendPushNotifications(pushMessages);
      this.logger.log(`${pushMessages.length}개 푸시 알림 발송`);
    }
  }

  /** YYYYMMDD(KST 거래일). 시스템 TZ 무관 — UTC 새벽 전일 반환 방지(DAR-199). */
  private formatDate(date: Date): string {
    return formatKstDateCompact(date);
  }
}
