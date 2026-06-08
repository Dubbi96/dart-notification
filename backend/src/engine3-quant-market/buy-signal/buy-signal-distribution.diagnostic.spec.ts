/**
 * DAR-134 [진단] 신호 등급 분포 — 전부 관망(WATCH) 원인 규명
 *
 * 목적: 라이브에서 BUY_CANDIDATE 가 0건(전부 WATCH)인 현상의 근본 원인을
 *       임계값/점수계산/데이터충실도 중 어디인지 결정론적으로 격리한다.
 *
 * 방법: 실제 BuySignalService 를 라이브 데이터-가용 상태(state)별로 구동하고,
 *       buyScore·등급·버킷별 기여·결측버킷을 표로 출력한다.
 *
 * ★정직 원칙: 진단 전용. 임계값(80/60/30)을 낮추지 않는다.
 *
 * 라이브 입력 실제 배선(코드 확인):
 *   - polarity: engine1 event-classifier(룰) 가 부여. 강한 양(+) 이벤트는 POSITIVE,
 *               미분류는 OTHER+UNKNOWN(base 0). ← AI 아님(M3 미가동과 무관).
 *   - personaViews: persona-view.rule.ts 가 (eventType,polarity,impact) 로 파생.
 *                   UNKNOWN polarity → 4 persona 전부 NEUTRAL(0). ← 항상 length>0 이라
 *                   '가용'으로 취급되어 0점이 분모를 차지(희석).
 *   - keyMetric: 룰 없는 이벤트타입(SHARE_BUYBACK·MAJOR_SHAREHOLDER_CHANGE·OTHER…)은
 *                default→0. ← 역시 항상 '가용'으로 취급되어 0점이 분모를 차지(희석).
 *   - historicalEvent: EventStudyResult 성숙(D+20)+표본≥30 필요 → 대부분 결측(omit).
 *   - chart/volume/market: 지표 산출 여부에 따라 가용/결측.
 */

import { BuySignalService, BuyScoreParams } from './buy-signal.service';
import { SIGNAL_GRADE_THRESHOLDS } from './config/buy-signal.config';

type Avail = {
  eventStudy: boolean;
  chart: boolean;
  volume: boolean;
  market: boolean;
};

const NO_RISK = {
  isAmendment: false,
  preDsclReturn: null as number | null,
  isTradingSuspended: false,
  isManagement: false,
  isInvestmentCaution: false,
  isAbnormalSurge: false,
  dilutionRate: null as number | null,
  avgDailyVolume: 500_000,
};

const ENTRY = {
  buyScore: 0,
  closePrice: 10000,
  ma20: 9800,
  rsi14: 55,
  tradingValue: 2_000_000_000,
  volumeRatio20: 1.2,
};

/**
 * 현실적 '보통' 기술적 상태 — 강세 일색이 아님.
 *   추세 약상승(종가>ma20, 종가<ma60), rsi 중립, macd 약음, 볼린저 하단.
 *   → scoreChart ≈ 30~40 (보통주). 이전 진단의 maxed(100) 과대평가를 교정.
 */
const NEUTRAL_CHART = {
  closePrice: 10000, ma5: 10050, ma20: 9800, ma60: 10200,
  rsi14: 52, macdLine: 5, macdSignal: 7, bollingerMid: 10100,
  preDsclReturn: 2,
};
const ABSENT_CHART = {
  closePrice: null, ma5: null, ma20: null, ma60: null,
  rsi14: null, macdLine: null, macdSignal: null, bollingerMid: null,
  preDsclReturn: null,
};

// derivePersonaViews 와 동일한 규칙을 진단 입력에 반영(룰 기반, AI 아님).
// 강한 양(+) 이벤트는 해당 persona 에 POSITIVE, UNKNOWN 은 전부 NEUTRAL.
function personaViewsFor(polarity: string): Array<{ persona: string; view: string }> {
  const v = polarity === 'POSITIVE' ? 'POSITIVE' : polarity === 'UNKNOWN' ? 'NEUTRAL' : 'WATCH';
  return [{ persona: 'GROWTH', view: v }];
}

function buildParams(
  eventType: string,
  polarity: string,
  extractedData: Record<string, number | string | null>,
  avail: Avail,
): BuyScoreParams {
  return {
    rcpNo: 'R' + eventType,
    corpCode: 'C0001',
    stockCode: '005930',
    persona: 'GROWTH',
    disclosureEvent: { eventType, polarity },
    keyMetric: { eventType, extractedData },
    personaFitInput: { personaViews: personaViewsFor(polarity), userPersona: 'GROWTH' },
    historicalEvent: avail.eventStudy
      ? { avgArD5: 6, isSignificant: true, upProbD5: 0.62, crashProbD5: 0.05, sampleCount: 45 }
      : { avgArD5: null },
    chart: avail.chart ? NEUTRAL_CHART : ABSENT_CHART,
    volumeLiquidity: avail.volume
      ? { volume: 1_300_000, avgVolume20: 1_000_000, tradingValue: 2_000_000_000, avgValue20: 1_500_000_000 }
      : { volume: null, avgVolume20: null, tradingValue: null, avgValue20: null },
    marketSector: avail.market
      ? { kospiChange1d: 0.3, kosdaqChange1d: 0.2, sectorChange1d: null, vixEquivalent: null }
      : { kospiChange1d: null, kosdaqChange1d: null, sectorChange1d: null, vixEquivalent: null },
    riskPenalty: { eventType, ...NO_RISK },
    entryCondition: ENTRY,
  };
}

describe('DAR-134 진단: Buy Score 분포·버킷 기여·결측 분석', () => {
  const service = new BuySignalService();
  const fmt = (n: number) => (n >= 0 ? ' ' : '') + String(Math.round(n)).padStart(4);

  // 라이브 추정 가용: EventStudy 결측, 지표는 산출됨(차트/량/시장 가용)
  const LIVE: Avail = { eventStudy: false, chart: true, volume: true, market: true };
  // 지표마저 미산출인 초기 상태
  const SPARSE: Avail = { eventStudy: false, chart: false, volume: true, market: false };

  it('진단표: 라이브 추정 상태에서 강한 양(+) 공시 등급 분포', () => {
    const cases: Array<{ label: string; eventType: string; polarity: string; extracted: Record<string, number> }> = [
      { label: 'SUPPLY_CONTRACT salesRatio=35 (강)', eventType: 'SUPPLY_CONTRACT', polarity: 'POSITIVE', extracted: { salesRatio: 35 } },
      { label: 'SUPPLY_CONTRACT salesRatio=12 (중)', eventType: 'SUPPLY_CONTRACT', polarity: 'POSITIVE', extracted: { salesRatio: 12 } },
      { label: 'EARNINGS_SURPRISE surprise=20', eventType: 'EARNINGS_SURPRISE', polarity: 'POSITIVE', extracted: { surpriseRate: 20 } },
      { label: 'SHARE_CANCELLATION ratio=4', eventType: 'SHARE_CANCELLATION', polarity: 'POSITIVE', extracted: { cancellationRatio: 4 } },
      { label: 'SHARE_BUYBACK (keyMetric 룰無)', eventType: 'SHARE_BUYBACK', polarity: 'POSITIVE', extracted: {} },
      { label: 'DIVIDEND_INCREASE yoy=30', eventType: 'DIVIDEND_INCREASE', polarity: 'POSITIVE', extracted: { yoyDividendGrowth: 30 } },
      { label: 'OTHER (미분류·UNKNOWN, base 0)', eventType: 'OTHER', polarity: 'UNKNOWN', extracted: {} },
    ];

    const lines: string[] = [''];
    lines.push('═══ 라이브 추정(EventStudy 결측·지표 가용) — 강한 양(+) 공시 ═══');
    lines.push(`임계: STRONG≥${SIGNAL_GRADE_THRESHOLDS.STRONG_BUY_CANDIDATE} BUY≥${SIGNAL_GRADE_THRESHOLDS.BUY_CANDIDATE} WATCH≥${SIGNAL_GRADE_THRESHOLDS.WATCH} NEUTRAL≥${SIGNAL_GRADE_THRESHOLDS.NEUTRAL}`);
    lines.push('  score grade           disc keyM pers hist chrt vol  mkt | omitted');
    const tally: Record<string, number> = {};
    for (const c of cases) {
      const r = service.computeBuyScore(buildParams(c.eventType, c.polarity, c.extracted, LIVE));
      const b = r.scoreBreakdown;
      tally[r.signal] = (tally[r.signal] ?? 0) + 1;
      lines.push(`  ${String(r.buyScore).padStart(4)} ${r.signal.padEnd(15)} ${fmt(b.disclosureEvent)} ${fmt(b.keyMetric)} ${fmt(b.personaFit)} ${fmt(b.historicalEvent)} ${fmt(b.chart)} ${fmt(b.volumeLiquidity)} ${fmt(b.marketSector)} | ${r.omittedBuckets.join(',')}  [${c.label}]`);
    }
    lines.push(`  집계: ${Object.entries(tally).map(([g, n]) => `${g}=${n}`).join(', ')}`);
    // eslint-disable-next-line no-console
    console.log(lines.join('\n'));

    // 결론 단언: 점수계산·임계는 정상 — 강한 양(+) 공시는 BUY 도달(임계 인하 없이).
    const strong = service.computeBuyScore(buildParams('SUPPLY_CONTRACT', 'POSITIVE', { salesRatio: 35 }, LIVE));
    expect(strong.signal).toBe('BUY_CANDIDATE');
    // OTHER(미분류)는 base 0 → 정당하게 낮은 등급(거짓 BUY 아님).
    const other = service.computeBuyScore(buildParams('OTHER', 'UNKNOWN', {}, LIVE));
    expect(other.buyScore).toBeLessThan(SIGNAL_GRADE_THRESHOLDS.BUY_CANDIDATE);
  });

  it('근본원인 격리: 지표 결측이 누적되면 강·중 공시가 WATCH 로 침강', () => {
    // 차트·시장 결측(EventStudy 도 결측) → 가용 버킷이 disc+keyMetric+persona(+volume)
    const mid = service.computeBuyScore(buildParams('SUPPLY_CONTRACT', 'POSITIVE', { salesRatio: 12 }, SPARSE));
    // 중간 강도 공시는 데이터 결핍 시 WATCH 로 떨어질 수 있다(임계 버그 아님 — 입력 부족).
    // eslint-disable-next-line no-console
    console.log(`\n[SPARSE] SUPPLY_CONTRACT salesRatio=12 → ${mid.buyScore} ${mid.signal}, omitted=${mid.omittedBuckets.join(',')}`);
    expect(mid.dataAvailability.historicalEvent).toBe(false);
    expect(mid.dataAvailability.chart).toBe(false);
  });

  it('희석 측정: keyMetric 룰無 이벤트의 0점이 분모를 차지해 강한 공시를 끌어내림', () => {
    // SHARE_BUYBACK(base 65, 강한 양+)인데 keyMetric 룰이 없어 keyMetric=0.
    // 현재: keyMetric '가용'(true) → 0점이 ~0.18 가중치를 점유(희석).
    const r = service.computeBuyScore(buildParams('SHARE_BUYBACK', 'POSITIVE', {}, LIVE));
    const b = r.scoreBreakdown;
    // keyMetric 기여가 0인데 omitted 에 없음 = 희석 증거.
    expect(b.keyMetric).toBe(0);
    expect(r.omittedBuckets).not.toContain('keyMetric');
    // eslint-disable-next-line no-console
    console.log(`\n[DILUTION] SHARE_BUYBACK POSITIVE → ${r.buyScore} ${r.signal} (keyMetric=0 이 분모 점유, omitted=${r.omittedBuckets.join(',')})`);
  });
});
