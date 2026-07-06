import { BiweeklyTrackReviewService, describeRegime, parseSimPortfolioTrack, rankTracks, renderReviewBody, reviewWindowStart, summarizeTrackTrades, TRACK_REVIEW_LOW_SAMPLE_THRESHOLD, TRACK_REVIEW_WINDOW_DAYS } from './biweekly-track-review.service';
import { MarketRegimeService } from '../engine5-trading-risk/paper-simulation/persona/market-regime.service';
import { MarketRegime } from '../engine5-trading-risk/paper-simulation/persona/market-regime';
import { PrismaService } from '../prisma/prisma.service';
import { TrackReviewSummary } from './biweekly-track-review.types';

/**
 * 격주 트랙 성과 순위 리포트 — 서비스 단위 테스트.
 * 결정론: now 주입 + prisma/regime mock. read-only 집계라 부작용 0.
 */
describe('BiweeklyTrackReview (service)', () => {
  // 2026-07-12(일) 10:00 KST = 01:00 UTC — 격주 앵커 일요일.
  const NOW = new Date('2026-07-12T01:00:00.000Z');
  // 트레일링 14일 윈도 시작 — 2026-06-29(월) 00:00 KST.
  const WINDOW_START = new Date('2026-06-29T00:00:00+09:00');

  const MS_PER_DAY = 24 * 60 * 60 * 1000;

  function makeRegime(over: Partial<MarketRegime> = {}): MarketRegime {
    return {
      trend: 'UPTREND',
      volatility: 'NORMAL',
      eventSkew: 'OPPORTUNITY',
      trendChangePct: 4.27,
      dailyVolatilityPct: 0.9,
      indexSampleSize: 40,
      eventSampleSize: 120,
      eventPolarity: { positive: 80, negative: 20, mixed: 10, unknown: 10 },
      classifiable: true,
      dataLimited: false,
      asOf: '20260710',
      ...over,
    };
  }

  // ─── 순수 함수: 14일 윈도 경계 ─────────────────────────────────────────────

  describe('reviewWindowStart — 트레일링 14일(캘린더, KST) 경계', () => {
    it('시작 = 생성일 KST 자정 − 13일(생성일 포함 14일)', () => {
      expect(reviewWindowStart(NOW).toISOString()).toBe(WINDOW_START.toISOString());
    });

    it('윈도 길이 — 시작일~생성일이 정확히 14 캘린더 일(포함 경계)', () => {
      const start = reviewWindowStart(NOW);
      const kstMidnight = new Date('2026-07-12T00:00:00+09:00');
      expect((kstMidnight.getTime() - start.getTime()) / MS_PER_DAY).toBe(
        TRACK_REVIEW_WINDOW_DAYS - 1,
      );
    });

    it('UTC 새벽(KST 당일)에도 KST 캘린더로 고정 — 시스템 TZ 비의존', () => {
      // 2026-07-11 23:30 KST = 14:30 UTC → 생성일은 KST 7/11, 시작은 6/28 00:00 KST.
      const kstNight = new Date('2026-07-11T14:30:00.000Z');
      expect(reviewWindowStart(kstNight).toISOString()).toBe(
        new Date('2026-06-28T00:00:00+09:00').toISOString(),
      );
    });
  });

  // ─── 순수 함수: 트랙 정체성 파싱 ────────────────────────────────────────────

  describe('parseSimPortfolioTrack — 포트폴리오 이름 규약 → 트랙', () => {
    it('시스템 모의(정확 일치)', () => {
      const t = parseSimPortfolioTrack('모의운용 포트폴리오');
      expect(t).toEqual({
        trackKey: 'paper-simulation',
        label: '시스템 모의',
        initialCapitalKrw: 10_000_000,
      });
    });

    it('철학 4종 — [BUFFETT] 등 스타일 suffix', () => {
      const t = parseSimPortfolioTrack('모의운용 포트폴리오 [BUFFETT]');
      expect(t?.trackKey).toBe('BUFFETT');
      expect(t?.label).toBe('철학 버핏');
      expect(t?.initialCapitalKrw).toBe(10_000_000);
    });

    it('전략 forward — [strategy:<key>] suffix(키 동적 수집·프리셋 라벨)', () => {
      const t = parseSimPortfolioTrack('모의운용 포트폴리오 [strategy:event-edge]');
      expect(t?.trackKey).toBe('strategy:event-edge');
      expect(t?.label).toBe('전략 이벤트엣지');
      const unknownKey = parseSimPortfolioTrack('모의운용 포트폴리오 [strategy:new-key]');
      expect(unknownKey?.label).toBe('전략 new-key'); // 프리셋 밖 키는 키 그대로(정직)
    });

    it('알 수 없는 suffix·무관 이름은 null(오귀속 방지)', () => {
      expect(parseSimPortfolioTrack('모의운용 포트폴리오 [weird]')).toBeNull();
      expect(parseSimPortfolioTrack('기본 포트폴리오')).toBeNull();
      expect(parseSimPortfolioTrack('모의운용 포트폴리오 복사본')).toBeNull();
    });
  });

  // ─── 순수 함수: 트랙 요약·lowSample ────────────────────────────────────────

  describe('summarizeTrackTrades — 지표 산출·표본부족 정직 표기', () => {
    const identity = { trackKey: 't', label: '트랙', initialCapitalKrw: 10_000_000 };

    it('청산 건수·승률·실현손익·수익률·평균 보유를 산출한다', () => {
      const s = summarizeTrackTrades(identity, [
        { netPnl: 100_000, holdDays: 2 },
        { netPnl: -50_000, holdDays: 4 },
        { netPnl: 200_000, holdDays: null }, // 보유 미산출 표본은 평균에서 제외
        { netPnl: 0, holdDays: 6 }, // 0 은 승리 아님
        { netPnl: 30_000, holdDays: 8 },
      ]);
      expect(s.closedTrades).toBe(5);
      expect(s.wins).toBe(3);
      expect(s.winRatePct).toBe(60);
      expect(s.realizedPnlKrw).toBe(280_000);
      expect(s.returnPct).toBe(2.8); // 280,000 / 10,000,000 × 100
      expect(s.avgHoldDays).toBe(5); // (2+4+6+8)/4
      expect(s.lowSample).toBe(false); // 5건 = 임계 이상
    });

    it('lowSample — 청산 < 5건이면 true, 5건이면 false(임계 경계)', () => {
      const four = summarizeTrackTrades(
        identity,
        Array.from({ length: TRACK_REVIEW_LOW_SAMPLE_THRESHOLD - 1 }, () => ({
          netPnl: 1000,
          holdDays: 1,
        })),
      );
      expect(four.lowSample).toBe(true);
      const five = summarizeTrackTrades(
        identity,
        Array.from({ length: TRACK_REVIEW_LOW_SAMPLE_THRESHOLD }, () => ({
          netPnl: 1000,
          holdDays: 1,
        })),
      );
      expect(five.lowSample).toBe(false);
    });

    it('청산 0건 안전 — 승률/평균보유 null(가짜 비율 금지)·수익률 0·lowSample', () => {
      const s = summarizeTrackTrades(identity, []);
      expect(s.closedTrades).toBe(0);
      expect(s.winRatePct).toBeNull();
      expect(s.avgHoldDays).toBeNull();
      expect(s.realizedPnlKrw).toBe(0);
      expect(s.returnPct).toBe(0);
      expect(s.lowSample).toBe(true);
    });
  });

  // ─── 순수 함수: 순위 ────────────────────────────────────────────────────────

  describe('rankTracks — 수익률 내림차순·lowSample 포함', () => {
    function bare(over: Partial<Omit<TrackReviewSummary, 'rank'>>): Omit<TrackReviewSummary, 'rank'> {
      return {
        trackKey: 'k',
        label: 'L',
        closedTrades: 10,
        wins: 5,
        winRatePct: 50,
        realizedPnlKrw: 0,
        initialCapitalKrw: 10_000_000,
        returnPct: 0,
        avgHoldDays: 1,
        lowSample: false,
        ...over,
      };
    }

    it('수익률 desc 순위 — lowSample 트랙도 순위에 두되 플래그 유지', () => {
      const ranked = rankTracks([
        bare({ trackKey: 'a', returnPct: -1.2 }),
        bare({ trackKey: 'b', returnPct: 5.5, closedTrades: 2, lowSample: true }),
        bare({ trackKey: 'c', returnPct: 2.1 }),
      ]);
      expect(ranked.map((t) => t.trackKey)).toEqual(['b', 'c', 'a']);
      expect(ranked.map((t) => t.rank)).toEqual([1, 2, 3]);
      expect(ranked[0].lowSample).toBe(true); // 배제 아님 — 정직 플래그로만
    });

    it('동률은 청산 건수 desc → trackKey asc(결정론)', () => {
      const ranked = rankTracks([
        bare({ trackKey: 'z', returnPct: 1, closedTrades: 3 }),
        bare({ trackKey: 'a', returnPct: 1, closedTrades: 3 }),
        bare({ trackKey: 'm', returnPct: 1, closedTrades: 9 }),
      ]);
      expect(ranked.map((t) => t.trackKey)).toEqual(['m', 'a', 'z']);
    });
  });

  // ─── 순수 함수: 본문 렌더 ──────────────────────────────────────────────────

  describe('renderReviewBody — 한국어 다이제스트(이모지 금지)', () => {
    function makeReview(tracks: TrackReviewSummary[], regime: MarketRegime | null) {
      return {
        generatedAt: NOW.toISOString(),
        periodStartKst: '2026-06-29',
        periodEndKst: '2026-07-12',
        windowDays: 14,
        regime,
        tracks,
      };
    }

    it('기간·시장국면·순위·표본부족을 표기하고 이모지를 쓰지 않는다', () => {
      const tracks = rankTracks([
        {
          trackKey: 'strategy:event-edge',
          label: '전략 이벤트엣지',
          closedTrades: 12,
          wins: 7,
          winRatePct: 58.3,
          realizedPnlKrw: 234_000,
          initialCapitalKrw: 10_000_000,
          returnPct: 2.34,
          avgHoldDays: 4.2,
          lowSample: false,
        },
        {
          trackKey: 'intraday-scalp',
          label: '분봉 단타',
          closedTrades: 2,
          wins: 1,
          winRatePct: 50,
          realizedPnlKrw: -12_000,
          initialCapitalKrw: 10_000_000,
          returnPct: -0.12,
          avgHoldDays: 0.02, // 1일 미만 → 분 단위 표기
          lowSample: true,
        },
      ]);
      const body = renderReviewBody(makeReview(tracks, makeRegime()));

      expect(body).toContain('격주 트랙 성과 리포트 (2026-06-29 ~ 2026-07-12 KST · 트레일링 14일)');
      expect(body).toContain('■ 시장국면: 상승추세 · 변동성 보통 · 공시분위기 호재우세');
      expect(body).toContain(
        ' 1. 전략 이벤트엣지: +2.34% (실현 +234,000원 · 청산 12건 · 승률 58.3% · 평균보유 4.2일)',
      );
      expect(body).toContain('2. 분봉 단타: -0.12%');
      expect(body).toContain('평균보유 29분'); // 0.02일 = 28.8분 반올림
      expect(body).toContain('[표본부족 2건]');
      // 이모지 0 — 알림 표기 개정(2026-07-06). ■·괄호 등 일반 텍스트만 허용.
      expect(body).not.toMatch(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}]/u);
    });

    it('트랙 0건·시장국면 판정 불가에도 골격을 렌더한다(graceful)', () => {
      const body = renderReviewBody(makeReview([], null));
      expect(body).toContain('■ 시장국면: (판정 불가)');
      expect(body).toContain('(집계 대상 트랙 없음)');
    });

    it('describeRegime — dataLimited 이면 [표본부족] 배지', () => {
      const line = describeRegime(makeRegime({ dataLimited: true, indexSampleSize: 12 }));
      expect(line).toContain('[표본부족]');
      expect(line).toContain('표본 12');
    });
  });

  // ─── 서비스: prisma mock 집계 ──────────────────────────────────────────────

  interface Fixtures {
    simUser?: { id: string } | null;
    portfolios?: Array<{ id: string; name: string }>;
    closedPositions?: Array<{
      portfolioId: string;
      unrealizedPnl: number | null;
      entryDate: Date;
      closedAt: Date | null;
    }>;
    scalpRows?: Array<{ netPnl: unknown; holdMinutes: number | null }>;
    dualRows?: Array<{ netPnl: unknown; entryTs: Date | null; exitTs: Date | null }>;
    positionReject?: boolean;
  }

  function makePrisma(fx: Fixtures) {
    return {
      user: { findFirst: jest.fn().mockResolvedValue(fx.simUser ?? { id: 'sim-user' }) },
      portfolio: { findMany: jest.fn().mockResolvedValue(fx.portfolios ?? []) },
      position: {
        findMany: fx.positionReject
          ? jest.fn().mockRejectedValue(new Error('db down'))
          : jest.fn().mockResolvedValue(fx.closedPositions ?? []),
      },
      intradayScalpTrade: { findMany: jest.fn().mockResolvedValue(fx.scalpRows ?? []) },
      dualMomentumForwardTrade: { findMany: jest.fn().mockResolvedValue(fx.dualRows ?? []) },
    } as unknown as PrismaService;
  }

  function makeService(fx: Fixtures, regime: MarketRegime | Error | null = makeRegime()) {
    const prisma = makePrisma(fx);
    const regimeService = {
      getCurrentRegime:
        regime instanceof Error
          ? jest.fn().mockRejectedValue(regime)
          : jest.fn().mockResolvedValue(regime),
    } as unknown as MarketRegimeService;
    return { service: new BiweeklyTrackReviewService(prisma, regimeService), prisma };
  }

  it('전 트랙(시스템·철학·전략·단타·듀얼모멘텀)을 집계하고 수익률 순위를 부여한다', async () => {
    const day = (ymd: string) => new Date(`${ymd}T10:00:00+09:00`);
    const { service } = makeService({
      portfolios: [
        { id: 'pf-sim', name: '모의운용 포트폴리오' },
        { id: 'pf-buffett', name: '모의운용 포트폴리오 [BUFFETT]' },
        { id: 'pf-edge', name: '모의운용 포트폴리오 [strategy:event-edge]' },
        { id: 'pf-unknown', name: '모의운용 포트폴리오 [weird]' }, // 미집계(오귀속 방지)
      ],
      closedPositions: [
        // 시스템 모의: +1.0% (2건 — lowSample)
        { portfolioId: 'pf-sim', unrealizedPnl: 60_000, entryDate: day('2026-06-30'), closedAt: day('2026-07-03') },
        { portfolioId: 'pf-sim', unrealizedPnl: 40_000, entryDate: day('2026-07-01'), closedAt: day('2026-07-08') },
        // 철학 버핏: -0.5% (1건)
        { portfolioId: 'pf-buffett', unrealizedPnl: -50_000, entryDate: day('2026-06-29'), closedAt: day('2026-07-10') },
        // 전략 이벤트엣지: +2.0% (5건 — 유의 표본)
        ...Array.from({ length: 5 }, (_, i) => ({
          portfolioId: 'pf-edge',
          unrealizedPnl: 40_000,
          entryDate: day('2026-07-01'),
          closedAt: day(`2026-07-0${i + 2}`),
        })),
      ],
      scalpRows: [
        { netPnl: 10_000, holdMinutes: 30 },
        { netPnl: -5_000, holdMinutes: 60 },
      ],
      dualRows: [{ netPnl: 120_000, entryTs: day('2026-07-01'), exitTs: day('2026-07-08') }],
    });

    const r = await service.buildReview(NOW);

    expect(r.periodStartKst).toBe('2026-06-29');
    expect(r.periodEndKst).toBe('2026-07-12');
    expect(r.windowDays).toBe(14);
    expect(r.regime?.trend).toBe('UPTREND');

    // 미지 suffix 트랙 제외 → 시스템+버핏+전략+단타+듀얼 = 5트랙.
    expect(r.tracks).toHaveLength(5);
    expect(r.tracks.map((t) => t.trackKey)).toEqual([
      'strategy:event-edge', // +2.0%
      'alloc:dual-momentum', // +1.2%
      'paper-simulation', // +1.0%
      'intraday-scalp', // +0.05%
      'BUFFETT', // -0.5%
    ]);
    expect(r.tracks.map((t) => t.rank)).toEqual([1, 2, 3, 4, 5]);

    const sim = r.tracks.find((t) => t.trackKey === 'paper-simulation');
    expect(sim).toMatchObject({
      closedTrades: 2,
      wins: 2,
      winRatePct: 100,
      realizedPnlKrw: 100_000,
      returnPct: 1,
      lowSample: true,
      avgHoldDays: 5, // (3+7)/2
    });
    const scalp = r.tracks.find((t) => t.trackKey === 'intraday-scalp');
    expect(scalp?.avgHoldDays).toBe(0.03); // (30+60)/2 분 = 45분 = 0.03125일 → 0.03
    const dual = r.tracks.find((t) => t.trackKey === 'alloc:dual-momentum');
    expect(dual).toMatchObject({ closedTrades: 1, realizedPnlKrw: 120_000, avgHoldDays: 7 });

    expect(r.body).toContain('1. 전략 이벤트엣지');
    expect(r.body).not.toMatch(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}]/u);
  });

  it('14일 윈도 경계를 쿼리에 강제한다 — closedAt/exitTs ∈ [시작 자정 KST, now] 포함 경계', async () => {
    const { service, prisma } = makeService({
      portfolios: [{ id: 'pf-sim', name: '모의운용 포트폴리오' }],
    });
    await service.buildReview(NOW);

    const p = prisma as unknown as {
      position: { findMany: jest.Mock };
      intradayScalpTrade: { findMany: jest.Mock };
      dualMomentumForwardTrade: { findMany: jest.Mock };
    };
    expect(p.position.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: 'CLOSED',
          closedAt: { gte: WINDOW_START, lte: NOW },
        }),
      }),
    );
    expect(p.intradayScalpTrade.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: 'CLOSED',
          exitTs: { gte: WINDOW_START, lte: NOW },
        }),
      }),
    );
    // 듀얼모멘텀은 exitDate(YYYYMMDD 문자열) 프리픽스 경계 — 같은 캘린더 의미론.
    expect(p.dualMomentumForwardTrade.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: 'CLOSED',
          exitDate: { gte: '20260629', lte: '20260712' },
        }),
      }),
    );
  });

  it('트랙 0건 안전 — sim 유저/포트폴리오 부재여도 단타·듀얼 0건 요약으로 골격 유지', async () => {
    const { service } = makeService({ simUser: null });
    const r = await service.buildReview(NOW);

    expect(r.tracks).toHaveLength(2); // 분봉 단타 + 듀얼모멘텀(0건 정직 표기)
    for (const t of r.tracks) {
      expect(t.closedTrades).toBe(0);
      expect(t.winRatePct).toBeNull();
      expect(t.lowSample).toBe(true);
    }
    expect(r.body).toContain('청산 0건');
  });

  it('집계·국면 실패는 graceful — Position 트랙 빈 목록·regime null, 리포트 골격 유지', async () => {
    const { service } = makeService(
      { portfolios: [{ id: 'pf-sim', name: '모의운용 포트폴리오' }], positionReject: true },
      new Error('regime down'),
    );
    const r = await service.buildReview(NOW);

    expect(r.regime).toBeNull();
    expect(r.tracks.map((t) => t.trackKey).sort()).toEqual([
      'alloc:dual-momentum',
      'intraday-scalp',
    ]);
    expect(r.body).toContain('■ 시장국면: (판정 불가)');
  });
});
