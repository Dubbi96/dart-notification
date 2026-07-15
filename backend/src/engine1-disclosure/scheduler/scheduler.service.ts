import { Injectable, Logger, Optional } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../../prisma/prisma.service';
import {
  DartApiService,
  DartDisclosureItem,
} from '../dart-api/dart-api.service';
import { ExpoPushService } from '../../expo-push/expo-push.service';
import { ExpoPushMessage } from 'expo-server-sdk';
import { DisclosureCollectionLog, NotificationType } from '@prisma/client';
import { NotificationsService } from '../../notifications/notifications.service';
import { channelIdForType } from '../../notifications/notification-category';
import { truncateForTitle } from '../../notifications/notification-source';
import { DisclosureDocumentsService } from '../disclosure-documents/disclosure-documents.service';
import { KST_TIMEZONE, formatKstDateCompact } from '../../common/time/kst';
import { CronRunRecorderService } from '../../cron-health/cron-run-recorder.service';
import { CRON_JOB_KEYS } from '../../cron-health/cron-health.jobs';

/**
 * W5 리얼타임성 ①: 장중 1분 공시 델타 폴링 크론식(KST).
 * - 09:00~15:59(장중 6.5h+α)의 매 분 — 단, 매 10분 정각(0,10,…,50분)은 제외한다.
 *   그 분은 기존 풀스캔 크론('*\/10 8-17')이 같은 데이터를 수집하므로 델타 1콜이 중복이다
 *   (틱 수 420→378, 일일 예산 400콜 안에 수렴).
 * - 풀스캔(정합성 백스톱)은 그대로 유지 — 델타는 '최신 페이지 1콜' 저지연 레인만 담당한다.
 */
export const DISCLOSURE_DELTA_CRON =
  '1-9,11-19,21-29,31-39,41-49,51-59 9-15 * * 1-5';

/**
 * W5 ①: 델타 레인 자체 일일 콜 예산(이중 방어).
 * 1차 방어는 dart-api.service.ts 의 3단 쿼터 가드(라이브 목록 예약분 2,000 — 델타는 라이브
 * list 라 절대 사전 차단되지 않음)이고, 이 상수는 델타 조기종료 버그·페이지네이션 폭주가
 * 예약분을 태우는 재사고 경로(과거 기아 장애 6/24·7/15)를 막는 델타 전용 2차 상한이다.
 * 378틱/일 × 1콜 + 페이지 초과분 여유 ≈ 400콜(장중 6.5h 1분 카덴스 여유분).
 */
export const DISCLOSURE_DELTA_DAILY_CALL_BUDGET = 400;

/** 델타 폴링 1회 실행 결과(관측·테스트용). */
export interface DeltaCollectResult {
  /** 신규 저장 건수. */
  saved: number;
  /** 이번 틱에 소비한 DART list 콜 수. */
  calls: number;
  /** 스킵 사유 — LOCK(델타 중복 실행) | BUDGET(델타 일일 예산 소진). 실행됐으면 undefined. */
  skipped?: 'LOCK' | 'BUDGET';
}

@Injectable()
export class SchedulerService {
  private readonly logger = new Logger(SchedulerService.name);
  private isCollecting = false;
  /**
   * W5 ②: 델타 레인 전용 락 — 10분 풀스캔의 isCollecting 락과 분리한다.
   * 풀스캔이 오래 걸려도 델타 1분 틱이 굶지 않는다(락 공유 시 풀스캔이 델타를 블로킹하는
   * 설계 함정 회피). 동일 rcpNo 동시 저장은 filterNewDisclosures + createMany(skipDuplicates)
   * + 알림 인박스 유니크 제약(userId,type,refId)이 원자적으로 차단한다.
   */
  private isDeltaCollecting = false;
  /** 델타 일일 예산 카운터(KST 일자 키·프로세스 메모리 — dart-api 가드가 백스톱). */
  private deltaDayKey = '';
  private deltaCallsToday = 0;

  constructor(
    private readonly prisma: PrismaService,
    private readonly dartApiService: DartApiService,
    private readonly expoPushService: ExpoPushService,
    private readonly notifications: NotificationsService,
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
   * W5: 정합성 풀스캔(전 페이지 완주 + CollectionLog) — 델타 레인의 백스톱으로 유지.
   */
  @Cron('*/10 8-17 * * 1-5', { timeZone: KST_TIMEZONE })
  async collectDisclosures() {
    const today = this.formatDate(new Date());
    return this.collectByDate(today, today, 'CRON');
  }

  /**
   * W5 리얼타임성 ①: 장중 1분 공시 델타 폴링 — 최악 알림 지연 ~10분 → ~60~90초.
   *
   * DART list.json 최신 페이지(정렬 date/desc) 1콜만 fetch 해 신규 rcpNo 만 저장하고
   * 파이프라인(파싱 큐·알림 매칭)에 투입한다. 이미 저장된 rcpNo 를 만나면 조기 종료
   * (신규 0건이면 정확히 1콜). 쿼터는 라이브 목록 예약분(사전 차단 없음) 안에서 소비하되,
   * 델타 자체 일일 예산(DISCLOSURE_DELTA_DAILY_CALL_BUDGET)으로 이중 방어한다.
   *
   * 예외는 흡수한다(1분 크론 유지) — 실패는 CronRunRecorder 가 FAILED 로 표면화하고,
   * 놓친 공시는 다음 틱 또는 10분 풀스캔(백스톱)이 회수한다.
   */
  @Cron(DISCLOSURE_DELTA_CRON, { timeZone: KST_TIMEZONE })
  async collectDisclosuresDelta(): Promise<DeltaCollectResult> {
    try {
      return await this.runDeltaCollection();
    } catch (error) {
      // recorder 가 FAILED 기록 후 재던진 예외를 흡수 — 다음 1분 틱은 계속 발화한다.
      this.logger.error('공시 델타 폴링 실패(다음 틱 재시도)', error);
      return { saved: 0, calls: 0 };
    }
  }

  /**
   * 델타 폴링 본체(수동 트리거/테스트 진입점). 락·예산 가드 후 CronRunLog 에 기록한다.
   * ★풀스캔 isCollecting 락과는 독립 — 풀스캔 진행 중에도 델타는 실행된다(W5 ②).
   */
  async runDeltaCollection(): Promise<DeltaCollectResult> {
    // ① 델타 전용 락 — 이전 델타 틱이 아직 진행 중이면 스킵(SKIPPED 기록).
    if (this.isDeltaCollecting) {
      this.logger.warn('이전 델타 폴링이 아직 진행 중입니다. 건너뜁니다.');
      await this.cronRunRecorder?.recordSkip(CRON_JOB_KEYS.DISCLOSURE_DELTA);
      return { saved: 0, calls: 0, skipped: 'LOCK' };
    }

    // ② 델타 일일 예산(이중 방어) — 소진 시 이 틱은 콜 없이 스킵. KST 자정 리셋.
    this.rollDeltaBudgetDayIfNeeded();
    if (this.deltaCallsToday >= DISCLOSURE_DELTA_DAILY_CALL_BUDGET) {
      this.logger.warn(
        `델타 폴링 일일 예산 소진(${this.deltaCallsToday}/${DISCLOSURE_DELTA_DAILY_CALL_BUDGET}콜) — ` +
          `이 틱은 스킵(풀스캔 백스톱은 계속 가동).`,
      );
      await this.cronRunRecorder?.recordSkip(CRON_JOB_KEYS.DISCLOSURE_DELTA);
      return { saved: 0, calls: 0, skipped: 'BUDGET' };
    }

    this.isDeltaCollecting = true;
    try {
      const run = () => this.fetchAndIngestDelta();
      if (!this.cronRunRecorder) return await run();
      // ⑤ CronRunLog 등록 — krx.daily 거짓 stale 선례 방지(신선도 안전망 입력).
      return await this.cronRunRecorder.record(CRON_JOB_KEYS.DISCLOSURE_DELTA, run, {
        countOf: (r) => r.saved,
      });
    } finally {
      this.isDeltaCollecting = false;
    }
  }

  /**
   * 델타 fetch·저장·파이프라인 투입.
   *
   * 페이지네이션 규칙: 최신순(date/desc) 페이지를 순회하되,
   *  - 페이지에 이미 저장된 rcpNo 가 1건이라도 있으면 그 페이지까지만 처리하고 종료
   *    (그 뒤 페이지는 전부 기존 데이터 — 신규 0건이면 정확히 1콜),
   *  - 마지막 페이지 도달 또는 델타 예산 도달 시 종료(페이지네이션 폭주 차단).
   */
  private async fetchAndIngestDelta(): Promise<DeltaCollectResult> {
    const today = this.formatDate(new Date());
    const newItems: DartDisclosureItem[] = [];
    let pageNo = 1;
    let calls = 0;

    while (this.deltaCallsToday < DISCLOSURE_DELTA_DAILY_CALL_BUDGET) {
      this.deltaCallsToday += 1;
      calls += 1;
      // 라이브 list 콜(bulk 미지정) — 예약분으로 보호되어 사전 차단되지 않는다.
      const response = await this.dartApiService.getDisclosureList({
        bgn_de: today,
        end_de: today,
        page_no: pageNo,
        page_count: 100,
        sort: 'date',
        sort_mth: 'desc',
      });

      if (response.status === '013') break; // 오늘 공시 없음 — 정상 종료
      if (response.status !== '000') {
        this.logger.warn(
          `델타 폴링 DART 응답 오류: ${response.status} - ${response.message}`,
        );
        break;
      }

      const pageNew = await this.filterNewDisclosures(response.list);
      newItems.push(...pageNew);

      // 조기 종료: 기존 rcpNo 를 만났거나(페이지 일부만 신규) 마지막 페이지.
      if (pageNew.length < response.list.length) break;
      if (pageNo >= response.total_page) break;
      pageNo += 1;
    }

    if (newItems.length === 0) {
      return { saved: 0, calls };
    }

    // 저장 — 풀스캔과 동시 실행돼도 createMany(skipDuplicates)가 중복 저장을 원자적으로 차단.
    const saved = await this.saveDisclosures(newItems, false);
    this.logger.log(`[델타] ${saved}개 신규 공시 저장 (${calls}콜)`);

    // 파이프라인 투입 ①: 파싱 큐 등록 — 실패해도 델타는 계속(pipeline 드레인이 회수).
    if (this.disclosureDocumentsService) {
      try {
        await this.disclosureDocumentsService.enqueueParsing(
          newItems.map((d) => d.rcept_no),
        );
      } catch (enqueueError) {
        this.logger.error('[델타] 파싱 큐 등록 오류(드레인 회수 대상)', enqueueError);
      }
    }

    // 파이프라인 투입 ②: 알림 매칭·발송 — 인박스 유니크 제약이 멱등 권위라
    // 풀스캔과 경합해도 (user, 공시) 중복 푸시는 0 이다(created=false → 스킵).
    try {
      await this.matchAndNotify(newItems);
    } catch (notifyError) {
      this.logger.error('[델타] 알림 발송 오류(다음 폴링서 재시도)', notifyError);
    }

    return { saved, calls };
  }

  /** 델타 예산 카운터 KST 일자 리셋. */
  private rollDeltaBudgetDayIfNeeded(): void {
    const day = this.formatDate(new Date());
    if (day !== this.deltaDayKey) {
      this.deltaDayKey = day;
      this.deltaCallsToday = 0;
    }
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
    // FK 가드(2026-07-15 prod 실증): Company 에 없는 corpCode 가 배치에 1건이라도 끼면
    // createMany 전체가 P2003(disclosures_corpCode_fkey)으로 죽어 그날 수집이 통째로
    // FAILED 반복된다(신규 상장·미동기 기업이 공시하는 날마다 재발). 누락 기업을 DART
    // 목록 메타(corp_name/stock_code/corp_cls)로 먼저 자동 생성해 배치를 살린다.
    await this.ensureCompaniesExist(items);

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
   * 공시 목록의 corpCode 중 Company 미존재분을 DART 목록 메타로 자동 생성한다.
   * - 공시를 낸 기업은 우리 마스터에 존재해야 한다 — 별도 기업 마스터 동기화가 없는
   *   현 구조에서 이 경로가 사실상의 신규 기업 유입점이다.
   * - createMany + skipDuplicates 라 동시 실행에도 멱등.
   */
  private async ensureCompaniesExist(items: DartDisclosureItem[]): Promise<void> {
    const corpCodes = [...new Set(items.map((i) => i.corp_code))];
    if (corpCodes.length === 0) {
      return;
    }
    const known = await this.prisma.company.findMany({
      where: { corpCode: { in: corpCodes } },
      select: { corpCode: true },
    });
    const knownSet = new Set(known.map((c) => c.corpCode));
    const missingByCorp = new Map<string, DartDisclosureItem>();
    for (const item of items) {
      if (!knownSet.has(item.corp_code) && !missingByCorp.has(item.corp_code)) {
        missingByCorp.set(item.corp_code, item);
      }
    }
    if (missingByCorp.size === 0) {
      return;
    }
    await this.prisma.company.createMany({
      data: [...missingByCorp.values()].map((item) => ({
        corpCode: item.corp_code,
        corpName: item.corp_name,
        stockCode: item.stock_code?.trim() || null,
        market:
          item.corp_cls === 'Y' ? 'KOSPI' : item.corp_cls === 'K' ? 'KOSDAQ' : null,
      })),
      skipDuplicates: true,
    });
    this.logger.warn(
      `Company 자동 생성 ${missingByCorp.size}건 — 공시 목록에 미동기 기업 corpCode 발견: ` +
        [...missingByCorp.keys()].slice(0, 5).join(', '),
    );
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

    // 알림 인박스 생성 + 푸시 발송 — (user, 공시) 단위로 멱등·재시도를 묶는다(DAR-259).
    //
    //  ① createNotificationIfAbsent.created=false → 이미 통지(인박스 존재) → 푸시 스킵(중복 0).
    //  ② created=true 후 발송 실패 → 방금 만든 인박스를 롤백 → 다음 폴링서 재생성·재발송.
    //
    // 종전: 인박스를 개별 커밋한 뒤 루프 '밖'에서 1회 일괄 발송이라, cron 직접 호출(BullMQ
    // 재시도 부재) 경로에서 sendPushNotifications 가 throw 하면 인박스만 남고 다음 폴링은
    // 멱등 가드(exists)로 스킵 → 핵심 공시 알림이 영구 미발송됐다. 인박스를 '푸시 발송의
    // 멱등 권위'로 승격하고 발송 실패 시에만 권위를 되돌려 재발송 기회를 남긴다(SIGNAL/EXIT
    // NotifyConsumer 와 동일한 created-플래그 멱등 모델).
    let sentCount = 0;

    for (const [, userData] of userDisclosureMap) {
      for (const disclosure of userData.disclosures) {
        const disclosureRcpNo = disclosure.rcept_no;
        const deepLink = `/disclosure/${disclosureRcpNo}`;
        // DAR-432(2026-07-06 개정): 기업명+공시유형을 제목에 — '{기업명} · {공시유형}' (이모지 미사용).
        //   공시유형(report_nm)은 제목 길이 가이드(≤약 40자)를 위해 절단하고, 본문에 전문(全文)을 둔다.
        //   탭→공시 상세(deepLink). DAR-430 채널('disclosure')·DAR-431 딥링크 data 동봉(정합).
        const reportType = truncateForTitle(disclosure.report_nm, 24);
        const title = `${disclosure.corp_name} · ${reportType}`;
        const body = disclosure.report_nm;
        const channelId = channelIdForType(NotificationType.DISCLOSURE);

        // 중복 알림 방지 — DAR-84: (userId, type, refId) 멱등키. 공시는 refId=rcpNo
        const { notification, created } =
          await this.notifications.createNotificationIfAbsent({
            userId: userData.userId,
            type: NotificationType.DISCLOSURE,
            refId: disclosureRcpNo,
            title,
            body,
            deepLink,
            disclosureRcpNo,
          });

        // 이미 통지된 (user, 공시) — 인박스가 푸시 멱등 권위. 재발송 금지(중복 0).
        if (!created) continue;

        // 발송 가능한 토큰이 없으면 인박스만 남긴다(보낼 곳이 없어 롤백·재발송이 무의미).
        if (userData.pushTokens.length === 0) continue;

        const pushMessages: ExpoPushMessage[] = userData.pushTokens.map((token) => ({
          to: token,
          title,
          body,
          channelId,
          data: {
            disclosureRcpNo,
            deepLink,
            type: NotificationType.DISCLOSURE,
            refId: disclosureRcpNo,
            channelId,
          },
        }));

        try {
          await this.expoPushService.sendPushNotifications(pushMessages);
          sentCount += pushMessages.length;
        } catch (error) {
          // 발송 실패 → 방금 만든 인박스 롤백 → 다음 폴링서 재발송(영구 누락 방지).
          await this.notifications.rollbackNotification(notification.id);
          this.logger.error(
            `푸시 발송 실패 — 인박스 롤백(재폴링서 재발송): user=${userData.userId} rcpNo=${disclosureRcpNo}`,
            error as Error,
          );
        }
      }
    }

    if (sentCount > 0) {
      this.logger.log(`${sentCount}개 푸시 알림 발송`);
    }
  }

  /** YYYYMMDD(KST 거래일). 시스템 TZ 무관 — UTC 새벽 전일 반환 방지(DAR-199). */
  private formatDate(date: Date): string {
    return formatKstDateCompact(date);
  }
}
