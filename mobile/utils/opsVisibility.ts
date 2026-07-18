// DAR-558: 첫 Play 빌드에서 내부 운영(ops) 표면 전면 제외 — 공개 빌드 게이팅.
//
// PM 결정 D3(cc-apk-feedback-triage-2026-07-18.md): AI 비용/거버넌스·수집 현황은 내부 운영
// 화면인데 DAR-549 매니페스트에 누락돼 소비자 빌드에 그대로 노출됐다. 트레이딩 재공개 시에도
// ops는 계속 숨겨야 하므로 SHOW_TRADING을 재사용하지 않고 별도 플래그로 의미를 분리한다.
// utils/tradingVisibility.ts(DAR-549)와 동일한 빌드타임 플래그 패턴.
//
// 플래그: EXPO_PUBLIC_SHOW_OPS (Expo/Metro 가 빌드 시 번들에 정적 인라인).
//   - 미설정/그 외 값 → true  (기존 oci·preview·production 채널 무변경, 회귀 0)
//   - 정확히 "false"  → false (eas.json 'play'/'play-apk' 프로파일에서만 주입)

/** 원시 env 문자열 → ops 표면 노출 여부(순수, 결정론). 기본 노출(true)이 안전 기본값. */
export function resolveShowOps(raw: string | undefined): boolean {
  return raw !== 'false';
}

// 빌드타임 상수 — Expo/Metro 가 process.env.EXPO_PUBLIC_SHOW_OPS 를 번들에 정적 치환한다.
export const SHOW_OPS = resolveShowOps(process.env.EXPO_PUBLIC_SHOW_OPS);
