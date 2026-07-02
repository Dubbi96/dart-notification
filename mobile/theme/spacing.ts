export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  base: 16,
  lg: 20,
  xl: 24,
  '2xl': 32,
  '3xl': 40,
  '4xl': 48,
} as const;

// 접근성: 플랫폼 권장 최소 터치 영역(pt). 시각 크기와 무관하게 유효 터치 영역을 보장하는 기준값.
export const sizing = {
  minTouchTarget: 44,
  // DAR-472: 아이콘 픽셀 크기 패밀리(SSOT). per-file 매직넘버/상수(BACK_ICON_SIZE 26·
  // CHART_CHEVRON_SIZE 18·반복 size={16} 셰브런 등, DAR-452/453/459/461)를 토큰으로 통일한다.
  // 값은 기존 사용처를 보존(시각 회귀 0): sm=16(본문 인라인 셰브런·액션, 최빈), md=18(카드 헤더
  // 셰브런·강조), lg=26(화면 헤더 back). 스케일 밖 작은 보조 아이콘(12·14)은 의도적 one-off로 둔다.
  icon: { sm: 16, md: 18, lg: 26 },
} as const;

export const radius = {
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  full: 9999,
} as const;

// 점수 게이지(ScoreGauge) 픽셀 지오메트리(DAR-174). 막대·틱·노브는 글꼴 배율과 독립적인
// 절대 위치/퍼센트 기반이라 OS 글꼴 확대에도 정렬이 유지된다. 매직넘버 금지 → 토큰화.
export const gauge = {
  barHeight: 8,
  barRadius: 4,
  tickWidth: 1,
  knobSize: 10,
} as const;

// 얇은 기여도/진행 막대(ScoreBreakdownSection 기여도 바 등) 픽셀 지오메트리(DAR-470).
// gauge 와 동일 사상 — 글꼴 배율과 독립된 절대 두께/반경(반경=두께/2 알약형)이라 OS 글꼴
// 확대에도 막대 형태가 유지된다. 매직넘버 금지 → 토큰화.
export const progressBar = {
  height: 6,
  radius: 3,
} as const;
