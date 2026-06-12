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
