import { PipelineDrainScheduler } from './pipeline-drain.scheduler';
import { PipelineIntegrityService } from './pipeline-integrity.service';
import { CronRunRecorderService } from '../../cron-health/cron-run-recorder.service';
import { CRON_JOB_KEYS } from '../../cron-health/cron-health.jobs';
import { PipelineDrainResult } from './pipeline.types';

/** DAR-126 — 폐루프 드레인 cron 의 recorder 래핑·itemCount·throw 흡수 검증. */
describe('PipelineDrainScheduler (DAR-126)', () => {
  const drainResult: PipelineDrainResult = {
    enqueuedMissingDocuments: 1,
    parse: { success: 3, failed: 1, tradeRelevant: 3 },
    events: { success: 2, failed: 0, needsReview: 1 },
    durationMs: 10,
  };

  function makePipeline(impl?: () => Promise<PipelineDrainResult>) {
    return {
      drainOnce: jest
        .fn()
        .mockImplementation(impl ?? (() => Promise.resolve(drainResult))),
    } as unknown as PipelineIntegrityService;
  }

  it('recorder 로 PIPELINE_DRAIN 잡을 감싸고 전진건수를 itemCount 로 기록한다', async () => {
    const pipeline = makePipeline();
    const record = jest
      .fn()
      .mockImplementation(
        async (_key: string, fn: () => Promise<PipelineDrainResult>, opts: { countOf: (r: PipelineDrainResult) => number }) => {
          const r = await fn();
          // countOf = parse.success(3) + events.success(2) + needsReview(1) = 6
          expect(opts.countOf(r)).toBe(6);
          return r;
        },
      );
    const recorder = { record } as unknown as CronRunRecorderService;

    const scheduler = new PipelineDrainScheduler(pipeline, recorder);
    await scheduler.drainPipeline();

    expect(record).toHaveBeenCalledTimes(1);
    expect(record.mock.calls[0][0]).toBe(CRON_JOB_KEYS.PIPELINE_DRAIN);
    expect(pipeline.drainOnce).toHaveBeenCalled();
  });

  it('recorder 미주입 환경에서도 drainOnce 를 직접 실행한다', async () => {
    const pipeline = makePipeline();
    const scheduler = new PipelineDrainScheduler(pipeline);
    await scheduler.drainPipeline();
    expect(pipeline.drainOnce).toHaveBeenCalled();
  });

  it('drainOnce 가 throw 해도 스케줄러는 예외를 흡수한다(cron 유지)', async () => {
    const pipeline = makePipeline(() => Promise.reject(new Error('boom')));
    const scheduler = new PipelineDrainScheduler(pipeline);
    // 예외 흡수 후에도 사이클은 RAN 으로 종료(끝까지 진입했으므로 SKIPPED 아님).
    await expect(scheduler.drainPipeline()).resolves.toBe('RAN');
  });

  // ── DAR-229: 겹침 가드(in-flight 락) ──────────────────────────────
  it('드레인 진행 중 겹친 cron 은 즉시 SKIPPED — drainOnce 를 중복 호출하지 않는다', async () => {
    // 첫 드레인을 게이트로 in-flight 상태에 고정한다(release 전까지 미완).
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const pipeline = makePipeline(async () => {
      await gate;
      return drainResult;
    });
    const scheduler = new PipelineDrainScheduler(pipeline);

    // 1) 첫 사이클 시작 — drainOnce 진입 후 gate 에서 대기(미완).
    const first = scheduler.drainPipeline();
    await Promise.resolve(); // 마이크로태스크 flush → drainOnce 실제 호출 보장
    expect(pipeline.drainOnce).toHaveBeenCalledTimes(1);

    // 2) 겹친 사이클 — 즉시 SKIPPED, drainOnce 재호출 없음.
    await expect(scheduler.drainPipeline()).resolves.toBe('SKIPPED');
    expect(pipeline.drainOnce).toHaveBeenCalledTimes(1);

    // 3) 첫 사이클 완료 → 락 해제.
    release();
    await expect(first).resolves.toBe('RAN');

    // 4) 락 해제 후 다음 사이클은 정상 진입(drainOnce 2회째 호출).
    await expect(scheduler.drainPipeline()).resolves.toBe('RAN');
    expect(pipeline.drainOnce).toHaveBeenCalledTimes(2);
  });

  it('throw 로 끝난 사이클도 락을 해제해 다음 사이클이 진입한다(finally 보장)', async () => {
    const pipeline = makePipeline(() => Promise.reject(new Error('boom')));
    const scheduler = new PipelineDrainScheduler(pipeline);

    await expect(scheduler.drainPipeline()).resolves.toBe('RAN');
    // 직전 사이클이 예외로 끝났어도 isDraining 이 false 로 풀려 재진입 가능.
    await expect(scheduler.drainPipeline()).resolves.toBe('RAN');
    expect(pipeline.drainOnce).toHaveBeenCalledTimes(2);
  });

  // ── DAR-392: 적응형 레이트리밋 백오프 ──────────────────────────────
  /** 고실패(표본 충분) 결과 — parse.failed/(success+failed) ≥ 0.5, attempts ≥ 20. */
  const highFailureResult: PipelineDrainResult = {
    enqueuedMissingDocuments: 0,
    parse: { success: 10, failed: 40, tradeRelevant: 8 }, // 50 시도 중 80% 실패
    events: { success: 0, failed: 0, needsReview: 0 },
    durationMs: 100,
  };
  /** 건강한 결과(표본 충분, 저실패). */
  const healthyResult: PipelineDrainResult = {
    enqueuedMissingDocuments: 0,
    parse: { success: 48, failed: 2, tradeRelevant: 30 }, // 4% 실패
    events: { success: 5, failed: 0, needsReview: 1 },
    durationMs: 100,
  };

  it('파싱 고실패율(레이트리밋 의심) 사이클 후 다음 사이클을 COOLDOWN 으로 건너뛴다', async () => {
    const pipeline = makePipeline(() => Promise.resolve(highFailureResult));
    const scheduler = new PipelineDrainScheduler(pipeline);
    let t = 1_000_000;
    jest
      .spyOn(scheduler as unknown as { nowMs: () => number }, 'nowMs')
      .mockImplementation(() => t);

    // 1) 고실패 사이클 RAN → 쿨다운 설정.
    await expect(scheduler.drainPipeline()).resolves.toBe('RAN');
    expect(pipeline.drainOnce).toHaveBeenCalledTimes(1);

    // 2) 쿨다운 내(같은 시각) — COOLDOWN, drainOnce 재호출 없음.
    await expect(scheduler.drainPipeline()).resolves.toBe('COOLDOWN');
    expect(pipeline.drainOnce).toHaveBeenCalledTimes(1);

    // 3) 쿨다운 경과(+3분 > 1차 2분) — 다시 진입.
    t += 3 * 60_000;
    await expect(scheduler.drainPipeline()).resolves.toBe('RAN');
    expect(pipeline.drainOnce).toHaveBeenCalledTimes(2);
  });

  it('연속 고실패는 쿨다운을 지수 증가시킨다(2분→4분)', async () => {
    const pipeline = makePipeline(() => Promise.resolve(highFailureResult));
    const scheduler = new PipelineDrainScheduler(pipeline);
    let t = 0;
    jest
      .spyOn(scheduler as unknown as { nowMs: () => number }, 'nowMs')
      .mockImplementation(() => t);

    // 1차 고실패 → 쿨다운 2분.
    await scheduler.drainPipeline();
    // +2.5분 경과 → 1차(2분) 쿨다운 지나 재진입, 2차 고실패 → 쿨다운 4분.
    t = 2.5 * 60_000;
    await scheduler.drainPipeline();
    expect(pipeline.drainOnce).toHaveBeenCalledTimes(2);

    // +3분(누적 5.5분): 2차 쿨다운(4분, 즉 t≥6.5분)이 아직 안 지남 → COOLDOWN.
    t = 5.5 * 60_000;
    await expect(scheduler.drainPipeline()).resolves.toBe('COOLDOWN');
    expect(pipeline.drainOnce).toHaveBeenCalledTimes(2);
  });

  it('건강한 사이클은 백오프를 걸지 않는다(연속 진입)', async () => {
    const pipeline = makePipeline(() => Promise.resolve(healthyResult));
    const scheduler = new PipelineDrainScheduler(pipeline);
    const t = 0;
    jest
      .spyOn(scheduler as unknown as { nowMs: () => number }, 'nowMs')
      .mockImplementation(() => t);

    await expect(scheduler.drainPipeline()).resolves.toBe('RAN');
    await expect(scheduler.drainPipeline()).resolves.toBe('RAN');
    expect(pipeline.drainOnce).toHaveBeenCalledTimes(2);
  });

  it('고실패 후 건강 사이클이 오면 백오프가 해제된다', async () => {
    let result: PipelineDrainResult = highFailureResult;
    const pipeline = makePipeline(() => Promise.resolve(result));
    const scheduler = new PipelineDrainScheduler(pipeline);
    let t = 0;
    jest
      .spyOn(scheduler as unknown as { nowMs: () => number }, 'nowMs')
      .mockImplementation(() => t);

    // 고실패 → 쿨다운 2분.
    await scheduler.drainPipeline();
    // 쿨다운 경과 후 건강 사이클 → 백오프 해제(cooldownUntil=0).
    t = 3 * 60_000;
    result = healthyResult;
    await expect(scheduler.drainPipeline()).resolves.toBe('RAN');
    // 직후 같은 시각에 또 진입 가능(쿨다운 해제 확인).
    await expect(scheduler.drainPipeline()).resolves.toBe('RAN');
    expect(pipeline.drainOnce).toHaveBeenCalledTimes(3);
  });

  it('표본 부족(큐 거의 빔)은 실패율이 높아도 백오프하지 않는다', async () => {
    // attempts = 2 + 3 = 5 < MIN_SAMPLES_FOR_BACKOFF(20) → 정상 idle 로 간주.
    const sparse: PipelineDrainResult = {
      enqueuedMissingDocuments: 0,
      parse: { success: 2, failed: 3, tradeRelevant: 2 },
      events: { success: 0, failed: 0, needsReview: 0 },
      durationMs: 10,
    };
    const pipeline = makePipeline(() => Promise.resolve(sparse));
    const scheduler = new PipelineDrainScheduler(pipeline);
    const t = 0;
    jest
      .spyOn(scheduler as unknown as { nowMs: () => number }, 'nowMs')
      .mockImplementation(() => t);

    await expect(scheduler.drainPipeline()).resolves.toBe('RAN');
    await expect(scheduler.drainPipeline()).resolves.toBe('RAN');
    expect(pipeline.drainOnce).toHaveBeenCalledTimes(2);
  });

  // ── DAR-503: 주중/주말 이원화 조회 범위 ──────────────────────────
  describe('DAR-503 헤비 창 이원화', () => {
    // KST 벽시계 기준 결정론 시각(TZ 무관).
    const WEEKEND = new Date('2026-07-04T03:00:00Z'); // KST 토 12:00
    const WEEKDAY = new Date('2026-07-06T03:00:00Z'); // KST 월 12:00
    // 라이브 파싱 기아 장애 후속: 주중 자가 회복 창 2일→7일 확대.
    const SEVEN_DAYS_MS = 7 * 24 * 60 * 60_000;

    it('주말(헤비 창)은 전체 범위 — scope 미지정(undefined)로 drainOnce 호출', async () => {
      const pipeline = makePipeline();
      const scheduler = new PipelineDrainScheduler(pipeline);

      await expect(scheduler.drainPipeline(WEEKEND)).resolves.toBe('RAN');
      // drainOnce(limit, scope) — 주말은 scope=undefined(전체 범위, 기존 거동).
      const call = (pipeline.drainOnce as jest.Mock).mock.calls[0];
      expect(call[1]).toBeUndefined();
    });

    it('주중(헤비 창 밖)은 최근 7일 범위 — sinceCreatedAt 로 scope 지정', async () => {
      const pipeline = makePipeline();
      const scheduler = new PipelineDrainScheduler(pipeline);

      await expect(scheduler.drainPipeline(WEEKDAY)).resolves.toBe('RAN');
      const call = (pipeline.drainOnce as jest.Mock).mock.calls[0];
      expect(call[1]).toEqual({
        sinceCreatedAt: new Date(WEEKDAY.getTime() - SEVEN_DAYS_MS),
      });
    });

    it('주중에도 매 사이클 RAN(SUCCESS 기록) — freshness 유지(WINDOW_SKIPPED 아님)', async () => {
      const pipeline = makePipeline();
      const scheduler = new PipelineDrainScheduler(pipeline);
      // 파이프라인 드레인은 창 밖이어도 정지하지 않고 경량 세이프티넷으로 계속 돈다.
      await expect(scheduler.drainPipeline(WEEKDAY)).resolves.toBe('RAN');
      expect(pipeline.drainOnce).toHaveBeenCalledTimes(1);
    });
  });
});
