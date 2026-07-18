// DAR-558: 첫 Play 빌드에서 Pro 업셀 표면 전면 제외 — 공개 빌드 게이팅.
//
// PM 결정 D1(cc-apk-feedback-triage-2026-07-18.md): 혜택 4개 중 3개가 구현 전무한 광고 카피라
// Google Play Misleading Claims 리스크. 첫 Play 빌드는 Pro 표면 자체를 숨기고, 내부 채널(oci)은
// 카피만 정직화해 유지한다. utils/tradingVisibility.ts(DAR-549)와 동일한 빌드타임 플래그 패턴.
//
// 플래그: EXPO_PUBLIC_SHOW_PRO_UPSELL (Expo/Metro 가 빌드 시 번들에 정적 인라인).
//   - 미설정/그 외 값 → true  (기존 oci·preview·production 채널 무변경, 회귀 0)
//   - 정확히 "false"  → false (eas.json 'play'/'play-apk' 프로파일에서만 주입)

/** 원시 env 문자열 → Pro 업셀 표면 노출 여부(순수, 결정론). 기본 노출(true)이 안전 기본값. */
export function resolveShowProUpsell(raw: string | undefined): boolean {
  return raw !== 'false';
}

// 빌드타임 상수 — Expo/Metro 가 process.env.EXPO_PUBLIC_SHOW_PRO_UPSELL 를 번들에 정적 치환한다.
export const SHOW_PRO_UPSELL = resolveShowProUpsell(process.env.EXPO_PUBLIC_SHOW_PRO_UPSELL);
