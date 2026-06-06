/**
 * simulation-entry.ts — 모의운용 진입 기준(등급·사이징) 순수 Rule (DAR-51)
 *
 * 메인 테제: "정보 최대 수집 + 수익". BUY 0·WATCH만 쌓이는 현 데이터에서 P/L 검증 데이터를
 * 모으기 위해, 진입 기준을 `grade≥BUY`에서 **설정 가능 최소등급(기본 WATCH) AND entryReady**로
 * 확장한다. 등급별 차등 사이징(WATCH는 작게)으로 저등급 후보의 위험노출을 줄인다.
 *
 * ★ 모의 전용 — 실주문/주문수량/Risk 하드룰과 무관(순수 파라미터 함수, side-effect 0, AI 0).
 *   포지션 사이징은 "모의 가상원금 배분 비율"일 뿐 Engine5 Risk 하드룰을 대체/우회하지 않는다.
 */

/** SignalGrade 등급 서열 (높을수록 강한 매수). schema.prisma enum SignalGrade 와 1:1. */
export const GRADE_RANK: Record<string, number> = {
  STRONG_BUY_CANDIDATE: 5,
  BUY_CANDIDATE: 4,
  WATCH: 3,
  NEUTRAL: 2,
  AVOID: 1,
  BLOCKED: 0,
};

/**
 * 모의운용 진입 최소 등급(설정 상수). 기본 'WATCH'.
 * 추후 데이터 검증으로 'BUY_CANDIDATE' 등으로 상향/하향 조정 용이하게 한 곳에 분리.
 */
export const SIM_MIN_ENTRY_GRADE = 'WATCH';

/**
 * 등급별 포지션 사이징 계수 (기본 배분 예산 대비 비율).
 * WATCH는 검증 목적의 소액 진입 → 작게. 미정의 등급은 보수적으로 WATCH 계수 적용.
 */
export const GRADE_SIZING_FACTOR: Record<string, number> = {
  STRONG_BUY_CANDIDATE: 1.0,
  BUY_CANDIDATE: 0.75,
  WATCH: 0.4,
};

/**
 * 진입 자격 등급 목록 — minGrade 이상 서열의 등급만(매수측). 기본 WATCH면 {WATCH,BUY,STRONG}.
 * NEUTRAL/AVOID/BLOCKED(서열 < WATCH)는 자동 제외.
 */
export function entryEligibleGrades(minGrade: string = SIM_MIN_ENTRY_GRADE): string[] {
  const min = GRADE_RANK[minGrade] ?? GRADE_RANK.WATCH;
  return Object.keys(GRADE_RANK).filter((g) => GRADE_RANK[g] >= min);
}

/** 해당 등급이 진입 자격을 갖는지(minGrade 이상). */
export function isEntryEligibleGrade(
  grade: string,
  minGrade: string = SIM_MIN_ENTRY_GRADE,
): boolean {
  return (GRADE_RANK[grade] ?? -1) >= (GRADE_RANK[minGrade] ?? GRADE_RANK.WATCH);
}

/** 등급별 사이징 계수(0~1). 미정의 등급은 WATCH 계수로 폴백. */
export function gradeSizingFactor(grade: string): number {
  return GRADE_SIZING_FACTOR[grade] ?? GRADE_SIZING_FACTOR.WATCH;
}

/**
 * 등급별 차등 모의 매수 예산 = 기본예산 × 사이징계수. 음수 입력은 0으로 가드.
 * (실제 주문수량 결정 아님 — 가상원금의 종목별 배분 한도)
 */
export function entryBudget(baseBudget: number, grade: string): number {
  if (!(baseBudget > 0)) return 0;
  return baseBudget * gradeSizingFactor(grade);
}

/** 검증 메타 — 추후 "등급별 수익률" 상관 분석용 진입 스냅샷(grade·buyScore·계수). */
export interface EntryMeta {
  grade: string;
  buyScore: number;
  sizingFactor: number;
}

export function buildEntryMeta(grade: string, buyScore: number): EntryMeta {
  return { grade, buyScore, sizingFactor: gradeSizingFactor(grade) };
}
