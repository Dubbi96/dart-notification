/**
 * C2. 핵심 수치 점수 (KeyMetricScore)
 * 이벤트 타입별 추출된 수치를 점수화
 * AI 금지영역: 순수 Rule 함수. AI/LLM 개입 절대 금지.
 */

export interface KeyMetricInput {
  eventType: string;
  extractedData: Record<string, number | string | null>;
}

function num(v: number | string | null | undefined, fallback = 0): number {
  if (v == null) return fallback;
  const n = Number(v);
  return isNaN(n) ? fallback : n;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/**
 * key-metric 채점 규칙이 정의된 이벤트 타입 집합 (SSOT).
 *
 * 아래 scoreKeyMetric 의 switch case 집합과 1:1 정합을 유지한다(둘 중 하나만 바뀌면
 * key-metric.scorer.spec 의 parity 단언이 깨지도록 묶었다). 이 집합 밖의 이벤트는
 * scoreKeyMetric 이 default → 0("미채점") 을 반환한다.
 */
export const KEY_METRIC_RULE_EVENT_TYPES: ReadonlySet<string> = new Set([
  'SUPPLY_CONTRACT',
  'SHARE_CANCELLATION',
  'DIVIDEND_INCREASE',
  'PAID_IN_CAPITAL_INCREASE',
  'CB_ISSUANCE',
  'EARNINGS_SURPRISE',
  // DAR-322: 고빈도 한국 catalyst 3종을 omit→실평가로 승격(이미 추출된 magnitude 재사용).
  'SHARE_BUYBACK',
  'THIRD_PARTY_ALLOTMENT',
  'MAJOR_SHAREHOLDER_CHANGE',
]);

/**
 * 이벤트 타입에 key-metric 채점 규칙이 존재하는지 판별하는 순수 헬퍼 (DAR-321).
 *
 * 구분의 핵심:
 *  - 규칙이 있는 이벤트의 중립/저점 0 → "실제 평가" → 재정규화 분모 유지가 타당.
 *  - 규칙 자체가 없는(default → 0, "미채점") 이벤트의 0 → "데이터 없음" 기본값 →
 *    분모에서 제외(omit)해야 한다(insider/fundamental 의 기존 omit 패턴과 동일).
 *
 * 스코어 로직(scoreKeyMetric) 자체는 불변. 이 헬퍼는 가용 판정 전용.
 */
export function hasKeyMetricRule(eventType: string): boolean {
  return KEY_METRIC_RULE_EVENT_TYPES.has(eventType);
}

export function scoreKeyMetric(input: KeyMetricInput): number {
  const m = input.extractedData;

  switch (input.eventType) {
    case 'SUPPLY_CONTRACT': {
      const ratio = num(m['salesRatio']);
      if (ratio >= 30) return 100;
      if (ratio >= 20) return 80;
      if (ratio >= 10) return 60;
      if (ratio >= 5)  return 40;
      if (ratio >= 1)  return 20;
      return 0;
    }

    case 'SHARE_CANCELLATION': {
      const cr = num(m['cancellationRatio']);
      if (cr >= 5) return 100;
      if (cr >= 3) return 80;
      if (cr >= 1) return 60;
      return 30;
    }

    case 'DIVIDEND_INCREASE': {
      const dy = num(m['yoyDividendGrowth']);
      if (dy >= 50) return 100;
      if (dy >= 20) return 70;
      if (dy >= 5)  return 40;
      return 10;
    }

    case 'PAID_IN_CAPITAL_INCREASE': {
      const dr = num(m['dilutionRate']);
      if (dr >= 30) return -100;
      if (dr >= 20) return -80;
      if (dr >= 10) return -60;
      if (dr >= 5)  return -40;
      return -20;
    }

    case 'CB_ISSUANCE': {
      const fundingAmount = num(m['fundingAmount']);
      const marketCap = num(m['marketCap'], 1);
      const cbRatio = marketCap > 0 ? (fundingAmount / marketCap) * 100 : 0;
      if (cbRatio >= 20) return -80;
      if (cbRatio >= 10) return -50;
      return -20;
    }

    case 'EARNINGS_SURPRISE': {
      const sr = num(m['surpriseRate']);
      if (sr >= 30) return 100;
      if (sr >= 15) return 70;
      if (sr >= 5)  return 40;
      return 10;
    }

    // ─── DAR-322: 고빈도 catalyst 3종 (이미 추출된 magnitude 재사용, 신규 추출 없음) ───

    case 'SHARE_BUYBACK': {
      // 호재(자사주 취득). buybackRatioToSales = 취득금액/매출 * 100 (share-buyback 추출기 파생값).
      // SUPPLY_CONTRACT(salesRatio) 패턴과 동형이되, 자사주 취득은 통상 매출 대비 규모가 작아
      // 임계를 더 보수적으로 설정(인플레이션 방지). 규모 결측/미미 → 0(BUY 격상 안 됨).
      const ratio = num(m['buybackRatioToSales']);
      if (ratio >= 10)  return 100;
      if (ratio >= 5)   return 80;
      if (ratio >= 2)   return 60;
      if (ratio >= 1)   return 40;
      if (ratio >= 0.2) return 20;
      return 0;
    }

    case 'THIRD_PARTY_ALLOTMENT': {
      // 희석성 증자(악재 성격, classifier polarity=NEGATIVE). dilutionRate = 신주/(신주+기존)*100,
      // PAID_IN_CAPITAL_INCREASE 와 동일한 capital-increase 추출기 SSOT 필드 재사용.
      // 전 구간 음수로 감점하되, 희석률 미미/결측은 0(조건부: 전략적 투자자 유치형 소규모 3자배정은
      // 자동 감점하지 않음 — 이슈의 "음 또는 조건부" 반영). PAID_IN(전구간 -, 하한 -20)보다 완화.
      const dr = num(m['dilutionRate']);
      if (dr >= 30) return -100;
      if (dr >= 20) return -80;
      if (dr >= 10) return -60;
      if (dr >= 5)  return -40;
      if (dr >= 1)  return -20;
      return 0;
    }

    case 'MAJOR_SHAREHOLDER_CHANGE': {
      // 최대주주 변경(classifier polarity=MIXED). keyMetric scorer 에 전달되는 extractedData 에는
      // ratioChange(지분 변동 delta)가 존재하지 않는다 — 그 필드는 InsiderHoldingChange 모델의 값으로
      // insider scorer 로만 흐른다. 본 이벤트의 추출기(major-shareholder-change)가 산출하는 정량 필드는
      // ownershipRatio(변경 후 최대주주 지분율, %)뿐이다. 신규 추출/배선 금지 제약하에 이 값을 사용한다.
      // 의미: 새 최대주주의 결과 지분율이 클수록(경영권 안정·턴어라운드 기대) 완만한 양(+). 단 MIXED
      // (적대적 인수 가능성)라서 방향 불확실 → STRONG 영역까지 올리지 않고 보수적 상한(+50)·하한 0.
      const ratio = num(m['ownershipRatio']);
      if (ratio >= 50) return 50;
      if (ratio >= 30) return 35;
      if (ratio >= 15) return 20;
      return 0;
    }

    default:
      return 0;
  }
}
