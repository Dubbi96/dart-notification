import { Injectable, Logger, Optional } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PipelineIntegrityService } from './pipeline-integrity.service';
import { PipelineDrainResult } from './pipeline.types';
import { CronRunRecorderService } from '../../cron-health/cron-run-recorder.service';
import { CRON_JOB_KEYS } from '../../cron-health/cron-health.jobs';
import { KST_TIMEZONE } from '../../common/time/kst';
import { isHeavyCollectionWindow } from '../common/heavy-collection-window';

/**
 * 1회 드레인 단계별 처리 상한.
 * DAR-392: 백데이터 가속(차주 장 전 풀커버) — 100→300 상향. 파싱은 내부적으로
 *   MAX_BATCH_LIMIT(200)로 캡되고, 누락문서 큐등록(enqueue)·이벤트 추출은 DB-only 라
 *   상향이 안전하다. 실제 DART fetch throughput 은 BATCH_CONCURRENCY(5)가 상한.
 */
const DRAIN_BATCH = 300;

/**
 * DAR-503 주중(헤비 창 밖) 경량 드레인의 조회 범위(최근 N일).
 *
 * ★근거: 라이브 신규 공시는 수집 직후 BullMQ 체이닝(파싱→이벤트→AI)으로 즉시 처리되고,
 *   이 드레인은 그 체이닝이 실패(DQ-1)한 최근 건만 회수하는 세이프티넷이다. 주중엔 범위를
 *   최근 7일로 좁혀 과거 백필(24만+ 건)의 무차별 fetch·대형 스캔을 배제한다 — 커넥션 풀
 *   독점·DART 쿼터 경쟁을 피하면서 당일 체이닝 실패 복구는 그대로 유지한다. 주말(헤비 창)엔
 *   범위 무제한(전체)으로 백필 적체를 소진한다.
 * ★2일→7일 확대(2026-07 라이브 파싱 기아 장애 후속): 쿼터 기아 등 수일 장애가 이어지면
 *   미파싱 라이브 공시가 2일 창을 벗어나 주말까지 방치됐다 — 자가 회복 창을 7일로 넓혀
 *   장애 복구 후 스케줄러가 지난 주중 공시까지 스스로 회수하게 한다.
 */
const WEEKDAY_DRAIN_LOOKBACK_MS = 7 * 24 * 60 * 60_000; // 7일

/**
 * DAR-392 적응형 백오프 — 파싱 실패율이 이 임계 이상이면 DART 레이트리밋/쿼터 소진으로
 * 보고 다음 사이클을 쿨다운한다(연속 하드피팅으로 실패가 실패를 부르는 악순환 차단).
 */
const HIGH_FAILURE_RATE = 0.5;
/**
 * 백오프 판정에 필요한 최소 파싱 시도 표본.
 * 큐가 거의 빈(시도 소수) 정상 idle 을 레이트리밋으로 오인하지 않도록 한다.
 */
const MIN_SAMPLES_FOR_BACKOFF = 20;
/** 1차 쿨다운(이후 연속 고실패마다 지수 증가). */
const BASE_COOLDOWN_MS = 2 * 60_000; // 2분
/** 쿨다운 상한 — 일일 쿼터 소진 시에도 이 간격으로 재시도(자정 리셋 후 자동 재개). */
const MAX_COOLDOWN_MS = 30 * 60_000; // 30분

/**
 * 드레인 사이클 결과 상태.
 * - RAN: 이번 사이클이 실제로 드레인을 수행함(성공/실패 무관, 끝까지 진입).
 * - SKIPPED: 이전 드레인이 진행 중이라 겹침 가드가 즉시 차단함(DAR-229).
 * - COOLDOWN: DAR-392 적응형 백오프 진행 중이라 이번 사이클을 건너뜀(레이트리밋 회복 대기).
 */
export type DrainCycleStatus = 'RAN' | 'SKIPPED' | 'COOLDOWN';

/**
 * PipelineDrainScheduler (DAR-126 → DAR-392) — 수집→파싱→이벤트→AI 폐루프를 닫는 cron.
 *
 * ★근본원인(DAR-126): 수집기는 신규 공시를 PENDING 으로 enqueue 만 하고, PENDING 파싱 문서를
 *   실제로 드레인하는 cron이 없었다 → 파싱→이벤트→AI 체이닝이 첫 홉에서 멈춰 PENDING 이 적체.
 *
 * ★DAR-392(백데이터 가속): 과거 백필 공시 24만 건의 문서 fetch+parse 가 거대 병목이라
 *   기존 15분 카덴스로는 너무 느렸다(차주 장 전 풀커버 목표). 카덴스를 **매 1분**으로 올려
 *   상시 연속 드레인에 가깝게 하고, 큐가 비면 저비용 no-op 으로 idle 한다. NestJS cron 이라
 *   프로세스 재시작(재부팅) 후 자동 재개된다 — 수동 /tmp 루프(휘발성)를 시스템 자동화로 대체.
 *
 * ★DAR-503(주중/주말 이원화): 매 1분 발화는 유지하되 조회 범위를 헤비 수집 창으로 가른다.
 *   - 주중(헤비 창 밖) = 최근 7일 공시로 범위를 좁힌 **경량 세이프티넷**(DQ-1 체이닝 실패 회수).
 *     과거 백필 무차별 fetch·대형 스캔을 배제해 커넥션 풀·DART 쿼터 경쟁을 피한다.
 *   - 주말(헤비 창) = 범위 무제한 **전체 드레인**으로 백필 적체를 소진한다.
 *   두 경로 모두 매 사이클 RAN(SUCCESS 기록)이라 freshness 신선도가 유지된다(임계 무변경).
 *
 *   ★적응형 백오프(레이트리밋/쿼터 인지): 한 사이클의 파싱 실패율이 HIGH_FAILURE_RATE 이상이면
 *     (충분한 표본일 때) DART 레이트리밋/쿼터 소진으로 보고 쿨다운을 건다. 연속 고실패마다
 *     쿨다운을 지수 증가(2→4→8…분, 최대 30분)시키고, 실패율이 회복되면 즉시 0 으로 리셋한다.
 *     일일 쿼터 소진 시에도 throw 없이 최대 간격으로 재시도하다 자정 리셋 후 자동 재개한다.
 *
 * ★멱등: drainOnce 의 모든 단계가 upsert/상태조건 기반(반복 무해).
 * ★throw 금지: cron 스케줄 유지를 위해 예외를 흡수한다(recorder는 FAILED 기록).
 * ★겹침 가드(DAR-229): drainOnce 가 cron 간격을 초과할 수 있어 in-flight 플래그로 사이클을
 *   직렬화한다(중복 AI 잡 발행·DART 중복 fetch 방지). 진행 중이면 즉시 SKIPPED.
 */
@Injectable()
export class PipelineDrainScheduler {
  private readonly logger = new Logger(PipelineDrainScheduler.name);

  /** 겹침 가드 — 드레인 1회가 끝날 때까지 다음 사이클 진입을 막는다(DAR-229). */
  private isDraining = false;

  /** DAR-392 적응형 백오프 — 이 시각(ms epoch) 전까지 드레인을 건너뛴다(0=백오프 없음). */
  private cooldownUntilMs = 0;
  /** 연속 고실패 사이클 수(지수 백오프 지수). 회복 사이클에서 0 으로 리셋. */
  private consecutiveHighFailureCycles = 0;

  constructor(
    private readonly pipeline: PipelineIntegrityService,
    // @Optional: CronHealthModule 미등록 환경(일부 테스트)에서도 동작. 미주입 시 기록만 생략.
    @Optional() private readonly recorder?: CronRunRecorderService,
  ) {}

  /**
   * 매 1분 폐루프 연속 드레인(DAR-392). (간격형이라 TZ 무관이나 KST 명시로 의도 고정)
   * 큐가 비면 저비용 no-op. 레이트리밋 쿨다운 중이면 COOLDOWN 으로 빠진다.
   * DAR-503: 주중은 최근 7일 범위(경량 세이프티넷), 주말은 전체 범위로 드레인한다.
   */
  @Cron('* * * * *', { timeZone: KST_TIMEZONE })
  async drainPipeline(now: Date = new Date()): Promise<DrainCycleStatus> {
    // 이전 사이클이 아직 진행 중이면 겹치지 않도록 즉시 스킵(중복 AI 잡·DART fetch 방지).
    if (this.isDraining) {
      this.logger.warn('이전 드레인이 진행 중 — 이번 사이클 SKIPPED(겹침 방지)');
      return 'SKIPPED';
    }

    // DAR-392: 레이트리밋/쿼터 백오프 쿨다운 중이면 이번 사이클 건너뜀(회복 대기).
    const nowMs = this.nowMs();
    if (nowMs < this.cooldownUntilMs) {
      const remainingSec = Math.ceil((this.cooldownUntilMs - nowMs) / 1000);
      this.logger.warn(
        `레이트리밋 백오프 중 — 이번 사이클 COOLDOWN(약 ${remainingSec}s 후 재개)`,
      );
      return 'COOLDOWN';
    }

    // ★주의: 첫 await 이전에 동기적으로 락을 잡아야 겹친 cron 이 가드를 통과하지 못한다.
    this.isDraining = true;

    // DAR-503: 헤비 수집 창(기본 주말)이면 전체 범위, 주중이면 최근 7일 경량 세이프티넷.
    const heavy = isHeavyCollectionWindow(now);
    const scope = heavy
      ? undefined
      : { sinceCreatedAt: new Date(now.getTime() - WEEKDAY_DRAIN_LOOKBACK_MS) };
    this.logger.log(
      `파이프라인 폐루프 드레인 스케줄러 실행(${heavy ? '전체 범위' : '주중 경량·최근 7일'})`,
    );

    const run = () => this.pipeline.drainOnce(DRAIN_BATCH, scope);

    try {
      let result: PipelineDrainResult;
      if (!this.recorder) {
        result = await run();
      } else {
        // DAR-110 연계: 마지막 성공시각/처리건수 기록(신선도 판정 입력).
        // itemCount = 이번 사이클에서 전진(파싱 성공 + 이벤트 성공/검토)시킨 총 건수.
        result = await this.recorder.record(CRON_JOB_KEYS.PIPELINE_DRAIN, run, {
          countOf: (r) => r.parse.success + r.events.success + r.events.needsReview,
        });
      }
      // DAR-392: 파싱 실패율로 레이트리밋/쿼터를 추정해 적응형 쿨다운을 갱신한다.
      this.assessBackoff(result);
      return 'RAN';
    } catch (error) {
      this.logger.error('폐루프 드레인 스케줄러 오류', error);
      return 'RAN';
    } finally {
      // 성공·실패 무관 락 해제 — 다음 cron 이 정상 진입할 수 있어야 한다.
      this.isDraining = false;
    }
  }

  /**
   * DAR-392 적응형 백오프 판정.
   * 충분한 파싱 표본(≥MIN_SAMPLES_FOR_BACKOFF)에서 실패율이 HIGH_FAILURE_RATE 이상이면
   * 레이트리밋/쿼터로 보고 쿨다운을 지수 증가시킨다. 건강한 사이클이면 즉시 리셋한다.
   * 표본이 적으면(큐 거의 빔) 정상 idle 로 보고 백오프하지 않는다.
   */
  private assessBackoff(result: PipelineDrainResult): void {
    const attempts = result.parse.success + result.parse.failed;
    if (attempts < MIN_SAMPLES_FOR_BACKOFF) {
      // 시도 표본 부족 = 큐 거의 빔(정상 idle). 레이트리밋 신호 아님.
      this.consecutiveHighFailureCycles = 0;
      return;
    }

    const failureRate = result.parse.failed / attempts;
    if (failureRate >= HIGH_FAILURE_RATE) {
      this.consecutiveHighFailureCycles += 1;
      const backoffMs = Math.min(
        BASE_COOLDOWN_MS * 2 ** (this.consecutiveHighFailureCycles - 1),
        MAX_COOLDOWN_MS,
      );
      this.cooldownUntilMs = this.nowMs() + backoffMs;
      this.logger.warn(
        `파싱 실패율 ${(failureRate * 100).toFixed(0)}% (${result.parse.failed}/${attempts}) ` +
          `— DART 레이트리밋/쿼터 의심. 백오프 ${Math.round(backoffMs / 1000)}s ` +
          `(연속 고실패 ${this.consecutiveHighFailureCycles}회).`,
      );
    } else {
      // 회복 — 백오프 해제.
      if (this.consecutiveHighFailureCycles > 0) {
        this.logger.log(
          `파싱 실패율 회복 ${(failureRate * 100).toFixed(0)}% — 백오프 해제.`,
        );
      }
      this.consecutiveHighFailureCycles = 0;
      this.cooldownUntilMs = 0;
    }
  }

  /** 현재 시각(ms). 테스트 결정론을 위해 분리(jest.spyOn 으로 대체). */
  private nowMs(): number {
    return Date.now();
  }
}
