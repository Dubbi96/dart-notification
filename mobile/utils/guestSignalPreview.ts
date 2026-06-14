// DAR-213: 게스트(비로그인) 신호 미리보기 정본 데이터·카피.
//
// 배경: 매수·매도 신호 엔드포인트는 전부 인증 필요(401, signals.controller @UseGuards).
// 따라서 게스트는 실데이터를 받을 수 없다. '가치 체험'은 실데이터/실점수를 약속하지
// 않으면서, 신호 카드의 '구조'만 블러+잠금 오버레이로 맛보게 한다.
//
// 정직 원칙(§2, 과대약속 금지):
//   - 실종목·실점수·실등급을 노출하지 않는다(가짜 BUY 금지).
//   - 카드는 마스킹된 '예시' 실루엣이며, 위에 블러+잠금 오버레이를 덮어 수치가
//     읽히지 않게 한다. '예시' 배지로 실데이터 아님을 명시한다.

export interface GuestPreviewCard {
  /** 마스킹된 예시 종목 표기(실종목 아님 — 구조 전달용). */
  maskedName: string;
  /** 게이지 실루엣 채움 비율(0~1). 수치 텍스트는 노출하지 않는다. */
  fill: number;
}

// 게스트에게 보여줄 예시 카드 실루엣(최대 2건, read-only).
export const GUEST_PREVIEW_CARDS: GuestPreviewCard[] = [
  { maskedName: '○○ 기업', fill: 0.82 },
  { maskedName: '○○○ 기업', fill: 0.91 },
];

// 미리보기 잠금/예시 표기 카피 정본.
export const GUEST_PREVIEW_COPY = {
  /** 블러 위 잠금 배지 — 로그인 유도. */
  lockBadge: '로그인하면 실제 신호를 볼 수 있어요',
  /** 카드가 실데이터가 아닌 예시임을 명시하는 배지. */
  exampleBadge: '예시',
} as const;

/**
 * 노출할 미리보기 카드 수를 [1, 보유 카드 수] 범위로 고정한다(게스트 read-only 1~2건).
 * 음수·0·과대 요청을 모두 흡수해 항상 최소 1건은 맛보게 한다.
 */
export function guestPreviewCards(count: number): GuestPreviewCard[] {
  const max = GUEST_PREVIEW_CARDS.length;
  const n = Math.max(1, Math.min(max, Math.floor(count)));
  return GUEST_PREVIEW_CARDS.slice(0, n);
}
