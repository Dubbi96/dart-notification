/**
 * invalidConditions 기계 평가 가능 구조화 타입 — M7 (DAR-11)
 *
 * AI 금지영역: 이 타입을 확장하거나 평가 로직에 AI를 사용하는 것은 절대 금지.
 * 모든 조건은 M2(정정공시)/M4(시세·지표)/M5(이벤트스터디) 데이터로 Rule 평가 가능해야 함.
 */

export type InvalidConditionType =
  | 'PRICE_BELOW'            // 현재가 특정 가격 이하
  | 'PRICE_ABOVE'            // 현재가 특정 가격 이상
  | 'AMENDMENT_NEGATIVE'     // 부정적 정정공시 발생 (M2)
  | 'THESIS_METRIC_BREACH'   // 핵심 지표/통계 임계값 위반 (M4/M5)
  | 'VOLUME_COLLAPSE'        // 거래량 급감 (M4)
  | 'EVENT_STUDY_UNDERPERFORM' // 이벤트스터디 기준 초과수익 미달 (M5)
  | 'STOP_LOSS_PCT'          // 진입가 대비 손실 % 초과
  | 'MAX_HOLD_DAYS';         // 최대 보유일 초과

// ─── 개별 InvalidCondition 타입 ──────────────────────────────────

export interface PriceBelowCondition {
  type: 'PRICE_BELOW';
  value: number; // 원
}

export interface PriceAboveCondition {
  type: 'PRICE_ABOVE';
  value: number; // 원
}

export interface AmendmentNegativeCondition {
  type: 'AMENDMENT_NEGATIVE';
}

export interface ThesisMetricBreachCondition {
  type: 'THESIS_METRIC_BREACH';
  metric: string;   // 예: 'rsi14', 'avgArD5', 'salesRatio'
  threshold: number;
}

export interface VolumeCollapseCondition {
  type: 'VOLUME_COLLAPSE';
  threshold: number; // 20일 평균 대비 비율 (0~1), 예: 0.5 = 50% 미만
}

export interface EventStudyUnderperformCondition {
  type: 'EVENT_STUDY_UNDERPERFORM';
  horizon: 'D1' | 'D3' | 'D5' | 'D20';
  threshold: number; // % (예: 0 = 시장 대비 초과수익 0% 미달)
}

export interface StopLossPctCondition {
  type: 'STOP_LOSS_PCT';
  value: number; // % 손실 (양수, 예: 8 = 8% 손실)
}

export interface MaxHoldDaysCondition {
  type: 'MAX_HOLD_DAYS';
  value: number; // 일
}

export type InvalidCondition =
  | PriceBelowCondition
  | PriceAboveCondition
  | AmendmentNegativeCondition
  | ThesisMetricBreachCondition
  | VolumeCollapseCondition
  | EventStudyUnderperformCondition
  | StopLossPctCondition
  | MaxHoldDaysCondition;

// ─── ExitRule 타입 (청산룰, AI 변경 불가) ─────────────────────────

export type ExitRuleType =
  | 'STOP_LOSS_PCT'   // 손절 %
  | 'TAKE_PROFIT_PCT' // 익절 %
  | 'MAX_HOLD_DAYS'   // 최대 보유일
  | 'INVALIDATION_TRIGGER'; // invalidConditions 조건 충족 시 청산

export interface ExitRule {
  type: ExitRuleType;
  value?: number;
}

// ─── 타입 가드 ─────────────────────────────────────────────────────

const VALID_CONDITION_TYPES = new Set<InvalidConditionType>([
  'PRICE_BELOW',
  'PRICE_ABOVE',
  'AMENDMENT_NEGATIVE',
  'THESIS_METRIC_BREACH',
  'VOLUME_COLLAPSE',
  'EVENT_STUDY_UNDERPERFORM',
  'STOP_LOSS_PCT',
  'MAX_HOLD_DAYS',
]);

export function isValidInvalidConditionType(
  type: string,
): type is InvalidConditionType {
  return VALID_CONDITION_TYPES.has(type as InvalidConditionType);
}

/**
 * JSON에서 역직렬화한 invalidConditions 배열의 기계 평가 가능성 검증.
 * 추상 자연어 조건이 포함된 경우 false 반환.
 */
export function validateInvalidConditions(conditions: unknown[]): boolean {
  if (!Array.isArray(conditions) || conditions.length === 0) return false;
  return conditions.every(
    (c) =>
      typeof c === 'object' &&
      c !== null &&
      'type' in c &&
      typeof (c as Record<string, unknown>)['type'] === 'string' &&
      isValidInvalidConditionType(
        (c as Record<string, unknown>)['type'] as string,
      ),
  );
}
