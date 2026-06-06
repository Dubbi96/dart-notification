// AI 자기보고 confidence(0~1) → 3단계 평문 등급(과신 방지, DAR-56).
// 맨퍼센트 노출 금지 — 사용자는 '85%' 같은 정밀도 착시 대신 높음/보통/낮음만 본다.
// 색 단독 의미 금지를 위해 tone과 함께 항상 평문 label·아이콘을 동반한다.

export type ConfidenceTone = 'high' | 'medium' | 'low';

export interface ConfidenceLevel {
  /** 3단계 평문: 높음 | 보통 | 낮음 */
  label: '높음' | '보통' | '낮음';
  tone: ConfidenceTone;
  /** 색맹 대응: 등급별 형태가 다른 Feather 아이콘 */
  icon: 'check-circle' | 'circle' | 'alert-circle';
}

/**
 * confidence(0~1)를 3단계로 환산.
 * 경계: >=0.75 높음, >=0.5 보통, 그 외 낮음. NaN/범위 밖은 낮음으로 보수적 처리(과신 방지).
 */
export function confidenceLevel(confidence: number): ConfidenceLevel {
  const c = Number.isFinite(confidence) ? confidence : 0;
  if (c >= 0.75) {
    return { label: '높음', tone: 'high', icon: 'check-circle' };
  }
  if (c >= 0.5) {
    return { label: '보통', tone: 'medium', icon: 'circle' };
  }
  return { label: '낮음', tone: 'low', icon: 'alert-circle' };
}
