/**
 * philosophy.scorer.spec.ts — DAR-53 (Persona P-B)
 *
 * 알려진 재무값 → 예상 철학 적합도 점수 검증(순수 Rule, 결정론적).
 *  1) 버핏 전지표 통과 → 100점
 *  2) 혼합(일부 미달·일부 결측) → 재정규화 가중평균 정확 계산
 *  3) 가용 지표 0개(재무만으로 평가 불가 철학) → computable=false, score=null
 *  4) 연산자별 통과/미달 + 부분점수(GT/LT/RANGE/EQ)
 *  5) 결측 지표는 분모(가중치 합)에서 제외 — DAR-49 재정규화 패턴
 *
 * AI 금지영역: 순수 Rule 검증.
 */
import { PHILOSOPHY_SEEDS } from '../philosophy.seed-data';
import { InvestorPhilosophySeed } from '../types/philosophy.types';
import { PhilosophyMetricView } from '../ports/philosophy.repository';
import { FinancialSnapshot } from '../../../engine1-disclosure/financials/financial-query.service';
import {
  evaluateMetricValue,
  resolveFinancialMetric,
  scorePhilosophyFit,
} from './philosophy.scorer';

/** 시드 → 스코어러 입력(View) 변환 */
function toPhilosophy(seed: InvestorPhilosophySeed) {
  const metrics: PhilosophyMetricView[] = seed.metrics.map((m) => ({
    metricKey: m.metricKey,
    operator: m.operator,
    threshold: m.threshold,
    thresholdMax: m.thresholdMax ?? null,
    weight: m.weight,
    description: m.description,
  }));
  return {
    philosophyId: seed.philosophyId,
    investorName: seed.investorName,
    metrics,
  };
}

const BUFFETT = toPhilosophy(PHILOSOPHY_SEEDS.find((p) => p.philosophyId === 'BUFFETT')!);
const LYNCH = toPhilosophy(PHILOSOPHY_SEEDS.find((p) => p.philosophyId === 'LYNCH')!);
const DRUCKENMILLER = toPhilosophy(
  PHILOSOPHY_SEEDS.find((p) => p.philosophyId === 'DRUCKENMILLER')!,
);

function snap(overrides: Partial<FinancialSnapshot>): FinancialSnapshot {
  return {
    corpCode: '00126380',
    stockCode: '005930',
    bsnsYear: '2025',
    reprtCode: '11011',
    fsDiv: 'CFS',
    revenue: null,
    operatingProfit: null,
    netIncome: null,
    totalAssets: null,
    totalLiabilities: null,
    totalEquity: null,
    eps: null,
    bps: null,
    roe: null,
    roa: null,
    debtRatio: null,
    per: null,
    pbr: null,
    revenueGrowthYoY: null,
    operatingProfitGrowthYoY: null,
    epsGrowthYoY: null,
    revenueGrowthQoQ: null,
    operatingProfitGrowthQoQ: null,
    epsGrowthQoQ: null,
    ...overrides,
  };
}

describe('resolveFinancialMetric', () => {
  it('OPERATING_MARGIN 은 영업이익/매출×100 으로 파생한다', () => {
    const s = snap({ operatingProfit: 150, revenue: 1000 });
    expect(resolveFinancialMetric('OPERATING_MARGIN', s)).toBeCloseTo(15);
  });

  it('매출 0/null 이면 영업이익률은 결측(null)', () => {
    expect(resolveFinancialMetric('OPERATING_MARGIN', snap({ operatingProfit: 10, revenue: 0 }))).toBeNull();
    expect(resolveFinancialMetric('OPERATING_MARGIN', snap({ operatingProfit: 10 }))).toBeNull();
  });

  it('산출 불가한 지표는 결측(null)', () => {
    const s = snap({ roe: 20 });
    expect(resolveFinancialMetric('FCF_POSITIVE', s)).toBeNull();
    expect(resolveFinancialMetric('MOAT_SCORE', s)).toBeNull();
    expect(resolveFinancialMetric('PEG', s)).toBeNull();
    expect(resolveFinancialMetric('MARKET_CAP_TIER', s)).toBeNull();
    expect(resolveFinancialMetric('ROC', s)).toBeNull();
    expect(resolveFinancialMetric('PRICE_NEAR_52W_HIGH', s)).toBeNull();
  });

  it('DAR-93: 다년 시계열 성장률은 스냅샷에서 실데이터로 해석(결측 복원)', () => {
    const s = snap({ epsGrowthYoY: 30, revenueGrowthYoY: 18, operatingProfitGrowthYoY: 12 });
    expect(resolveFinancialMetric('EPS_GROWTH_YOY', s)).toBe(30);
    expect(resolveFinancialMetric('REVENUE_GROWTH_YOY', s)).toBe(18);
    expect(resolveFinancialMetric('OPERATING_PROFIT_GROWTH_YOY', s)).toBe(12);
  });

  it('DAR-93: 직전 기간 결측으로 성장률이 null 이면 지표도 결측(폴백 유지)', () => {
    const s = snap({ roe: 20 }); // 성장률 미산출(null)
    expect(resolveFinancialMetric('EPS_GROWTH_YOY', s)).toBeNull();
    expect(resolveFinancialMetric('REVENUE_GROWTH_YOY', s)).toBeNull();
  });
});

describe('evaluateMetricValue', () => {
  const gt: PhilosophyMetricView = { metricKey: 'ROE', operator: 'GT', threshold: 15, thresholdMax: null, weight: 1, description: '' };
  const lt: PhilosophyMetricView = { metricKey: 'PER', operator: 'LT', threshold: 20, thresholdMax: null, weight: 1, description: '' };

  it('GT: 임계 이상 통과(1.0), 미만은 부분점수 value/threshold', () => {
    expect(evaluateMetricValue(gt, 20)).toEqual({ passed: true, achievement: 1 });
    expect(evaluateMetricValue(gt, 15)).toEqual({ passed: true, achievement: 1 });
    expect(evaluateMetricValue(gt, 9)).toEqual({ passed: false, achievement: 0.6 });
  });

  it('LT: 임계 이하 통과(1.0), 초과는 부분점수 threshold/value', () => {
    expect(evaluateMetricValue(lt, 12)).toEqual({ passed: true, achievement: 1 });
    expect(evaluateMetricValue(lt, 40)).toEqual({ passed: false, achievement: 0.5 });
  });

  it('LT: 음수 값(적자 PER 등)은 미달 0점', () => {
    expect(evaluateMetricValue(lt, -5)).toEqual({ passed: false, achievement: 0 });
  });

  it('RANGE: 구간 내만 통과', () => {
    const range: PhilosophyMetricView = { metricKey: 'X', operator: 'RANGE', threshold: 10, thresholdMax: 20, weight: 1, description: '' };
    expect(evaluateMetricValue(range, 15)).toEqual({ passed: true, achievement: 1 });
    expect(evaluateMetricValue(range, 25)).toEqual({ passed: false, achievement: 0 });
  });
});

describe('scorePhilosophyFit — 버핏', () => {
  it('전지표 통과 종목 → 100점, FCF·해자는 결측으로 제외', () => {
    const s = snap({
      roe: 20,
      debtRatio: 30,
      per: 12,
      pbr: 1.5,
      operatingProfit: 150,
      revenue: 1000, // 영업이익률 15%
    });
    const r = scorePhilosophyFit(BUFFETT, s);
    expect(r.computable).toBe(true);
    expect(r.score).toBe(100);
    expect(r.evaluatedCount).toBe(5); // ROE·DEBT·PER·PBR·OP_MARGIN
    expect(r.passedMetricKeys.sort()).toEqual(
      ['DEBT_RATIO', 'OPERATING_MARGIN', 'PBR', 'PER', 'ROE'],
    );
    expect(r.failedMetricKeys).toEqual([]);
    expect(r.omittedMetricKeys.sort()).toEqual(['FCF_POSITIVE', 'MOAT_SCORE']);
  });

  it('혼합(일부 미달·일부 결측) → 가용 가중치 재정규화 가중평균', () => {
    // ROE 20(통과,1.0) · DEBT 80(미달, 50/80=0.625) · OP_MARGIN 8%(미달, 8/10=0.8)
    // PER·PBR 결측. 가용 가중치 합 = 0.2+0.2+0.15 = 0.55
    // weighted = (1*0.2 + 0.625*0.2 + 0.8*0.15)/0.55 = 0.445/0.55 = 0.809090...
    const s = snap({ roe: 20, debtRatio: 80, operatingProfit: 80, revenue: 1000 });
    const r = scorePhilosophyFit(BUFFETT, s);
    expect(r.computable).toBe(true);
    expect(r.evaluatedCount).toBe(3);
    expect(r.score).toBeCloseTo(80.91, 2);
    expect(r.passedMetricKeys).toEqual(['ROE']);
    expect(r.failedMetricKeys.sort()).toEqual(['DEBT_RATIO', 'OPERATING_MARGIN']);
    expect(r.omittedMetricKeys.sort()).toEqual(
      ['FCF_POSITIVE', 'MOAT_SCORE', 'PBR', 'PER'],
    );
  });

  it('버핏 기준 통과/미달 종목을 식별한다(임계 통과 카운트)', () => {
    const passer = scorePhilosophyFit(BUFFETT, snap({ roe: 18, debtRatio: 40, per: 14 }));
    const failer = scorePhilosophyFit(BUFFETT, snap({ roe: 8, debtRatio: 120, per: 35 }));
    expect(passer.passedMetricKeys.length).toBeGreaterThan(failer.passedMetricKeys.length);
    expect(passer.score!).toBeGreaterThan(failer.score!);
  });
});

describe('scorePhilosophyFit — 린치(DAR-93 성장률 결측 복원)', () => {
  it('성장률 부재 시 PER 만 평가(린치 적합도 빈약)', () => {
    const r = scorePhilosophyFit(LYNCH, snap({ per: 20 }));
    expect(r.evaluatedCount).toBe(1); // PER 만
    expect(r.omittedMetricKeys.sort()).toEqual(
      ['EPS_GROWTH_YOY', 'MARKET_CAP_TIER', 'PEG', 'REVENUE_GROWTH_YOY'],
    );
  });

  it('다년 성장률 공급 시 EPS·매출 성장률까지 평가(결측 복원)', () => {
    const r = scorePhilosophyFit(
      LYNCH,
      snap({ per: 20, epsGrowthYoY: 30, revenueGrowthYoY: 18 }),
    );
    expect(r.computable).toBe(true);
    expect(r.evaluatedCount).toBe(3); // PER·EPS_GROWTH_YOY·REVENUE_GROWTH_YOY
    expect(r.score).toBe(100); // 셋 다 통과
    expect(r.passedMetricKeys.sort()).toEqual(
      ['EPS_GROWTH_YOY', 'PER', 'REVENUE_GROWTH_YOY'],
    );
    expect(r.omittedMetricKeys.sort()).toEqual(['MARKET_CAP_TIER', 'PEG']);
  });

  it('성장률 일부 미달 → 재정규화 가중평균', () => {
    // PER 20(통과,1.0,w0.15)·EPS 10%(미달 10/20=0.5,w0.25)·매출 18%(통과,1.0,w0.15)
    // weighted = (1*0.15 + 0.5*0.25 + 1*0.15)/0.55 = 0.425/0.55 = 0.77272…
    const r = scorePhilosophyFit(
      LYNCH,
      snap({ per: 20, epsGrowthYoY: 10, revenueGrowthYoY: 18 }),
    );
    expect(r.evaluatedCount).toBe(3);
    expect(r.score).toBeCloseTo(77.27, 2);
    expect(r.failedMetricKeys).toEqual(['EPS_GROWTH_YOY']);
  });
});

describe('scorePhilosophyFit — 평가 불가 철학', () => {
  it('재무만으로 산출 불가한 철학(드러켄밀러: 모멘텀·매크로·수급) → computable=false', () => {
    const s = snap({ roe: 20, debtRatio: 30, per: 12 });
    const r = scorePhilosophyFit(DRUCKENMILLER, s);
    expect(r.computable).toBe(false);
    expect(r.score).toBeNull();
    expect(r.evaluatedCount).toBe(0);
    expect(r.omittedMetricKeys.length).toBe(r.totalMetrics);
  });

  it('재무 전부 결측이면 버핏도 computable=false', () => {
    const r = scorePhilosophyFit(BUFFETT, snap({}));
    expect(r.computable).toBe(false);
    expect(r.score).toBeNull();
  });
});
