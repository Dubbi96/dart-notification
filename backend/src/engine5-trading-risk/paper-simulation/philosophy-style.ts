/**
 * philosophy-style.ts — 철학 스타일별 모의운용 분기 순수 Rule (DAR-76, P-D)
 *
 * ★Main Thesis B(모의수익 검증). BUFFETT/LYNCH/GREENBLATT/DRUCKENMILLER 4개 거장
 * 스타일별로 모의 포트폴리오를 분기 운용해, 어느 스타일이 한국시장 공시에서 실제 모의수익을
 * 내는지 데이터로 변별한다. 이 모듈은 스타일 식별·진입 적격성·성과 비교 랭킹의 **순수 함수**만
 * 담는다(I/O·prisma·AI 0). side-effect 없는 결정론적 로직 → 단위 테스트로 검증.
 *
 * - 진입 적격성: engine2 philosophy-fit(Rule, AI 미개입) 적합도 ≥ 임계치인 스타일에만 후보 진입.
 * - 비교 랭킹: 스타일별 누적수익률로 정렬하되 표본 부족(LOW_SAMPLE)은 과신 방지 플래그 유지.
 *
 * 로드맵: docs/roadmap/cc-persona-philosophy-engine.md P-D
 */

/** 분기 운용 대상 4개 거장 스타일 — philosophyId(InvestorPhilosophy 자연키)와 1:1. */
export const PHILOSOPHY_STYLES = [
  'BUFFETT',
  'LYNCH',
  'GREENBLATT',
  'DRUCKENMILLER',
] as const;

export type PhilosophyStyle = (typeof PHILOSOPHY_STYLES)[number];

/** 스타일별 한글 라벨(모바일 표기용). */
export const STYLE_LABELS: Record<PhilosophyStyle, string> = {
  BUFFETT: '버핏',
  LYNCH: '린치',
  GREENBLATT: '그린블라트',
  DRUCKENMILLER: '드러켄밀러',
};

/** 모의운용 포트폴리오 이름 접두사(단일 시뮬과 공유). */
export const STYLE_PORTFOLIO_PREFIX = '모의운용 포트폴리오';

/**
 * 스타일별 진입 최소 적합도(0~100). philosophy-fit score 가 이 값 이상인 스타일에만 후보 진입.
 * 낮으면 모든 스타일이 동일 후보를 받아 변별력이 사라지고, 너무 높으면 표본이 안 쌓인다 — 중간값.
 */
export const STYLE_ENTRY_MIN_FIT = 50;

/** 스타일별 성과 비교에서 과신 방지 배지를 띄우는 표본 임계(미만이면 LOW_SAMPLE). */
export const STYLE_LOW_SAMPLE_THRESHOLD = 5;

/** 스타일 포트폴리오 이름 — 예: '모의운용 포트폴리오 [BUFFETT]'. */
export function stylePortfolioName(style: PhilosophyStyle): string {
  return `${STYLE_PORTFOLIO_PREFIX} [${style}]`;
}

/** 문자열 → PhilosophyStyle (유효하지 않으면 null). 컨트롤러 입력 가드용. */
export function parsePhilosophyStyle(value: string): PhilosophyStyle | null {
  return (PHILOSOPHY_STYLES as readonly string[]).includes(value)
    ? (value as PhilosophyStyle)
    : null;
}

/** philosophy-fit 결과에서 비교에 필요한 최소 필드(엔진 경계: DB 저장 재무 기반 Rule 점수). */
export interface PhilosophyFitLike {
  philosophyId: string;
  computable: boolean;
  score: number | null;
}

/**
 * 한 종목이 진입 적격인 스타일 목록 — fit.score ≥ minFit 이고 computable 인 스타일만.
 * 재무 결측(computable=false·score=null)은 자동 제외(거짓 진입 방지, DAR-39 정직 표기 계승).
 */
export function eligibleStylesForCompany(
  fits: PhilosophyFitLike[],
  minFit: number = STYLE_ENTRY_MIN_FIT,
): PhilosophyStyle[] {
  const byId = new Map<string, PhilosophyFitLike>();
  for (const f of fits) byId.set(f.philosophyId, f);
  return PHILOSOPHY_STYLES.filter((style) => {
    const f = byId.get(style);
    return !!f && f.computable && f.score !== null && f.score >= minFit;
  });
}

/** 특정 스타일이 종목에 진입 적격인지(eligibleStylesForCompany 의 단건 질의). */
export function isStyleEligible(
  style: PhilosophyStyle,
  fits: PhilosophyFitLike[],
  minFit: number = STYLE_ENTRY_MIN_FIT,
): boolean {
  return eligibleStylesForCompany(fits, minFit).includes(style);
}

/** 스타일 1종의 비교 랭킹 입력 행. */
export interface StyleReturnRow {
  style: PhilosophyStyle;
  /** 누적 수익률(%) — 데이터 없으면 0 */
  cumulativeReturnPct: number;
  /** 청산 표본 수 */
  sampleSize: number;
}

/** 스타일 비교 랭킹 결과. */
export interface StyleRanking {
  /** 누적수익률 내림차순 정렬된 스타일 목록(표본 유무 무관, 전체 포함) */
  ranking: PhilosophyStyle[];
  /**
   * 표본이 있는(sampleSize>0) 스타일 중 누적수익률 최고 — 변별 결론.
   * 표본 있는 스타일이 하나도 없으면 null(거짓 우승 방지).
   */
  bestStyle: PhilosophyStyle | null;
  /** 표본 있는 스타일이 모두 LOW_SAMPLE(미만) 이면 true → 결론 과신 금지. */
  allLowSample: boolean;
}

/**
 * 스타일별 누적수익률로 비교 랭킹을 만든다(순수 정렬).
 * - ranking: 전체 스타일을 누적수익률 desc 로 정렬(동률은 PHILOSOPHY_STYLES 순서 안정 정렬).
 * - bestStyle: 표본(sampleSize>0)이 있는 스타일 중 최고 수익률. 없으면 null.
 * - allLowSample: 표본 있는 스타일이 모두 임계 미만이면 true(또는 표본 스타일 0개).
 */
export function rankStyles(
  rows: StyleReturnRow[],
  lowSampleThreshold: number = STYLE_LOW_SAMPLE_THRESHOLD,
): StyleRanking {
  const order = new Map<PhilosophyStyle, number>();
  PHILOSOPHY_STYLES.forEach((s, i) => order.set(s, i));

  const sorted = [...rows].sort((a, b) => {
    if (b.cumulativeReturnPct !== a.cumulativeReturnPct) {
      return b.cumulativeReturnPct - a.cumulativeReturnPct;
    }
    return (order.get(a.style) ?? 0) - (order.get(b.style) ?? 0);
  });

  const withSample = sorted.filter((r) => r.sampleSize > 0);
  const bestStyle = withSample.length > 0 ? withSample[0].style : null;
  const allLowSample =
    withSample.length === 0 ||
    withSample.every((r) => r.sampleSize < lowSampleThreshold);

  return {
    ranking: sorted.map((r) => r.style),
    bestStyle,
    allLowSample,
  };
}
