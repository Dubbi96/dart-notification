// 철학 지표 표시 헬퍼 (DAR-54) — metricKey → 한국어 짧은 라벨 + 값/기준 포맷.
// 순수 함수(RN 비의존) — 결정론적 단위 검증 가능.
import type {
  MetricEvaluation,
  PhilosophyMetricOperator,
  PhilosophySourceType,
} from '@app-types/philosophy.types';

/** 출처 유형 → 한국어 라벨. */
const SOURCE_TYPE_LABELS: Record<PhilosophySourceType, string> = {
  BOOK: '저서',
  SHAREHOLDER_LETTER: '주주서한',
  INTERVIEW: '인터뷰',
  PUBLIC_STATEMENT: '공개발언',
};

export function sourceTypeLabel(type: PhilosophySourceType): string {
  return SOURCE_TYPE_LABELS[type] ?? '출처';
}

/** 지표 키 → 한국어 짧은 라벨(없으면 키 그대로). */
const METRIC_LABELS: Record<string, string> = {
  ROE: 'ROE',
  ROA: 'ROA',
  DEBT_RATIO: '부채비율',
  PER: 'PER',
  PBR: 'PBR',
  OPERATING_MARGIN: '영업이익률',
  PEG: 'PEG',
  EPS_GROWTH_YOY: 'EPS 성장률',
  REVENUE_GROWTH_YOY: '매출 성장률',
  MARKET_CAP_TIER: '시가총액',
  ROC: 'ROC',
  EARNINGS_YIELD: '이익수익률',
  FCF_POSITIVE: '잉여현금흐름',
  MOAT_SCORE: '해자 점수',
  PRICE_NEAR_52W_HIGH: '52주 고점 근접',
  RELATIVE_STRENGTH_1M: '상대강도(1M)',
  VOLUME_TREND: '거래량 추세',
  MACRO_ENV_SCORE: '매크로 환경',
  INSTITUTIONAL_BUYING: '기관·외국인 수급',
};

export function metricLabel(metricKey: string): string {
  return METRIC_LABELS[metricKey] ?? metricKey;
}

/** % 도메인 지표(소수 비율이 아니라 퍼센트 단위) 여부. */
const PERCENT_METRICS = new Set([
  'ROE',
  'ROA',
  'DEBT_RATIO',
  'OPERATING_MARGIN',
  'EPS_GROWTH_YOY',
  'REVENUE_GROWTH_YOY',
]);

/** 실제 값(결측 시 '—'). 퍼센트 지표는 % 부착. */
export function formatMetricValue(ev: Pick<MetricEvaluation, 'metricKey' | 'value'>): string {
  if (ev.value == null) return '—';
  const rounded = Math.round(ev.value * 10) / 10;
  return PERCENT_METRICS.has(ev.metricKey) ? `${rounded}%` : `${rounded}`;
}

const OP_SYMBOL: Record<PhilosophyMetricOperator, string> = {
  GT: '≥',
  LT: '≤',
  EQ: '=',
  RANGE: '범위',
};

/** 기준 표현(예: 'ROE ≥ 15', '부채비율 ≤ 50'). RANGE 는 하한~상한. */
export function formatThreshold(
  ev: Pick<MetricEvaluation, 'metricKey' | 'operator' | 'threshold' | 'thresholdMax'>,
): string {
  const label = metricLabel(ev.metricKey);
  if (ev.operator === 'RANGE') {
    const upper = ev.thresholdMax ?? ev.threshold;
    return `${label} ${ev.threshold}~${upper}`;
  }
  return `${label} ${OP_SYMBOL[ev.operator]} ${ev.threshold}`;
}

/** 통과/미달/결측 라벨. */
export function passLabel(passed: boolean | null): '통과' | '미달' | '평가불가' {
  if (passed === null) return '평가불가';
  return passed ? '통과' : '미달';
}
