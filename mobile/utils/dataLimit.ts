// 데이터 한계 판정 통일 규약(DAR-121, 신뢰 원칙 §6) — 과신·블랙박스 방지.
// 스펙: 표본<30 또는 통계 미유의(totalSample<30 OR !isSignificant) 시 '데이터 한계'.
// 화면마다 임계(30 vs 5)·라벨('LOW_SAMPLE'·'표본 부족'·'데이터 한계')이 제각각이던 것을
// 단일 순수 판정 + DataLimitBadge 로 일관화한다. read-only·부수효과 없음.

/** 통계 신뢰도 제한 임계 표본수. 이 값 미만이면 '데이터 한계'. */
export const DATA_LIMIT_SAMPLE_THRESHOLD = 30;

export interface DataLimitInput {
  /** 표본수(없으면 0으로 간주 → 데이터 한계). */
  sampleCount?: number | null;
  /**
   * 통계 유의성. 명시되면 false 일 때 표본수와 무관하게 데이터 한계.
   * 유의성 개념이 없는 화면(표본수만 있는 경우)은 생략한다.
   */
  isSignificant?: boolean;
  /** 임계 표본수 override(기본 30). 화면별 별도 임계가 필요한 예외 경로에만 사용. */
  threshold?: number;
}

/**
 * 데이터 한계 여부 순수 판정.
 * - sampleCount 가 임계 미만이면 true(표본 부족).
 * - isSignificant 가 명시되고 false 면 true(통계 미유의).
 * - 둘 다 통과해야 false(데이터 충분).
 */
export function isDataLimited({
  sampleCount,
  isSignificant,
  threshold = DATA_LIMIT_SAMPLE_THRESHOLD,
}: DataLimitInput): boolean {
  const n = typeof sampleCount === 'number' && Number.isFinite(sampleCount) ? sampleCount : 0;
  if (n < threshold) return true;
  if (isSignificant === false) return true;
  return false;
}
