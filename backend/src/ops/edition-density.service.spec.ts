import { PrismaService } from '../prisma/prisma.service';
import {
  EditionDensityService,
  buildHistogram,
  buildVerdict,
  clampWindowDays,
  computeDensityStats,
  enumerateTradingDays,
  meanOf,
  medianOfSorted,
  percentileNearestRank,
  resolveAnchorEnd,
  roundTo,
} from './edition-density.service';

/**
 * DAR-513 에디션 밀도 실측 — 결정론적 단위 테스트(DB 무관, 순수 함수 + 모킹).
 */
describe('edition-density 순수 함수', () => {
  it('roundTo — 반올림·비유한 방어', () => {
    expect(roundTo(1.2, 2)).toBe(1.2);
    expect(roundTo(0.6666, 4)).toBe(0.6666);
    expect(roundTo(2 / 3, 2)).toBe(0.67);
    expect(roundTo(NaN, 2)).toBe(0);
    expect(roundTo(Infinity, 2)).toBe(0);
  });

  it('meanOf — 빈 배열 0', () => {
    expect(meanOf([])).toBe(0);
    expect(meanOf([2, 0, 1, 0, 3])).toBeCloseTo(1.2, 10);
  });

  it('medianOfSorted — 홀/짝/빈', () => {
    expect(medianOfSorted([])).toBe(0);
    expect(medianOfSorted([0, 0, 1, 2, 3])).toBe(1); // 홀수 → 가운데
    expect(medianOfSorted([0, 0, 4, 4])).toBe(2); // 짝수 → 두 중앙 평균
    expect(medianOfSorted([2, 2])).toBe(2);
  });

  it('percentileNearestRank — nearest-rank·빈배열 0', () => {
    expect(percentileNearestRank([], 50)).toBe(0);
    const s = [0, 0, 1, 2, 3];
    expect(percentileNearestRank(s, 25)).toBe(0); // ceil(1.25)=2 → idx1
    expect(percentileNearestRank(s, 75)).toBe(2); // ceil(3.75)=4 → idx3
    expect(percentileNearestRank(s, 100)).toBe(3);
  });

  it('buildHistogram — 고정 6버킷·0 항상 노출', () => {
    const h = buildHistogram([0, 0, 1, 2, 3, 4, 5, 10, 11]);
    expect(h.map((b) => b.bucket)).toEqual(['0', '1', '2', '3-4', '5-9', '10+']);
    const by = Object.fromEntries(h.map((b) => [b.bucket, b.days]));
    expect(by['0']).toBe(2);
    expect(by['1']).toBe(1);
    expect(by['2']).toBe(1);
    expect(by['3-4']).toBe(2); // 3,4
    expect(by['5-9']).toBe(1); // 5
    expect(by['10+']).toBe(2); // 10,11
  });

  it('computeDensityStats — 대표 분포', () => {
    const s = computeDensityStats([2, 0, 1, 0, 3]);
    expect(s.days).toBe(5);
    expect(s.totalSignals).toBe(6);
    expect(s.mean).toBe(1.2);
    expect(s.median).toBe(1);
    expect(s.min).toBe(0);
    expect(s.max).toBe(3);
    expect(s.p25).toBe(0);
    expect(s.p75).toBe(2);
    expect(s.zeroDays).toBe(2);
    expect(s.zeroDayRatio).toBe(0.4);
  });

  it('computeDensityStats — 빈 배열 안전', () => {
    const s = computeDensityStats([]);
    expect(s).toMatchObject({ days: 0, totalSignals: 0, mean: 0, median: 0, min: 0, max: 0, zeroDays: 0, zeroDayRatio: 0 });
  });

  it('clampWindowDays — 기본/하한/상한/비숫자', () => {
    expect(clampWindowDays(undefined)).toBe(60);
    expect(clampWindowDays(0)).toBe(60);
    expect(clampWindowDays(-5)).toBe(60);
    expect(clampWindowDays(NaN)).toBe(60);
    expect(clampWindowDays(30)).toBe(30);
    expect(clampWindowDays(1)).toBe(1);
    expect(clampWindowDays(999)).toBe(120);
    expect(clampWindowDays(60)).toBe(60);
  });
});

describe('buildVerdict — 수용기준 2 판정(중앙값<2 또는 0건일>40%)', () => {
  it('중앙값<2 트리거(0건일 경계 0.4 는 미트리거)', () => {
    const v = buildVerdict(computeDensityStats([2, 0, 1, 0, 3])); // median 1, zero 0.4
    expect(v.medianBelowThreshold).toBe(true);
    expect(v.zeroDayRatioAboveThreshold).toBe(false); // 0.4 > 0.4 == false(엄격 초과)
    expect(v.fallbackProposalTriggered).toBe(true);
    expect(v.proposalDoc).toContain('cc-edition-density-fallback-proposal');
  });

  it('0건일>40% 만 트리거(중앙값 경계 2 는 미트리거)', () => {
    // 10일: 0×5, 4×5 → median=(0+4)/2=2(미만 아님), zeroRatio=0.5(>0.4)
    const v = buildVerdict(computeDensityStats([0, 0, 0, 0, 0, 4, 4, 4, 4, 4]));
    expect(v.medianBelowThreshold).toBe(false); // 2 < 2 == false
    expect(v.zeroDayRatioAboveThreshold).toBe(true);
    expect(v.fallbackProposalTriggered).toBe(true);
  });

  it('둘 다 미달 → 미트리거', () => {
    const v = buildVerdict(computeDensityStats([3, 3, 3, 3, 0])); // median 3, zero 0.2
    expect(v.medianBelowThreshold).toBe(false);
    expect(v.zeroDayRatioAboveThreshold).toBe(false);
    expect(v.fallbackProposalTriggered).toBe(false);
    expect(v.summary).toContain('폴백 불요');
  });

  it('둘 다 트리거', () => {
    const v = buildVerdict(computeDensityStats([0, 0, 0, 5, 5])); // median 0, zero 0.6
    expect(v.medianBelowThreshold).toBe(true);
    expect(v.zeroDayRatioAboveThreshold).toBe(true);
    expect(v.fallbackProposalTriggered).toBe(true);
  });
});

describe('resolveAnchorEnd — 완료 거래일 앵커(19:15 KST 규칙)', () => {
  it('거래일 19:15 이후 → 오늘 포함', () => {
    // 2026-07-17(금) KST 20:00 = UTC 11:00
    const r = resolveAnchorEnd(new Date('2026-07-17T11:00:00Z'));
    expect(r.todayDate).toBe('20260717');
    expect(r.anchorEnd).toBe('20260717');
    expect(r.todayIncluded).toBe(true);
  });

  it('거래일 19:15 이전 → 직전 거래일(오늘 미완료 제외)', () => {
    // 2026-07-17(금) KST 10:00 = UTC 01:00
    const r = resolveAnchorEnd(new Date('2026-07-17T01:00:00Z'));
    expect(r.todayDate).toBe('20260717');
    expect(r.anchorEnd).toBe('20260716'); // 목
    expect(r.todayIncluded).toBe(false);
  });

  it('19:15 경계 정각 → 포함', () => {
    // KST 19:15 = UTC 10:15
    const r = resolveAnchorEnd(new Date('2026-07-17T10:15:00Z'));
    expect(r.anchorEnd).toBe('20260717');
    expect(r.todayIncluded).toBe(true);
  });

  it('주말 → 직전 거래일(금)', () => {
    // 2026-07-18(토) KST 20:00
    const r = resolveAnchorEnd(new Date('2026-07-18T11:00:00Z'));
    expect(r.todayDate).toBe('20260718');
    expect(r.anchorEnd).toBe('20260717'); // 금
    expect(r.todayIncluded).toBe(false);
  });

  it('공휴일(대체공휴일) → 직전 거래일', () => {
    // 2026-08-17(월, 광복절 대체공휴일) KST 20:00 → 직전 거래일 8/14(금)
    const r = resolveAnchorEnd(new Date('2026-08-17T11:00:00Z'));
    expect(r.todayDate).toBe('20260817');
    expect(r.anchorEnd).toBe('20260814');
    expect(r.todayIncluded).toBe(false);
  });
});

describe('enumerateTradingDays — 캘린더 SSOT 열거(주말·공휴일 제외)', () => {
  it('5거래일: 주말 스킵·오름차순', () => {
    // anchorEnd 20260717(금) → 20260713,14,15,16,17 (7/11토·7/12일 스킵)
    expect(enumerateTradingDays('20260717', 5)).toEqual([
      '20260713',
      '20260714',
      '20260715',
      '20260716',
      '20260717',
    ]);
  });

  it('주말 경계: 월요일 직전은 금요일', () => {
    // 20260713(월) 2거래일 → [20260710(금), 20260713(월)]
    expect(enumerateTradingDays('20260713', 2)).toEqual(['20260710', '20260713']);
  });

  it('공휴일 스킵: 3/2(대체공휴일) 넘어감', () => {
    // 20260303(화) 부터 3거래일: 3/3, 3/2는 대체공휴일→스킵, 2/27(금)
    // 3/2(월) 휴장 → [20260227, 20260303] 사이 3/2 없음. 3거래일 = 2/26,2/27,3/3
    const days = enumerateTradingDays('20260303', 3);
    expect(days).toEqual(['20260226', '20260227', '20260303']);
    expect(days).not.toContain('20260302');
  });

  it('전부 거래일이며 요청 개수만큼 반환', () => {
    const days = enumerateTradingDays('20260717', 60);
    expect(days).toHaveLength(60);
    // 오름차순 · 마지막이 anchorEnd
    expect(days[days.length - 1]).toBe('20260717');
    for (let i = 1; i < days.length; i++) expect(days[i] > days[i - 1]).toBe(true);
  });
});

describe('EditionDensityService.getEditionDensity — 통합(모킹)', () => {
  interface MockPrisma {
    $queryRaw: jest.Mock;
    stockDailyPrice: { findMany: jest.Mock };
  }
  let prisma: MockPrisma;
  let service: EditionDensityService;

  const NOW = new Date('2026-07-17T11:00:00Z'); // 금 KST 20:00 → anchorEnd=20260717 포함

  beforeEach(() => {
    prisma = {
      // 20260716·20260714 는 행 없음(신호 0건일) → 호출부에서 0 채움
      $queryRaw: jest.fn().mockResolvedValue([
        { date: '20260717', totalCount: BigInt(5), buyCount: BigInt(3) },
        { date: '20260715', totalCount: BigInt(4), buyCount: BigInt(1) },
        { date: '20260713', totalCount: BigInt(2), buyCount: BigInt(2) },
      ]),
      stockDailyPrice: {
        findMany: jest.fn().mockResolvedValue([
          { tradeDate: '20260713' },
          { tradeDate: '20260714' },
          { tradeDate: '20260715' },
          { tradeDate: '20260716' },
          { tradeDate: '20260717' },
        ]),
      },
    };
    service = new EditionDensityService(prisma as unknown as PrismaService);
  });

  it('윈도·앵커·daily 구성(최신 우선, 0건일 채움)', async () => {
    const r = await service.getEditionDensity(5, NOW);
    expect(r.windowTradingDays).toBe(5);
    expect(r.anchorEndDate).toBe('20260717');
    expect(r.oldestDate).toBe('20260713');
    expect(r.todayDate).toBe('20260717');
    expect(r.todayIncludedInWindow).toBe(true);
    expect(r.generatedAt).toBe(NOW.toISOString());

    // 최신 우선 5행
    expect(r.daily.map((d) => d.date)).toEqual([
      '20260717',
      '20260716',
      '20260715',
      '20260714',
      '20260713',
    ]);
    const by = Object.fromEntries(r.daily.map((d) => [d.date, d]));
    expect(by['20260717']).toMatchObject({ buyCount: 3, totalCount: 5 });
    expect(by['20260716']).toMatchObject({ buyCount: 0, totalCount: 0 }); // 행 없음 → 0
    expect(by['20260715']).toMatchObject({ buyCount: 1, totalCount: 4 });
    expect(by['20260714']).toMatchObject({ buyCount: 0, totalCount: 0 });
    expect(by['20260713']).toMatchObject({ buyCount: 2, totalCount: 2 });
  });

  it('buyGrade/allGrade 통계 + 판정', async () => {
    const r = await service.getEditionDensity(5, NOW);
    // buyCounts asc[20260713..17] = [2,0,1,0,3]
    expect(r.buyGrade).toMatchObject({
      days: 5,
      totalSignals: 6,
      mean: 1.2,
      median: 1,
      zeroDays: 2,
      zeroDayRatio: 0.4,
    });
    // totalCounts = [2,0,4,0,5]
    expect(r.allGrade).toMatchObject({
      days: 5,
      totalSignals: 11,
      mean: 2.2,
      median: 2,
      zeroDays: 2,
    });
    // median 1<2 → 트리거; 0건일 0.4 는 미트리거(엄격 초과)
    expect(r.verdict.medianBelowThreshold).toBe(true);
    expect(r.verdict.zeroDayRatioAboveThreshold).toBe(false);
    expect(r.verdict.fallbackProposalTriggered).toBe(true);
  });

  it('분모 교차검증 — 캘린더 vs 일봉 일치', async () => {
    const r = await service.getEditionDensity(5, NOW);
    expect(r.tradingDayCrossCheck.calendarTradingDays).toBe(5);
    expect(r.tradingDayCrossCheck.marketDataTradingDays).toBe(5);
    expect(r.tradingDayCrossCheck.matches).toBe(true);
  });

  it('일봉 데이터 부족 시 불일치 노출', async () => {
    prisma.stockDailyPrice.findMany.mockResolvedValue([
      { tradeDate: '20260717' },
      { tradeDate: '20260716' },
      { tradeDate: '20260715' },
    ]);
    const r = await service.getEditionDensity(5, NOW);
    expect(r.tradingDayCrossCheck.marketDataTradingDays).toBe(3);
    expect(r.tradingDayCrossCheck.matches).toBe(false);
  });

  it('일봉 질의 실패 → marketDataTradingDays null(주계열 무손상)', async () => {
    prisma.stockDailyPrice.findMany.mockRejectedValue(new Error('db down'));
    const r = await service.getEditionDensity(5, NOW);
    expect(r.tradingDayCrossCheck.marketDataTradingDays).toBeNull();
    expect(r.tradingDayCrossCheck.matches).toBeNull();
    // 주계열은 여전히 산출
    expect(r.buyGrade.days).toBe(5);
    expect(r.verdict.fallbackProposalTriggered).toBe(true);
  });

  it('신호 전무(모두 0건) → 중앙값 0·0건일 100% 트리거', async () => {
    prisma.$queryRaw.mockResolvedValue([]);
    const r = await service.getEditionDensity(5, NOW);
    expect(r.buyGrade.median).toBe(0);
    expect(r.buyGrade.zeroDays).toBe(5);
    expect(r.buyGrade.zeroDayRatio).toBe(1);
    expect(r.verdict.fallbackProposalTriggered).toBe(true);
    expect(r.daily.every((d) => d.buyCount === 0 && d.totalCount === 0)).toBe(true);
  });

  it('days 기본값 60 적용(미지정)', async () => {
    const r = await service.getEditionDensity(undefined, NOW);
    expect(r.windowTradingDays).toBe(60);
    expect(r.daily).toHaveLength(60);
  });
});
