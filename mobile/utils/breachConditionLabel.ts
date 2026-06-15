// Thesis 훼손조건(invalidConditions) enum → 한국어 라벨 매핑 (DAR-314).
// 백엔드 position-thesis.service 는 invalidConditions[].type(enum 원문)을 그대로
// label 로 내려보낸다(PRICE_BELOW·AMENDMENT_NEGATIVE …). Thesis 화면이 이를 매핑 없이
// 렌더해 영문 enum 이 그대로 노출됐다(상용앱 품질 저하, DAR-306 와 동류의 enum 누출).
// SSOT = 백엔드 invalid-condition.types.ts 의 InvalidConditionType union 전 값(8종)과 1:1.
// 백엔드 thesis 로직은 미접촉 — 모바일 표시 라벨만 부여한다.
export const BREACH_CONDITION_LABEL: Record<string, string> = {
  PRICE_BELOW: '주가 목표가 이하 하락',
  PRICE_ABOVE: '주가 목표가 이상 상승',
  AMENDMENT_NEGATIVE: '정정공시(부정적) 발생',
  THESIS_METRIC_BREACH: '핵심 지표 임계값 위반',
  VOLUME_COLLAPSE: '거래량 급감',
  EVENT_STUDY_UNDERPERFORM: '이벤트 대비 수익 미달',
  STOP_LOSS_PCT: '손실 한도 초과',
  MAX_HOLD_DAYS: '최대 보유일 초과',
};

// 미매핑(향후 enum 추가 등)도 raw enum 대신 안전한 한국어 기본 라벨로 노출 — DAR-314 DoD.
export const BREACH_CONDITION_FALLBACK = '기타 훼손 조건';

/**
 * 훼손조건 enum 키 → Thesis 화면 표시 라벨.
 * 미매핑이면 raw enum 을 내보내지 않고 안전 한국어 기본값을 반환한다(raw 누출 차단).
 */
export function getBreachConditionLabel(type: string): string {
  return BREACH_CONDITION_LABEL[type] ?? BREACH_CONDITION_FALLBACK;
}
