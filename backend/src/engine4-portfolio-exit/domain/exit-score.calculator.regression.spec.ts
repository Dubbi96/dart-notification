// 회귀 안전망 (DAR-127): Exit Score — 액션 경계·내부자 대량순매도 판정·공시 악재 가중·하드플로어.
// 기존 exit-engine.spec.ts 보완: scoreToAction 5경계, DAR-94 isLargeInsiderNetSell/severe 불변.
import {
  scoreToAction,
  isLargeInsiderNetSell,
  calcDisclosureRiskScore,
  calcOverweightScore,
} from './exit-score.calculator';
import {
  InsiderFlowSnapshot,
  InsiderTradeSnapshot,
  DisclosureEvent,
  PositionSnapshot,
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

  it('점수는 cap 20으로 제한', () => {
    const r = calcDisclosureRiskScore([
      ev('DELISTING_RISK'),
      ev('LAWSUIT'),
      ev('TRADING_SUSPENSION'),
    ]);
    expect(r.score).toBe(20);
    expect(r.severe).toBe(true);
  });

  it('내부자 대량 순매도 결합 → +12·severe', () => {
    const r = calcDisclosureRiskScore([], flow([trade({ ratioChange: -2 })]));
    expect(r.score).toBe(12);
    expect(r.severe).toBe(true);
    expect(r.triggered).toBe(true);
  });
});

describe('calcOverweightScore (DAR-127)', () => {
  const pos = (over: Partial<PositionSnapshot>): PositionSnapshot =>
    ({
      currentPrice: 10_000,
      quantity: 10,
      portfolioTotalValue: 1_000_000,
      portfolioMaxSinglePositionPct: 10,
      ...over,
    } as PositionSnapshot);

  it('한도 이하 → 0·미트리거', () => {
    // 100,000/1,000,000 = 10% (한도 10% 초과 아님)
    expect(calcOverweightScore(pos({}))).toEqual({ score: 0, triggered: false });
  });

  it('한도 초과 → 초과분 기반 가점', () => {
    // 300,000/1,000,000 = 30%, 초과 20%p → floor(20/2)*2=20, cap 8
    const r = calcOverweightScore(pos({ currentPrice: 30_000 }));
    expect(r.triggered).toBe(true);
    expect(r.score).toBe(8);
  });

  it('포트폴리오 평가액 ≤ 0 → 0(0 나눗셈 방지)', () => {
    expect(calcOverweightScore(pos({ portfolioTotalValue: 0 }))).toEqual({
      score: 0,
      triggered: false,
    });
  });
});
