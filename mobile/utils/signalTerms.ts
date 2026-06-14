// utils/signalTerms.ts — 신호 도메인 용어 위계 단일 정본(SSOT) (DAR-217)
//
// 문제: 같은 데이터(공시 기반 매수 시그널)가 화면마다 '투자판단'·'매수 신호'·'Buy Score'로
// 혼용되어, 신규 사용자가 홈 '오늘의 투자판단' = 신호 탭임을 스스로 추론해야 했다.
// 게다가 일부 카드의 a11y 라벨이 시각 헤더와 다른 어휘를 써서 화면낭독 불일치가 있었다
// (데이터정합·copy 감사 배치4, 2026-06-14).
//
// 해결: 용어 위계를 이 파일 1곳에 명문화하고, 모든 화면/카드/접근성 라벨이
// 여기서 문구를 가져가 드리프트를 차단한다. 카피 변경은 반드시 이 파일에서만 한다.
//
// ── 용어 위계(3단) ───────────────────────────────────────────────
//   L0 탭 라벨        : '신호'       — 5탭 IA(app/(tabs)/_layout). 도메인 진입점.
//   L1 화면/섹션 헤더 : '투자판단'    — 상위 '우산' 개념. 예) 홈 '오늘의 투자판단',
//                                     화면 단위 로딩/에러 상태 문구.
//   L2 개별 카드/점수 : '매수 신호' + 'Buy Score'
//                                   — 개별 시그널 카드와 점수는 항상 이 고정 어휘.
//
// ── 규칙 ─────────────────────────────────────────────────────────
//   1) 화면/섹션 헤더는 L1('투자판단') 어휘를 쓴다(우산 개념).
//   2) 개별 카드·점수 라벨과 그 a11y는 항상 L2('매수 신호'/'Buy Score')로 고정한다.
//   3) a11y 라벨은 그 요소의 시각 헤더와 같은 위계의 어휘를 쓴다(시각=a11y 어휘 일치).
//   4) 카드 a11y는 buildSignalCardA11yLabel로만 만들어 전 카드 동일 포맷을 보장한다.

export const SIGNAL_TERMS = {
  /** L0 — 도메인 탭 라벨(신호 탭). */
  tab: '신호',
  /** L1 — 화면/섹션 우산 헤더 어휘. */
  screenHeader: '투자판단',
  /** L1 — 홈 프리뷰 섹션 헤더(우산, 정본 문구). */
  homeHeader: '오늘의 투자판단',
  /** L2 — 개별 매수 시그널 카드 명사. */
  card: '매수 신호',
  /** L2 — 매수 점수 라벨(영문 고정). */
  buyScore: 'Buy Score',
  /** L2 — 청산 점수 라벨(영문 고정). */
  exitScore: 'Exit Score',
} as const;

/**
 * 매수 신호 카드 공통 접근성 라벨(SSOT) — 전 카드 동일 포맷·동일 어휘 보장.
 * 시각 위계(L2)와 일치: 항상 '매수 신호' + 'Buy Score'를 포함하고 '투자판단'은 쓰지 않는다.
 * @param corpName    기업명
 * @param buyScore    매수 점수(0~100)
 * @param gradeText   gradeLabel(grade) 결과(한국어 등급 문구)
 * @param riskSummary 선택 — 위험 요약(있으면 끝에 덧붙임)
 */
export function buildSignalCardA11yLabel({
  corpName,
  buyScore,
  gradeText,
  riskSummary,
}: {
  corpName: string;
  buyScore: number;
  gradeText: string;
  riskSummary?: string | null;
}): string {
  const base = `${corpName} ${SIGNAL_TERMS.card}, ${SIGNAL_TERMS.buyScore} ${buyScore}점, ${gradeText}`;
  return riskSummary ? `${base}, ${riskSummary}` : base;
}
