/**
 * 진입 조건 평가 — 점수 계산과 독립된 체크리스트
 * entryReady = 필수 조건 전부 충족
 * AI 금지영역: 수치 조건 체크만. AI 개입 없음.
 */

export interface EntryConditionInput {
  closePrice: number | null;
  ma20: number | null;
  rsi14: number | null;
  tradingValue: number | null;   // 당일 거래대금 (원)
  volumeRatio20: number | null;  // 20일 평균 거래량 대비 비율
}

export interface EntryConditionResult {
  met: string[];
  unmet: string[];
  entryReady: boolean;
}

interface EntryRule {
  id: string;
  label: string;
  required: boolean;
  check: (i: EntryConditionInput) => boolean;
}

const ENTRY_RULES: EntryRule[] = [
  {
    id: 'ABOVE_MA20',
    label: '현재가가 20일 이동평균선 위',
    required: true,
    check: (i) => i.closePrice != null && i.ma20 != null && i.closePrice > i.ma20,
  },
  {
    id: 'NOT_OVERBOUGHT',
    label: 'RSI 70 미만(과열 미도달)',
    required: true,
    check: (i) => i.rsi14 != null && i.rsi14 < 70,
  },
  {
    id: 'MIN_LIQUIDITY',
    label: '거래대금 10억 이상(최소 유동성)',
    required: true,
    check: (i) => i.tradingValue != null && i.tradingValue >= 1_000_000_000,
  },
  {
    id: 'VOLUME_SURGE_300',
    label: '공시 후 거래량 20일 평균 대비 300% 이상',
    required: false,
    check: (i) => i.volumeRatio20 != null && i.volumeRatio20 >= 3.0,
  },
];

export function evaluateEntryConditions(
  input: EntryConditionInput,
): EntryConditionResult {
  const met: string[] = [];
  const unmet: string[] = [];

  for (const rule of ENTRY_RULES) {
    if (rule.check(input)) {
      met.push(rule.label);
    } else {
      unmet.push(rule.label);
    }
  }

  const hasRequiredUnmet = ENTRY_RULES.some(
    (r) => r.required && unmet.includes(r.label),
  );

  return {
    met,
    unmet,
    entryReady: !hasRequiredUnmet,
  };
}
