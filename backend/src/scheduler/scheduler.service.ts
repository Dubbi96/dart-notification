import { Injectable, Logger, Optional } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import {
  DartApiService,
  DartDisclosureItem,
} from '../dart-api/dart-api.service';
import { ExpoPushService } from '../expo-push/expo-push.service';
import { ExpoPushMessage } from 'expo-server-sdk';
import { DisclosureCollectionLog } from '@prisma/client';
import { DisclosureDocumentsService } from '../disclosure-documents/disclosure-documents.service';

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
  ) {}

  /**
   * 공시 수집 - 평일 08:00~18:00 10분 간격
   */
  @Cron('*/10 8-17 * * 1-5')
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
   */
  async collectByDate(
    bgnDe: string,
    endDe: string,
    triggeredBy: 'CRON' | 'MANUAL' = 'MANUAL',
  ): Promise<{ saved: number; total?: number; message?: string }> {
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

      // DB 저장
      newCount = await this.saveDisclosures(newDisclosures);
      this.logger.log(`${newCount}개 신규 공시 저장 완료`);

      // M1 연결점: 신규 저장된 공시 rcpNo를 파싱 큐에 등록
      if (this.disclosureDocumentsService && newDisclosures.length > 0) {
        const newRcpNos = newDisclosures.map((d) => d.rcept_no);
        setImmediate(async () => {
          try {
            await this.disclosureDocumentsService!.enqueueParsing(newRcpNos);
          } catch (enqueueError) {
            this.logger.error('파싱 큐 등록 오류', enqueueError);
          }
        });
      }

      // 알림 매칭 및 발송 — 오류 시 failedCount 증가, throw하지 않음
      try {
        await this.matchAndNotify(newDisclosures);
      } catch (notifyError) {
        this.logger.error('알림 발송 오류', notifyError);
        failedCount = newDisclosures.length; // 매칭 전체 실패로 간주
      }

      const skippedFinal = fetchedCount - newCount;
      const finalStatus = failedCount > 0 ? 'PARTIAL' : 'SUCCESS';

      // ③-b SUCCESS / PARTIAL 로 갱신
      await this.prisma.disclosureCollectionLog.update({
        where: { id: log.id },
        data: {
          endedAt: new Date(),
          fetchedCount,
          newCount,
          skippedCount: skippedFinal,
          failedCount,
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
   * 공시 수집 - 평일 장외시간(06~07, 18~22) 1시간 간격
   * 이른 아침/저녁 공시 대비
   */
  @Cron('0 6-7,18-22 * * 1-5')
  async collectDisclosuresOffHours() {
    // collectDisclosures가 'CRON' 전달하므로 변경 없음
    await this.collectDisclosures();
  }

  /**
   * 만료 토큰 및 오래된 알림 정리 - 매일 자정
   */
  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
  async cleanupExpiredTokens() {
    this.logger.log('만료 데이터 정리 시작...');

    try {
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
    } catch (error) {
      this.logger.error('만료 데이터 정리 실패', error);
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

        // 중복 알림 방지
        const exists = await this.prisma.notificationHistory.findUnique({
          where: {
            userId_disclosureRcpNo: {
              userId: userData.userId,
              disclosureRcpNo,
            },
          },
        });

        if (exists) continue;

        // NotificationHistory 생성
        await this.prisma.notificationHistory.create({
          data: {
            userId: userData.userId,
            disclosureRcpNo,
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

  private formatDate(date: Date): string {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}${m}${d}`;
  }
}
