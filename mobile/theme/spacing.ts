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
