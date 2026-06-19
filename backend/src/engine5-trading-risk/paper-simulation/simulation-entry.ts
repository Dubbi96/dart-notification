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

/**
 * DAR-362: buyScore(확신도) 기반 사이징 가중 — 등급계수만으로는 차등이 무력화되는 문제 교정.
 *
 * 현 데이터는 후보가 거의 전부 WATCH(단일 등급)라 등급계수(0.4)만 곱하면 전 포지션이
 * ~균일(40만)해진다. buyScore(-100~100, 확신도)로 "등급 내 차등"을 실효화한다:
 *   buyScore ≥ HIGH → 가중 1.0(등급계수 그대로, 고확신은 더)
 *   buyScore ≤ LOW  → 가중 FLOOR(저확신은 덜, 완전 0은 방지)
 *   사이는 선형 보간.
 *
 * ★ 가중계수는 항상 (0, 1] → entrySizingFactor = 등급계수 × buyScore가중 ≤ 등급계수 ≤ 1.0.
 *   따라서 종목당 예산은 항상 baseBudget(=가상원금×maxSinglePositionPct) 이내로,
 *   Risk 하드룰(단일종목 최대비중)을 상향하거나 우회하지 않는다(순수 Rule, AI 0).
 */
export const SIZING_SCORE_REF_HIGH = 80;
export const SIZING_SCORE_REF_LOW = 20;
export const SIZING_SCORE_MULT_FLOOR = 0.5;

export function buyScoreSizingMultiplier(buyScore: number): number {
  if (!Number.isFinite(buyScore)) return SIZING_SCORE_MULT_FLOOR;
  if (buyScore >= SIZING_SCORE_REF_HIGH) return 1.0;
  if (buyScore <= SIZING_SCORE_REF_LOW) return SIZING_SCORE_MULT_FLOOR;
  const t =
    (buyScore - SIZING_SCORE_REF_LOW) /
    (SIZING_SCORE_REF_HIGH - SIZING_SCORE_REF_LOW);
  return SIZING_SCORE_MULT_FLOOR + t * (1 - SIZING_SCORE_MULT_FLOOR);
}

/** 등급 × buyScore 결합 사이징 계수(0~1]. 고확신 종목 더, 저확신 덜. */
export function entrySizingFactor(grade: string, buyScore: number): number {
  return gradeSizingFactor(grade) * buyScoreSizingMultiplier(buyScore);
}

/**
 * DAR-362: 등급 + buyScore 차등 모의 매수 예산 = 기본예산 × 결합계수. 음수예산은 0 가드.
 * 항상 baseBudget 이내(Risk 하드룰 보존). 실제 주문수량 결정 아님(가상원금 배분 한도).
 */
export function entryBudgetScored(
  baseBudget: number,
  grade: string,
  buyScore: number,
): number {
  if (!(baseBudget > 0)) return 0;
  return baseBudget * entrySizingFactor(grade, buyScore);
}

/**
 * DAR-362: 섹터(업종) 분산 가드 — 동일 섹터 비중 상한(maxSectorPct)을 진입에서 enforce.
 *
 * 해당 섹터의 현재 보유가치 기준 "추가로 허용되는 예산(원)"을 반환한다.
 *   허용예산 = max(0, 포트폴리오총액 × maxSectorPct/100 − 현재섹터보유가치)
 * 상한 도달/초과 시 0(더 못 담음). 음수·0 입력은 0으로 가드.
 *
 * ★ 순수 Rule(AI 0). 섹터 미상(industryCode null) 종목은 호출부에서 가드를 면제한다 —
 *   데이터가 없는 상한을 강제하면 전 종목 진입 차단(거짓 보수)이 되므로.
 */
export function sectorHeadroomBudget(
  currentSectorValue: number,
  portfolioTotalValue: number,
  maxSectorPct: number,
): number {
  if (!(portfolioTotalValue > 0) || !(maxSectorPct > 0)) return 0;
  const cap = portfolioTotalValue * (maxSectorPct / 100);
  return Math.max(0, cap - Math.max(0, currentSectorValue));
}

/**
 * DAR-362: 후보 pool 확대용 품질 하한 — entryReady 후보로 슬롯이 안 차면, entryReady가
 * 아니어도 buyScore가 이 하한 이상인 상위 후보로 채운다(진입품질 가드 유지·무차별 확대 아님).
 * entryReady WATCH+ 의 실측 buyScore 분포(min 30) 위쪽으로 보수 설정.
 */
export const ENTRY_FALLBACK_MIN_BUY_SCORE = 50;

/** 검증 메타 — 추후 "등급별 수익률" 상관 분석용 진입 스냅샷(grade·buyScore·계수). */
export interface EntryMeta {
  grade: string;
  buyScore: number;
  sizingFactor: number;
}

export function buildEntryMeta(grade: string, buyScore: number): EntryMeta {
  return { grade, buyScore, sizingFactor: gradeSizingFactor(grade) };
}

/**
 * 모의 매수 후보 종목당 1건 디듑(DAR-122).
 *
 * 한 종목(corpCode)은 4 Persona(또는 다수 공시)당 TradingSignal 행을 가질 수 있어,
 * 후보 목록에 동일 corpCode가 여러 번 들어온다. 디듑 없이 루프를 돌면 같은 종목에
 * Position이 중복 생성된다(★코칩 4행 중복의 근본원인). 종목당 최선 1건만 남긴다.
 *
 * 선정 규칙(결정론적): buyScore 내림차순 → 등급 서열 내림차순 → id 오름차순.
 * 입력 순서와 무관하게 동일 결과(재실행 멱등성). side-effect 0.
 */
export interface DedupeCandidate {
  id: string;
  corpCode: string;
  buyScore: number;
  signal: string;
}

function isBetterCandidate(a: DedupeCandidate, b: DedupeCandidate): boolean {
  if (a.buyScore !== b.buyScore) return a.buyScore > b.buyScore;
  const ra = GRADE_RANK[a.signal] ?? -1;
  const rb = GRADE_RANK[b.signal] ?? -1;
  if (ra !== rb) return ra > rb;
  return a.id < b.id;
}

export function dedupeCandidatesByCorpCode<T extends DedupeCandidate>(
  candidates: readonly T[],
): T[] {
  const best = new Map<string, T>();
  for (const c of candidates) {
    const prev = best.get(c.corpCode);
    if (!prev || isBetterCandidate(c, prev)) {
      best.set(c.corpCode, c);
    }
  }
  // 결정론적 출력 순서: buyScore desc → 등급 desc → id asc
  return [...best.values()].sort((a, b) => (isBetterCandidate(a, b) ? -1 : 1));
}
