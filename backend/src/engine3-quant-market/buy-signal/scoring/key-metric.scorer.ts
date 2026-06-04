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
