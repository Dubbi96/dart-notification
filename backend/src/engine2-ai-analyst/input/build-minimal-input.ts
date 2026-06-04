/**
 * 입력 최소화 계약 — 원문 전문을 AI에 넣지 않는다.
 * 핵심 단락만 절단(≈2,000 토큰)하고, 핵심 수치는 별도 전달한다.
 */
export const MAX_EXCERPT_CHARS = 4_000; // 한글 기준 보수적 ≈ 2,000 토큰

export function buildExcerpt(text: string): string {
  const t = (text ?? '').trim();
  return t.length <= MAX_EXCERPT_CHARS ? t : t.slice(0, MAX_EXCERPT_CHARS);
}

/** keyMetrics(수치)를 프롬프트용 간결 문자열로 직렬화 */
export function formatKeyMetrics(metrics: Record<string, unknown>): string {
  return Object.entries(metrics ?? {})
    .map(([k, v]) => `- ${k}: ${typeof v === 'object' ? JSON.stringify(v) : String(v)}`)
    .join('\n');
}
