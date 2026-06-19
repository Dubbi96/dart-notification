// 회귀 안전망 (DAR-127): Exit Score — 액션 경계·내부자 대량순매도 판정·공시 악재 가중·하드플로어.
// 기존 exit-engine.spec.ts 보완: scoreToAction 5경계, DAR-94 isLargeInsiderNetSell/severe 불변.
import {
  scoreToAction,
  isLargeInsiderNetSell,
  calcDisclosureRiskScore,
  calcOverweightScore,
  calcLossRiskScore,
  countTradingDays,
  softCapDisclosureRisk,
} from './exit-score.calculator';
import {
  InsiderFlowSnapshot,
  InsiderTradeSnapshot,
  DisclosureEvent,
  PositionSnapshot,
  TechnicalSnapshot,
} from './exit-engine.types';

const trade = (o: Partial<InsiderTradeSnapshot>): InsiderTradeSnapshot => ({
  source: 'MAJOR_STOCK',
  tradeType: 'SELL',
  ratioChange: -2,
  isMajorShareholder: false,
  ...o,
});
const flow = (trades: InsiderTradeSnapshot[]): InsiderFlowSnapshot => ({ trades });
const ev = (type: string): DisclosureEvent => ({ type, rcpNo: `rcp-${type}` });

describe('scoreToAction (DAR-127 5액션 경계)', () => {
  it.each([
    [0, 'HOLD'],
    [29, 'HOLD'],
    [30, 'WATCH'],
    [49, 'WATCH'],
    [50, 'REDUCE'],
    [69, 'REDUCE'],
    [70, 'EXIT'],
    [89, 'EXIT'],
    [90, 'BLOCK_REBUY'],
    [100, 'BLOCK_REBUY'],
  ])('score=%p → %p', (score, action) => {
    expect(scoreToAction(score)).toBe(action);
  });
});

describe('isLargeInsiderNetSell (DAR-94 회귀 안전망)', () => {
  it('빈 목록 → false', () => {
    expect(isLargeInsiderNetSell(null)).toBe(false);
    expect(isLargeInsiderNetSell(flow([]))).toBe(false);
  });

  it('소규모 단일 매도(임계 미만) → false', () => {
    // MAJOR_STOCK, isMajorShareholder false → 가중 없음. |0.5| < 1.0
    expect(isLargeInsiderNetSell(flow([trade({ ratioChange: -0.5 })]))).toBe(false);
  });

  it('유의 규모 매도(≥1.0%p) → true', () => {
    expect(isLargeInsiderNetSell(flow([trade({ ratioChange: -1.5 })]))).toBe(true);
  });

  it('임원(EXECUTIVE) 처분 1.5배 가중', () => {
    // |0.8| * 1.5 = 1.2 ≥ 1.0
    expect(
      isLargeInsiderNetSell(flow([trade({ source: 'EXECUTIVE', ratioChange: -0.8 })])),
    ).toBe(true);
  });

  it('주요주주 처분 1.5배 가중', () => {
    expect(
      isLargeInsiderNetSell(flow([trade({ isMajorShareholder: true, ratioChange: -0.8 })])),
    ).toBe(true);
  });

  it('같은 윈도우 매수는 순매도에서 차감(상쇄)', () => {
    const f = flow([trade({ ratioChange: -1.5 }), trade({ tradeType: 'BUY', ratioChange: 1.5 })]);
    expect(isLargeInsiderNetSell(f)).toBe(false);
  });

  it('규모 결측(ratioChange null) → 보수적 기본 0.5%p', () => {
    // 1건 0.5 < 1.0 → false
    expect(isLargeInsiderNetSell(flow([trade({ ratioChange: null })]))).toBe(false);
    // 2건 누적 1.0 ≥ 1.0 → true
    expect(
      isLargeInsiderNetSell(flow([trade({ ratioChange: null }), trade({ ratioChange: null })])),
    ).toBe(true);
  });

  it('MIXED/UNKNOWN → 무시(보수)', () => {
    expect(
      isLargeInsiderNetSell(
        flow([trade({ tradeType: 'MIXED', ratioChange: -5 }), trade({ tradeType: 'UNKNOWN', ratioChange: -5 })]),
      ),
    ).toBe(false);
  });
});

describe('calcDisclosureRiskScore (DAR-94 회귀 안전망)', () => {
  it('악재 없음 → score 0·triggered false·severe false', () => {
    const r = calcDisclosureRiskScore([]);
    expect(r).toEqual({ score: 0, triggered: false, severe: false });
  });

  it('고위험 5종 단건 → 16점·severe', () => {
    const r = calcDisclosureRiskScore([ev('DELISTING_RISK')]);
    expect(r.score).toBe(16);
    expect(r.severe).toBe(true);
    expect(r.triggered).toBe(true);
  });

  it('일반 악재는 약한 가중(5점/건)', () => {
    const r = calcDisclosureRiskScore([ev('SOME_MINOR_EVENT')]);
    expect(r.score).toBe(5);
    expect(r.severe).toBe(false);
  });

  it('점수는 소프트 캡 — cap(20) 미만이되 단일보다 높다 (DAR-349#5)', () => {
    const r = calcDisclosureRiskScore([
      ev('DELISTING_RISK'),
      ev('LAWSUIT'),
      ev('TRADING_SUSPENSION'),
    ]);
    // 하드 캡(20 평탄화)이 아닌 단조 소프트 캡: 단건(16)보다 크고 20 미만
    expect(r.score).toBeGreaterThan(16);
    expect(r.score).toBeLessThan(20);
    expect(r.severe).toBe(true);
  });

  it('내부자 대량 순매도 결합 → +12·severe', () => {
    const r = calcDisclosureRiskScore([], flow([trade({ ratioChange: -2 })]));
    expect(r.score).toBe(12);
    expect(r.severe).toBe(true);
    expect(r.triggered).toBe(true);
  });
});

describe('calcOverweightScore (DAR-127 / DAR-349#3·#6)', () => {
  const pos = (over: Partial<PositionSnapshot>): PositionSnapshot =>
    ({
      currentPrice: 10_000,
      quantity: 10,
      portfolioTotalValue: 1_000_000,
      portfolioMaxSinglePositionPct: 10,
      ...over,
    } as PositionSnapshot);
  // DAR-349#3: 비중 가격소스 = tech.closePrice
  const tech = (closePrice: number): TechnicalSnapshot =>
    ({ closePrice } as TechnicalSnapshot);

  it('한도 이하 → 0·미트리거', () => {
    // 100,000/1,000,000 = 10% (한도 10% 초과 아님)
    expect(calcOverweightScore(pos({}), tech(10_000))).toEqual({
      score: 0,
      triggered: false,
    });
  });

  it('한도 초과 → 초과분 기반 가점', () => {
    // 300,000/1,000,000 = 30%, 초과 20%p → min(20, 8) = 8
    const r = calcOverweightScore(pos({}), tech(30_000));
    expect(r.triggered).toBe(true);
    expect(r.score).toBe(8);
  });

  it('포트폴리오 평가액 ≤ 0 → 0(0 나눗셈 방지)', () => {
    expect(
      calcOverweightScore(pos({ portfolioTotalValue: 0 }), tech(10_000)),
    ).toEqual({
      score: 0,
      triggered: false,
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────
// DAR-349: Exit Score 정확성 6종 교정 — 결함별 회귀 고정
// ─────────────────────────────────────────────────────────────────────────

const lossPos = (over: Partial<PositionSnapshot>): PositionSnapshot =>
  ({
    entryPrice: 100,
    stopLossPct: null,
    highestPrice: null,
    portfolioDailyLossPct: null,
    portfolioMaxDailyLossPct: 2,
    ...over,
  } as PositionSnapshot);
const lossTech = (over: Partial<TechnicalSnapshot>): TechnicalSnapshot =>
  ({ closePrice: 100, atr14: null, ...over } as TechnicalSnapshot);

describe('DAR-349#1 트레일링스톱 거짓음성 — 수익권 게이트 제거 (★)', () => {
  it('+10% 고점 후 -5%로 하락(진입가 대비 손실) → 트레일링 발동(+12)', () => {
    // 진입 100, 고점 110(+10%), 현재 95(-5%). 고점 대비 -13.6% → 트레일링 발동.
    const pos = lossPos({ entryPrice: 100, highestPrice: 110, stopLossPct: null });
    const tech = lossTech({ closePrice: 95, atr14: null });
    const r = calcLossRiskScore(pos, tech);
    // 기존 게이트(pnlPct>5)면 -5% 구간에서 0(거짓음성)이었다. 이제 12.
    expect(r.score).toBe(12);
    expect(r.triggered).toBe(true);
  });

  it('고점 대비 6% 미만 하락 → 미발동(오탐 없음)', () => {
    // 고점 110, 현재 105 → 고점 대비 -4.5% (< 6%)
    const pos = lossPos({ entryPrice: 100, highestPrice: 110 });
    const tech = lossTech({ closePrice: 105 });
    expect(calcLossRiskScore(pos, tech).score).toBe(0);
  });

  it('수익권에서도 고점 대비 6% 이상 하락하면 발동(기존 동작 보존)', () => {
    // 고점 130, 현재 115 → +15% 수익이지만 고점 대비 -11.5% → 발동
    const pos = lossPos({ entryPrice: 100, highestPrice: 130 });
    const tech = lossTech({ closePrice: 115 });
    expect(calcLossRiskScore(pos, tech).score).toBe(12);
  });

  it('하드 스탑로스는 여전히 우선(20·회귀 금지)', () => {
    const pos = lossPos({ entryPrice: 100, stopLossPct: 8, highestPrice: 110 });
    const tech = lossTech({ closePrice: 90 }); // -10% ≤ -8%
    const r = calcLossRiskScore(pos, tech);
    expect(r.score).toBe(20);
    expect(r.triggered).toBe(true);
  });
});

describe('DAR-349#2 거래일 정확 계산 — 5/7 근사 과소 제거', () => {
  it('월요일부터 30일 → 정확 22거래일 (근사 21보다 큼)', () => {
    const from = new Date('2026-01-05T00:00:00Z'); // 월요일
    const to = new Date('2026-02-04T00:00:00Z'); // +30일
    const approx = Math.floor(30 * (5 / 7)); // = 21 (기존 근사)
    expect(countTradingDays(from, to)).toBe(22);
    expect(countTradingDays(from, to)).toBeGreaterThan(approx);
  });

  it('주말은 제외 — 월요일부터 7일 → 5거래일', () => {
    const from = new Date('2026-01-05T00:00:00Z'); // 월
    const to = new Date('2026-01-12T00:00:00Z'); // 다음 월(+7일)
    expect(countTradingDays(from, to)).toBe(5);
  });

  it('미래/동일 시점 → 0 (음수 방지)', () => {
    const d = new Date('2026-01-05T00:00:00Z');
    expect(countTradingDays(d, d)).toBe(0);
    expect(countTradingDays(d, new Date('2026-01-04T00:00:00Z'))).toBe(0);
  });
});

describe('DAR-349#3 가격소스 통일 — 비중도 tech.closePrice', () => {
  it('비중은 pos.currentPrice가 아닌 tech.closePrice로 평가', () => {
    // currentPrice(stale)는 한도 이하, closePrice(신선)는 한도 초과 → 신선가 채택
    const pos = {
      currentPrice: 10_000, // stale: 10% (한도 이하)
      quantity: 10,
      portfolioTotalValue: 1_000_000,
      portfolioMaxSinglePositionPct: 10,
    } as PositionSnapshot;
    const r = calcOverweightScore(pos, { closePrice: 30_000 } as TechnicalSnapshot);
    expect(r.triggered).toBe(true); // closePrice 기준 30% → 초과
    expect(r.score).toBeGreaterThan(0);
  });
});

describe('DAR-349#4 내부자 가중 중복곱 제거 — 임원∧주요주주 2.0(≠2.25)', () => {
  it('임원+주요주주 동시: 2.25가 아닌 2.0배 적용', () => {
    // mag 0.45: 2.25배=1.0125(≥1 true) vs 2.0배=0.9(<1 false)
    const f = flow([
      trade({ source: 'EXECUTIVE', isMajorShareholder: true, ratioChange: -0.45 }),
    ]);
    expect(isLargeInsiderNetSell(f)).toBe(false); // 중복곱 제거 → 임계 미달
  });

  it('임원+주요주주 2.0배는 적용된다(어느 하나 1.5보다 큼)', () => {
    // mag 0.5: 1.5배=0.75(false) vs 2.0배=1.0(≥1 true)
    const f = flow([
      trade({ source: 'EXECUTIVE', isMajorShareholder: true, ratioChange: -0.5 }),
    ]);
    expect(isLargeInsiderNetSell(f)).toBe(true);
  });

  it('단일 자격(임원만/주요주주만)은 1.5배 유지(회귀 금지)', () => {
    expect(
      isLargeInsiderNetSell(flow([trade({ source: 'EXECUTIVE', ratioChange: -0.8 })])),
    ).toBe(true); // 0.8*1.5=1.2
    expect(
      isLargeInsiderNetSell(flow([trade({ isMajorShareholder: true, ratioChange: -0.8 })])),
    ).toBe(true);
  });
});

describe('DAR-349#5 공시리스크 소프트 캡 — 다중 위기 단조성', () => {
  it('단건 고위험(16)은 선형 보존', () => {
    expect(softCapDisclosureRisk(16)).toBe(16);
    expect(softCapDisclosureRisk(5)).toBe(5);
    expect(softCapDisclosureRisk(12)).toBe(12);
  });

  it('초과분은 단조 증가하며 cap(20)에 점근(도달X)', () => {
    const v32 = softCapDisclosureRisk(32);
    const v48 = softCapDisclosureRisk(48);
    const v64 = softCapDisclosureRisk(64);
    expect(v32).toBeGreaterThan(16);
    expect(v48).toBeGreaterThan(v32);
    expect(v64).toBeGreaterThan(v48);
    expect(v64).toBeLessThan(20);
  });

  it('다중 고위험 공시가 단일보다 항상 높은 점수(비차별 해소)', () => {
    const single = calcDisclosureRiskScore([ev('DELISTING_RISK')]).score;
    const multi = calcDisclosureRiskScore([
      ev('DELISTING_RISK'),
      ev('LAWSUIT'),
    ]).score;
    expect(multi).toBeGreaterThan(single);
    expect(multi).toBeLessThan(20);
  });
});

describe('DAR-349#6 과대편입 양자화 절벽 제거 — 연속 비례', () => {
  const ow = (closePrice: number) =>
    calcOverweightScore(
      {
        currentPrice: 0,
        quantity: 10,
        portfolioTotalValue: 1_000_000,
        portfolioMaxSinglePositionPct: 10,
      } as PositionSnapshot,
      { closePrice } as TechnicalSnapshot,
    ).score;

  it('초과 1.0%p vs 1.9%p 차별(기존 양자화는 둘 다 0)', () => {
    // closePrice 11_000 → 11.0% (초과 1.0), 11_900 → 11.9% (초과 1.9)
    const s10 = ow(11_000);
    const s19 = ow(11_900);
    expect(s10).toBeCloseTo(1.0, 5);
    expect(s19).toBeCloseTo(1.9, 5);
    expect(s19).toBeGreaterThan(s10);
  });

  it('상한 8 유지(대폭 초과)', () => {
    expect(ow(30_000)).toBe(8); // 초과 20 → min(20,8)=8
  });
});
