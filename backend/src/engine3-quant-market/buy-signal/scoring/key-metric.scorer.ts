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

    default:
      return 0;
  }
}
