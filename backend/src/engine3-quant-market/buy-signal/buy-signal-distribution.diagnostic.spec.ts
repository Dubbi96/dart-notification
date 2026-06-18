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
 *   - keyMetric: 룰 없는 이벤트타입(OTHER·BW_ISSUANCE…)은 default→0. ← 역시 항상 '가용'으로
 *                취급되어 0점이 분모를 차지(희석). (DAR-322: SHARE_BUYBACK·THIRD_PARTY_ALLOTMENT·
 *                MAJOR_SHAREHOLDER_CHANGE 는 실평가 규칙으로 승격되어 더 이상 미모델 아님.)
 *   - historicalEvent: EventStudyResult 성숙(D+20)+표본≥30 필요 → 대부분 결측(omit).
 *   - chart/volume/market: 지표 산출 여부에 따라 가용/결측.
 */

import { BuySignalService, BuyScoreParams } from './buy-signal.service';
import {
  SIGNAL_GRADE_THRESHOLDS,
  BUY_SCORE_WEIGHTS,
} from './config/buy-signal.config';
import {
  renormalizeWeights,
  BucketAvailability,
  BucketKey,
} from './scoring/bucket-renormalization';

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
      { label: 'SHARE_BUYBACK ratio=6 (DAR-322 실평가)', eventType: 'SHARE_BUYBACK', polarity: 'POSITIVE', extracted: { buybackRatioToSales: 6 } },
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

  // ─── DAR-321 검증 게이트: 양방향 정직성(디플레이션 교정 ∧ 인플레이션 방지) ───
  describe('DAR-321: 미모델 keyMetric / UNKNOWN personaFit 분모 omit', () => {
    /** breakdown·availability 로 weightedSum 을 재현(penalty=0 전제) → buyScore 역산. */
    const scoreFrom = (
      breakdown: Record<BucketKey, number>,
      availability: BucketAvailability,
    ): number => {
      const { effectiveWeights } = renormalizeWeights({ ...BUY_SCORE_WEIGHTS }, availability);
      const keys = Object.keys(effectiveWeights) as BucketKey[];
      const sum = keys.reduce((s, k) => s + effectiveWeights[k] * breakdown[k], 0);
      return Math.round(Math.max(-100, Math.min(100, sum)));
    };

    it('(a) 미모델 이벤트(BW_ISSUANCE, 여전히 룰無)는 keyMetric omit → 구조적 0희석에서 회복', () => {
      // DAR-322 로 SHARE_BUYBACK 이 실평가로 승격되었으므로, A1 의 omit 동작은 여전히 미모델인
      // 타입(BW_ISSUANCE)으로 계속 증명한다. polarity 는 양(+)으로 두어 회복 효과를 격리.
      const r = service.computeBuyScore(buildParams('BW_ISSUANCE', 'POSITIVE', {}, LIVE));
      // 미채점(룰無) 0 은 이제 분모에서 제외된다.
      expect(r.scoreBreakdown.keyMetric).toBe(0);
      expect(r.omittedBuckets).toContain('keyMetric');
      expect(r.dataAvailability.keyMetric).toBe(false);

      // 회복 증명: keyMetric 을 분모에 강제로 끼운 반사실(diluted) 점수보다 실제 점수가 높다.
      const dilutedAvail: BucketAvailability = { ...r.dataAvailability, keyMetric: true };
      const diluted = scoreFrom(r.scoreBreakdown as Record<BucketKey, number>, dilutedAvail);
      expect(r.buyScore).toBeGreaterThan(diluted);
      // eslint-disable-next-line no-console
      console.log(`\n[DAR-321 a] BW_ISSUANCE → ${r.buyScore} ${r.signal} (omit keyMetric; diluted=${diluted}, omitted=${r.omittedBuckets.join(',')})`);
    });

    it('(DAR-322) SHARE_BUYBACK 은 이제 keyMetric 실점수 보유 → omit 아님(분모 유지)', () => {
      // omit→실평가 승격: 규모(buybackRatioToSales) 충분 → keyMetric 양(+) 실점수, 가용 유지.
      const r = service.computeBuyScore(buildParams('SHARE_BUYBACK', 'POSITIVE', { buybackRatioToSales: 6 }, LIVE));
      expect(r.scoreBreakdown.keyMetric).toBe(80); // ratio≥5 → 80
      expect(r.omittedBuckets).not.toContain('keyMetric');
      expect(r.dataAvailability.keyMetric).toBe(true);
      // eslint-disable-next-line no-console
      console.log(`\n[DAR-322] SHARE_BUYBACK ratio=6 → keyMetric=${r.scoreBreakdown.keyMetric}, ${r.buyScore} ${r.signal}`);
    });

    it('(DAR-322) THIRD_PARTY_ALLOTMENT 희석은 음수 keyMetric → 인플레이션 방지(분모 유지)', () => {
      const r = service.computeBuyScore(buildParams('THIRD_PARTY_ALLOTMENT', 'NEGATIVE', { dilutionRate: 25 }, LIVE));
      expect(r.scoreBreakdown.keyMetric).toBe(-80); // dr≥20 → -80
      expect(r.omittedBuckets).not.toContain('keyMetric');
      expect(r.dataAvailability.keyMetric).toBe(true);
    });

    it('(DAR-322) 임계 미달 magnitude 는 BUY 로 격상되지 않는다(보수성 증명)', () => {
      // 자사주 취득이지만 규모 미미(ratio=0.1 → keyMetric 0). 실평가(분모 유지)지만 점수가 낮아
      // 전체 buyScore 가 BUY 임계 미만에 머문다.
      const r = service.computeBuyScore(buildParams('SHARE_BUYBACK', 'POSITIVE', { buybackRatioToSales: 0.1 }, LIVE));
      expect(r.scoreBreakdown.keyMetric).toBe(0);
      expect(r.dataAvailability.keyMetric).toBe(true); // 규칙 있음 → 실평가(omit 아님)
      expect(r.buyScore).toBeLessThan(SIGNAL_GRADE_THRESHOLDS.BUY_CANDIDATE);
      expect(r.signal).not.toBe('BUY_CANDIDATE');
      expect(r.signal).not.toBe('STRONG_BUY_CANDIDATE');
      // eslint-disable-next-line no-console
      console.log(`\n[DAR-322 보수성] SHARE_BUYBACK ratio=0.1 → ${r.buyScore} ${r.signal} (BUY 격상 안 됨)`);
    });

    it('(a) UNKNOWN polarity(OTHER) personaViews 전부 NEUTRAL → personaFit omit', () => {
      const r = service.computeBuyScore(buildParams('OTHER', 'UNKNOWN', {}, LIVE));
      // OTHER → keyMetric 룰無, UNKNOWN → persona 전부 NEUTRAL: 둘 다 omit.
      expect(r.omittedBuckets).toContain('keyMetric');
      expect(r.omittedBuckets).toContain('personaFit');
      // 그럼에도 disclosureEvent(미분류 base 0)가 분모에 남아 OTHER 를 거짓 BUY 로 띄우지 않는다.
      expect(r.buyScore).toBeLessThan(SIGNAL_GRADE_THRESHOLDS.BUY_CANDIDATE);
    });

    it('(b) 규칙 있는 실제 저점 이벤트(SUPPLY_CONTRACT salesRatio<1)는 keyMetric 유지 → 분모 불변', () => {
      // 규칙은 있고 값이 저점(score 0)인 경우: "실제 평가" → 분모에서 빼지 않는다(인플레이션 방지).
      const r = service.computeBuyScore(buildParams('SUPPLY_CONTRACT', 'POSITIVE', { salesRatio: 0.5 }, LIVE));
      expect(r.scoreBreakdown.keyMetric).toBe(0);
      expect(r.omittedBuckets).not.toContain('keyMetric');
      expect(r.dataAvailability.keyMetric).toBe(true);
      // persona POSITIVE(비중립) → personaFit 도 유지.
      expect(r.omittedBuckets).not.toContain('personaFit');
    });

    it('(DAR-324) 소표본 PRELIMINARY 는 점진 반영되되 단독으로 BUY 로 격상시키지 않는다', () => {
      // historicalEvent 동일 통계(avgArD5=8·upProb 0.7·유의)에 표본만 바꿔
      // PRELIMINARY(n=10) → READY(n=45) 로 갈 때 기여가 단조 상승함을 본다(스냅 제거).
      const baseP = buildParams('OTHER', 'UNKNOWN', {}, LIVE);
      const withHist = (sampleCount: number) => ({
        ...baseP,
        historicalEvent: { avgArD5: 8, isSignificant: true, upProbD5: 0.7, crashProbD5: 0.05, sampleCount },
      });

      const prelim = service.computeBuyScore(withHist(10)); // PRELIMINARY 하한
      const prelimMid = service.computeBuyScore(withHist(25)); // PRELIMINARY 상단
      const ready = service.computeBuyScore(withHist(45)); // READY 완전 반영

      // 점진성: 표본↑ → historicalEvent 기여 단조 상승, 그러나 READY 가 상한.
      expect(prelim.scoreBreakdown.historicalEvent).toBeLessThan(prelimMid.scoreBreakdown.historicalEvent);
      expect(prelimMid.scoreBreakdown.historicalEvent).toBeLessThanOrEqual(ready.scoreBreakdown.historicalEvent);

      // ★인플레이션 방지: 미분류(OTHER·UNKNOWN) 공시는 강한 PRELIMINARY 과거성과가 붙어도
      //   historicalEvent 단일 버킷(가중 ~9%)만으로 BUY 임계(60)를 넘지 못한다.
      expect(prelim.buyScore).toBeLessThan(SIGNAL_GRADE_THRESHOLDS.BUY_CANDIDATE);
      expect(prelim.signal).not.toBe('BUY_CANDIDATE');
      expect(prelim.signal).not.toBe('STRONG_BUY_CANDIDATE');
      // READY 완전 반영조차 단독으로는 BUY 못 넘김(설계상 보조신호) → 점진 반영이 과신을 만들지 않음.
      expect(ready.buyScore).toBeLessThan(SIGNAL_GRADE_THRESHOLDS.BUY_CANDIDATE);

      // eslint-disable-next-line no-console
      console.log(
        `\n[DAR-324] historicalEvent 기여: PRELIM(n=10)=${prelim.scoreBreakdown.historicalEvent} ` +
          `< PRELIM(n=25)=${prelimMid.scoreBreakdown.historicalEvent} ≤ READY(n=45)=${ready.scoreBreakdown.historicalEvent} ` +
          `| buyScore PRELIM(n=10)=${prelim.buyScore} ${prelim.signal} (BUY 미격상)`,
      );
    });

    it('(c) 전버킷 가용 시 재정규화가 기존 가중치를 비트단위 보존(회귀 0)', () => {
      const allAvailable = (Object.keys(BUY_SCORE_WEIGHTS) as BucketKey[]).reduce(
        (acc, k) => ((acc[k] = true), acc),
        {} as BucketAvailability,
      );
      const { effectiveWeights, omittedBuckets } = renormalizeWeights(
        { ...BUY_SCORE_WEIGHTS },
        allAvailable,
      );
      expect(omittedBuckets).toEqual([]);
      for (const k of Object.keys(BUY_SCORE_WEIGHTS) as BucketKey[]) {
        // 부동소수 재나눗셈 없이 원본 가중치를 그대로 반환해야 한다.
        expect(Object.is(effectiveWeights[k], BUY_SCORE_WEIGHTS[k])).toBe(true);
      }
    });
  });
});
