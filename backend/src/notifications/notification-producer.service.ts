import { Injectable, Logger, Optional } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import {
  QUEUE,
  NOTIFY_JOB,
  NotifySignalJobData,
  NotifyExitJobData,
  NotifyThesisViolatedJobData,
  NotifyTradeJobData,
  NotifyOpsAlertJobData,
  OpsAlertSeverity,
  NotifyJobData,
  notifyJobId,
} from '../common/queues/queue.constants';

/**
 * DAR-85 — 알림 큐 producer.
 *
 * 엔진(3 신호생성 / 4 논리훼손 / 5 청산)이 의사결정 시점에 호출한다.
 * ★엔진은 직접 발송하지 않고 이 producer를 통해 QUEUE.NOTIFY 로만 enqueue 한다.
 * 실제 인박스 기록·푸시 발송은 NotifyConsumer 가 단독 담당(관심사 분리·안전).
 *
 * 큐 미설정(@Optional, 테스트/큐 비활성 환경)이거나 enqueue 실패 시에도
 * 절대 throw 하지 않는다 — 알림은 비임계 경로이므로 엔진 본연의 작업을 깨지 않는다.
 */
@Injectable()
export class NotificationProducerService {
  private readonly logger = new Logger(NotificationProducerService.name);

  constructor(
    @Optional()
    @InjectQueue(QUEUE.NOTIFY)
    private readonly queue: Queue | null = null,
  ) {}

  /** engine3: 매수신호(STRONG_BUY/BUY) 생성 시점 */
  async enqueueSignal(data: NotifySignalJobData): Promise<void> {
    await this.enqueue(NOTIFY_JOB.SIGNAL, data);
  }

  /** engine5: 청산 권고(EXIT/BLOCK_REBUY) 시점 */
  async enqueueExit(data: NotifyExitJobData): Promise<void> {
    await this.enqueue(NOTIFY_JOB.EXIT, data);
  }

  /** engine4: 투자논리 훼손(ACTIVE→INVALIDATED) 시점 */
  async enqueueThesisViolated(data: NotifyThesisViolatedJobData): Promise<void> {
    await this.enqueue(NOTIFY_JOB.THESIS_VIOLATED, data);
  }

  /** DAR-424 engine5: 라이브 페이퍼 매수 체결 직후 */
  async enqueueTradeEntry(data: NotifyTradeJobData): Promise<void> {
    await this.enqueue(NOTIFY_JOB.TRADE_ENTRY, { ...data, kind: 'ENTRY' });
  }

  /** DAR-424 engine5: 라이브 페이퍼 매도 체결 직후 */
  async enqueueTradeExit(data: NotifyTradeJobData): Promise<void> {
    await this.enqueue(NOTIFY_JOB.TRADE_EXIT, { ...data, kind: 'EXIT' });
  }

  /**
   * DAR-473(P01): 운영(OPS_ALERT) 알림 발행 — 관측·운영 계층 전용(매매 행동 무접점).
   *
   * 감지점(크론 stale·수집/청산 실패)과 일일 운영 리포트(P05)가 이 메서드로 사용자에게
   * 능동 통지한다. 기존 NOTIFY 큐·expo-push 배선을 그대로 재사용하며, 수신자는 실제 앱
   * 사용자 전원(브로드캐스트)이고 consumer 가 opsPushEnabled(기본 ON) 토글로 게이트한다.
   *
   * ★리스크(RISK_ALERT) 발행은 P02 감지점 배선(킬스위치·드로다운) 소관이다. 본 이슈는
   *   RISK_ALERT 타입/카테고리/채널을 함께 신설(additive)해 P02 가 추가 마이그레이션 없이
   *   consumer 의 동일 경로로 발행할 수 있게 한다.
   *
   * @param severity 심각도(제목 라벨·중요도). INFO<WARNING<ERROR<CRITICAL.
   * @param source   발행 출처 키(감지점 식별). 예: 'cron-freshness' | 'daily-report'.
   * @param message  사용자 표시 본문(한국어).
   * @param meta     선택 옵션 — dedupeKey(멱등 자연키·미지정 시 source+message 로 도출),
   *                 deepLink(인앱 딥링크), data(관측용 부가 컨텍스트).
   */
  async enqueueOpsAlert(
    severity: OpsAlertSeverity,
    source: string,
    message: string,
    meta?: { dedupeKey?: string; deepLink?: string; data?: Record<string, unknown> },
  ): Promise<void> {
    // 멱등 자연키: 명시 dedupeKey 우선, 없으면 source+message 로 도출(동일 사건 중복 억제).
    //   ★반복 발화 이벤트(매일 크론 stale 등)는 호출부가 시간 버킷을 포함한 dedupeKey 를 넘겨야 한다.
    const dedupeKey = meta?.dedupeKey ?? `${source}:${message}`;
    const payload: NotifyOpsAlertJobData = {
      type: 'OPS_ALERT',
      severity,
      source,
      message,
      dedupeKey,
      deepLink: meta?.deepLink,
      meta: meta?.data,
    };
    await this.enqueue(NOTIFY_JOB.OPS_ALERT, payload);
  }

  private async enqueue(jobName: string, data: NotifyJobData): Promise<void> {
    if (!this.queue) {
      this.logger.debug(`NOTIFY 큐 미설정 — enqueue 스킵 (${jobName})`);
      return;
    }
    try {
      await this.queue.add(jobName, data, {
        removeOnComplete: true,
        removeOnFail: 100,
        // 동일 잡 재시도 안전: consumer 측 멱등(isNotified / NotificationHistory unique)
        attempts: 3,
        backoff: { type: 'exponential', delay: 5000 },
        // DAR-230: 잡 유형별 자연키 jobId(sig-/exit-/thesis-)로 다경로 재발행 중복 적재 방지.
        jobId: notifyJobId(jobName, data),
      });
      this.logger.debug(`NOTIFY enqueue: ${jobName}`);
    } catch (err) {
      // 알림 enqueue 실패가 엔진 파이프라인을 깨지 않도록 graceful 처리.
      this.logger.error(`NOTIFY enqueue 실패(graceful): ${jobName}`, err as Error);
    }
  }
}
