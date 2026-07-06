import {
  BiweeklyTrackReviewScheduler,
  isReviewSunday,
  reviewCycleNo,
  TRACK_REVIEW_ANCHOR_SUNDAY_YMD,
} from './biweekly-track-review.scheduler';
import { BiweeklyTrackReviewService } from './biweekly-track-review.service';
import { NotificationProducerService } from '../notifications/notification-producer.service';
import { CronRunRecorderService } from '../cron-health/cron-run-recorder.service';
import { CRON_JOB_KEYS } from '../cron-health/cron-health.jobs';
import { BiweeklyTrackReview } from './biweekly-track-review.types';

/**
 * 격주 트랙 성과 리포트 스케줄러 — 격주 게이트(결정론)·발송 배선·CronRunLog 기록·겹침 가드 검증.
 */
describe('BiweeklyTrackReviewScheduler', () => {
  // 앵커 일요일(2026-07-12) 10:00 KST = 01:00 UTC — 리포트 주.
  const REVIEW_SUNDAY = new Date('2026-07-12T01:00:00.000Z');
  // 다음 일요일(2026-07-19) — 오프 주.
  const OFF_SUNDAY = new Date('2026-07-19T01:00:00.000Z');

  // ─── 순수 함수: 격주 게이트 ────────────────────────────────────────────────

  describe('isReviewSunday — 앵커 기준 짝수 주차 일요일만 true', () => {
    it('앵커 일요일(20260712) 자신은 true(0주차 = 짝수)', () => {
      expect(isReviewSunday(TRACK_REVIEW_ANCHOR_SUNDAY_YMD)).toBe(true);
    });

    it('앵커 +1주(20260719)는 false, +2주(20260726)는 true — 짝홀 교대', () => {
      expect(isReviewSunday('20260719')).toBe(false);
      expect(isReviewSunday('20260726')).toBe(true);
      expect(isReviewSunday('20260802')).toBe(false);
      expect(isReviewSunday('20260809')).toBe(true);
    });

    it('앵커 이전 일요일도 동일 위상 — −1주(20260705) false, −2주(20260628) true', () => {
      expect(isReviewSunday('20260705')).toBe(false);
      expect(isReviewSunday('20260628')).toBe(true);
    });

    it('일요일이 아니면 false(요일 게이트)', () => {
      expect(isReviewSunday('20260713')).toBe(false); // 월
      expect(isReviewSunday('20260711')).toBe(false); // 토
    });

    it('형식 불량·존재하지 않는 날짜는 false(방어적 거부)', () => {
      expect(isReviewSunday('2026-07-12')).toBe(false);
      expect(isReviewSunday('abcdefgh')).toBe(false);
      expect(isReviewSunday('20260230')).toBe(false); // 2/30 롤오버 거부
      expect(isReviewSunday('')).toBe(false);
    });
  });

  describe('reviewCycleNo — 앵커 기준 회차(멱등 dedupe 버킷)', () => {
    it('앵커 = 0, 2주마다 +1(이전은 음수)', () => {
      expect(reviewCycleNo(TRACK_REVIEW_ANCHOR_SUNDAY_YMD)).toBe(0);
      expect(reviewCycleNo('20260726')).toBe(1);
      expect(reviewCycleNo('20260809')).toBe(2);
      expect(reviewCycleNo('20260628')).toBe(-1);
    });

    it('형식 불량은 null', () => {
      expect(reviewCycleNo('bad')).toBeNull();
    });
  });

  // ─── 스케줄러 배선 ─────────────────────────────────────────────────────────

  function makeReview(over: Partial<BiweeklyTrackReview> = {}): BiweeklyTrackReview {
    return {
      generatedAt: REVIEW_SUNDAY.toISOString(),
      periodStartKst: '2026-06-29',
      periodEndKst: '2026-07-12',
      windowDays: 14,
      regime: null,
      tracks: [
        {
          trackKey: 'paper-simulation',
          label: '시스템 모의',
          closedTrades: 6,
          wins: 4,
          winRatePct: 66.7,
          realizedPnlKrw: 120_000,
          initialCapitalKrw: 10_000_000,
          returnPct: 1.2,
          avgHoldDays: 4.5,
          lowSample: false,
          rank: 1,
        },
      ],
      body: '격주 트랙 성과 리포트 (2026-06-29 ~ 2026-07-12 KST · 트레일링 14일)\n...',
      ...over,
    };
  }

  function makeDeps(review: BiweeklyTrackReview, buildImpl?: () => Promise<BiweeklyTrackReview>) {
    const reviewService = {
      buildReview: jest.fn().mockImplementation(buildImpl ?? (() => Promise.resolve(review))),
    } as unknown as BiweeklyTrackReviewService;
    const enqueueOpsAlert = jest.fn().mockResolvedValue(undefined);
    const producer = { enqueueOpsAlert } as unknown as NotificationProducerService;
    // recorder.record 는 fn 을 실제 호출해 통과시킨다(래핑 검증용).
    const record = jest.fn().mockImplementation((_key: string, fn: () => Promise<unknown>) => fn());
    const recordSkip = jest.fn().mockResolvedValue(undefined);
    const recorder = { record, recordSkip } as unknown as CronRunRecorderService;
    return { reviewService, producer, enqueueOpsAlert, recorder, record, recordSkip };
  }

  it('리포트 주 일요일 — 생성·OPS_ALERT 발송(회차 dedupe·딥링크)·CronRunLog 기록', async () => {
    const review = makeReview();
    const { reviewService, producer, enqueueOpsAlert, recorder, record } = makeDeps(review);
    const scheduler = new BiweeklyTrackReviewScheduler(reviewService, producer, recorder);

    const result = await scheduler.runWeekly(REVIEW_SUNDAY);

    expect(result).toBe(review);
    expect(record).toHaveBeenCalledWith(
      CRON_JOB_KEYS.BIWEEKLY_TRACK_REVIEW,
      expect.any(Function),
      expect.objectContaining({ countOf: expect.any(Function) }),
    );
    expect(enqueueOpsAlert).toHaveBeenCalledTimes(1);
    expect(enqueueOpsAlert).toHaveBeenCalledWith(
      'INFO',
      'biweekly-track-review',
      review.body,
      expect.objectContaining({
        dedupeKey: 'biweekly-track-review:0', // 앵커 기준 회차 버킷(2026-07-12 = 0회차)
        deepLink: '/portfolio',
        data: expect.objectContaining({
          periodStartKst: '2026-06-29',
          periodEndKst: '2026-07-12',
          topTracks: [
            { trackKey: 'paper-simulation', returnPct: 1.2, lowSample: false },
          ],
        }),
      }),
    );
  });

  it('오프 주 일요일 — 격주 게이트 스킵: 발송 0·SKIPPED 기록·null 반환', async () => {
    const review = makeReview();
    const { reviewService, producer, enqueueOpsAlert, recorder, record, recordSkip } =
      makeDeps(review);
    const scheduler = new BiweeklyTrackReviewScheduler(reviewService, producer, recorder);

    const result = await scheduler.runWeekly(OFF_SUNDAY);

    expect(result).toBeNull();
    expect(enqueueOpsAlert).not.toHaveBeenCalled();
    expect(record).not.toHaveBeenCalled();
    expect(recordSkip).toHaveBeenCalledWith(CRON_JOB_KEYS.BIWEEKLY_TRACK_REVIEW);
    expect(
      (reviewService as unknown as { buildReview: jest.Mock }).buildReview,
    ).not.toHaveBeenCalled();
  });

  it('recorder 미주입(테스트/큐 비활성) 환경에서도 발송한다', async () => {
    const review = makeReview();
    const { reviewService, producer, enqueueOpsAlert } = makeDeps(review);
    const scheduler = new BiweeklyTrackReviewScheduler(reviewService, producer, undefined);

    const result = await scheduler.runWeekly(REVIEW_SUNDAY);
    expect(result).toBe(review);
    expect(enqueueOpsAlert).toHaveBeenCalledTimes(1);

    // 오프 주도 recorder 없이 안전(옵셔널 체이닝).
    await expect(scheduler.runWeekly(OFF_SUNDAY)).resolves.toBeNull();
  });

  it('겹침 가드 — 진행 중이면 다음 사이클을 스킵(중복 발송 방지)', async () => {
    let release!: (r: BiweeklyTrackReview) => void;
    const pending = new Promise<BiweeklyTrackReview>((res) => {
      release = res;
    });
    const review = makeReview();
    const { reviewService, producer, enqueueOpsAlert, recorder } = makeDeps(review, () => pending);
    const scheduler = new BiweeklyTrackReviewScheduler(reviewService, producer, recorder);

    const first = scheduler.runWeekly(REVIEW_SUNDAY); // 락 잡고 대기
    const second = await scheduler.runWeekly(REVIEW_SUNDAY); // 겹침 → 즉시 null
    expect(second).toBeNull();

    release(review);
    await first;
    expect(enqueueOpsAlert).toHaveBeenCalledTimes(1); // 첫 사이클만 발송
  });

  it('생성 실패해도 throw 하지 않고 null 반환·락 해제(cron 유지)', async () => {
    const review = makeReview();
    let call = 0;
    const { reviewService, producer, enqueueOpsAlert, recorder } = makeDeps(review, () => {
      call += 1;
      if (call === 1) return Promise.reject(new Error('boom'));
      return Promise.resolve(review);
    });
    const scheduler = new BiweeklyTrackReviewScheduler(reviewService, producer, recorder);

    const failed = await scheduler.runWeekly(REVIEW_SUNDAY);
    expect(failed).toBeNull(); // 예외 흡수
    expect(enqueueOpsAlert).not.toHaveBeenCalled();

    // 락이 풀렸으므로 다음 사이클은 정상 발송.
    const ok = await scheduler.runWeekly(REVIEW_SUNDAY);
    expect(ok).toBe(review);
    expect(enqueueOpsAlert).toHaveBeenCalledTimes(1);
  });
});
