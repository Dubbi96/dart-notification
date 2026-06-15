// 투자거장 스타일 태그(styleTags) 평문 매핑 (DAR-313).
// 백엔드 philosophy.seed-data 의 styleTags 는 enum 키(VALUE·MOAT·LONG_TERM 등) 그대로 저장된다.
// 표기 기준: 사람이 읽는 영문 스타일 용어(투자 관용어는 영문 유지) — raw enum 언더스코어(LONG_TERM)를
//           화면 칩 라벨로 그대로 노출하지 않는다. 미매핑 키도 언더스코어를 공백으로 치환해 안전화.
// 백엔드 seed styleTags 전체와 1:1(VALUE·MOAT·LONG_TERM·GROWTH·GARP·QUANTITATIVE·MACRO·MOMENTUM).
export const STYLE_TAG_LABEL: Record<string, string> = {
  VALUE: 'VALUE',
  MOAT: 'MOAT',
  LONG_TERM: 'LONG TERM',
  GROWTH: 'GROWTH',
  GARP: 'GARP',
  QUANTITATIVE: 'QUANTITATIVE',
  MACRO: 'MACRO',
  MOMENTUM: 'MOMENTUM',
};

/**
 * styleTag enum 키 → 칩 표시 라벨.
 * 미매핑(향후 enum 추가 등)은 raw enum 대신 언더스코어를 공백으로 치환해 노출 — DAR-313.
 */
export function getStyleTagLabel(tag: string): string {
  return STYLE_TAG_LABEL[tag] ?? tag.replace(/_/g, ' ');
}
