// DAR-549: 첫 게시(Play) 빌드에서 모의투자·자동매매 표면 전면 제외 — 공개 빌드 게이팅.
//
// 오너 결정(2026-07-17): 처음 게시하는 앱 버전에서 모의투자·자동매매를 제외한다
// (정확도·기준·성과 신뢰 부족). 빌드타임 플래그로 UI만 게이팅한다 — 서버·M10 측정은 무접촉.
//
// 플래그: EXPO_PUBLIC_SHOW_TRADING (Expo/Metro 가 빌드 시 번들에 정적 인라인).
//   - 미설정/그 외 값 → true  (기존 oci·preview·production 채널 무변경, 회귀 0)
//   - 정확히 "false"  → false (eas.json 'play' 프로파일에서만 주입)
//
// 이 모듈은 RN 비의존 순수 로직이라 화면·검증 스크립트·jest 가 동일 원천을 공유한다.

/**
 * 원시 env 문자열 → 트레이딩 표면 노출 여부(순수, 결정론).
 *
 * 기본 노출(true)이 안전 기본값 — 오직 명시적 "false" 만 숨긴다. 오타(예: "False"·"0")로
 * 인한 우발적 숨김을 막아, 게이팅은 play 프로파일이 의도적으로 주입할 때만 발동한다.
 */
export function resolveShowTrading(raw: string | undefined): boolean {
  return raw !== 'false';
}

// 빌드타임 상수 — Expo/Metro 가 process.env.EXPO_PUBLIC_SHOW_TRADING 를 번들에 정적 치환한다.
// 런타임 토글이 아니라 빌드 채널별 고정값(oci=true, play=false).
export const SHOW_TRADING = resolveShowTrading(process.env.EXPO_PUBLIC_SHOW_TRADING);

/**
 * 플래그 false 시 숨겨지는 트레이딩 표면 목록(스냅샷 감사용 매니페스트, 순수).
 *
 * 각 화면의 인라인 게이팅(`SHOW_TRADING && …`)이 실제로 무엇을 숨기는지를 한곳에 명문화한다.
 * 스냅샷 테스트가 플래그 양값(true/false) 결과를 고정해 게이팅 표면 목록의 회귀를 잡는다.
 */
export interface TradingSurfaceVisibility {
  /** 하단 탭 IA — 포트폴리오 탭(5탭↔4탭 전환) */
  portfolioTab: boolean;
  /** 홈 '운용 성과' footer(GraduationTracker 등 모의운용 성과 섹션) */
  homePerformanceFooter: boolean;
  /** 트레이딩 화면 라우트(자동매매·체결내역·백테스트·전략 비교) 진입 허용 */
  tradingRoutes: boolean;
  /** 신호 카드의 '모의매매' 연결 진입점(신호 카드 자체는 유지) */
  signalPaperTradeEntry: boolean;
}

export function tradingSurfaceVisibility(show: boolean): TradingSurfaceVisibility {
  return {
    portfolioTab: show,
    homePerformanceFooter: show,
    tradingRoutes: show,
    signalPaperTradeEntry: show,
  };
}
