// Teal-based color palette inspired by Paychain Finance UI Kit
// Designed with dark mode support in mind

export const palette = {
  // Primary - Teal
  teal50: '#F0FDFA',
  teal100: '#CCFBF1',
  teal200: '#99F6E4',
  teal300: '#5EEAD4',
  teal400: '#2DD4BF',
  teal500: '#14B8A6',
  teal600: '#0D9488',
  teal700: '#0F766E',
  teal800: '#115E59',
  teal900: '#134E4A',
  teal950: '#042F2E',

  // Neutral (Gray)
  gray50: '#F9FAFB',
  gray100: '#F3F4F6',
  gray200: '#E5E7EB',
  gray300: '#D1D5DB',
  gray400: '#9CA3AF',
  gray500: '#6B7280',
  gray600: '#4B5563',
  gray700: '#374151',
  gray800: '#1F2937',
  gray900: '#111827',
  gray950: '#030712',

  // Navy (Dark mode backgrounds)
  navy950: '#060A18',
  navy900: '#0C1026',
  navy800: '#141836',
  navy700: '#1C2146',
  navy600: '#282E58',
  navy500: '#3B4178',

  // Semantic
  white: '#FFFFFF',
  black: '#000000',

  // White alpha — 컬러 그라데이션 히어로/스낵바 등 '컬러 표면 위' 전경 전용 (DAR-269)
  whiteAlpha90: 'rgba(255, 255, 255, 0.9)',
  whiteAlpha80: 'rgba(255, 255, 255, 0.8)',
  whiteAlpha70: 'rgba(255, 255, 255, 0.7)',
  whiteAlpha50: 'rgba(255, 255, 255, 0.5)',
  whiteAlpha25: 'rgba(255, 255, 255, 0.25)',
  whiteAlpha20: 'rgba(255, 255, 255, 0.2)',
  red400: '#F87171',
  red500: '#EF4444',
  red600: '#DC2626',
  green400: '#4ADE80',
  green500: '#22C55E',
  green600: '#16A34A',
  yellow400: '#FACC15',
  yellow500: '#EAB308',
  blue400: '#60A5FA',
  blue500: '#3B82F6',
  blue600: '#2563EB',
} as const;

export const lightColors = {
  // Backgrounds
  background: palette.gray50,
  surface: palette.white,
  surfaceSecondary: palette.gray100,
  surfaceElevated: palette.white,

  // Primary
  primary: palette.teal500,
  primaryLight: palette.teal50,
  primaryDark: palette.teal700,
  primaryForeground: palette.white,

  // Text
  text: palette.gray900,
  textSecondary: palette.gray500,
  // DAR-144: gray400(#9CA3AF)는 흰 배경 대비 ~2.5:1로 AA(4.5:1)·UI 3:1 모두 미달.
  // gray500로 상향해 가독 텍스트는 AA를 충족하고 장식 아이콘도 3:1 이상 확보한다.
  textTertiary: palette.gray500,
  textInverse: palette.white,

  // Borders
  border: palette.gray200,
  borderLight: palette.gray100,

  // Card (Paychain style gradient card area)
  cardGradientStart: palette.teal500,
  cardGradientEnd: palette.teal800,

  // On-color — 컬러 그라데이션 히어로/카드 위 흰색 전경 (DAR-269)
  // 배경 그라데이션이 라이트/다크 모두 진한 컬러이므로 두 모드 동일 값.
  onColor: palette.white,
  onColorStrong: palette.whiteAlpha90,
  onColorMuted: palette.whiteAlpha80,
  onColorSubtle: palette.whiteAlpha70,
  onColorFaint: palette.whiteAlpha50,
  hairlineOnColor: palette.whiteAlpha25,
  avatarOnColor: palette.whiteAlpha20,

  // Snackbar (컬러 표면 토스트 — DAR-269)
  snackbarBackground: palette.gray800,
  snackbarText: palette.white,

  // Status
  success: palette.green600,
  successSurface: '#D1FAE5',
  error: palette.red500,
  errorSurface: '#FEE2E2',
  warning: palette.yellow500,
  // DAR-173: 오프라인 배너 배경(tinted surface). success/errorSurface 와 동일 규약
  // — 옅은 동색 surface + 진한 warning 전경 텍스트로 AA 확보.
  warningSurface: '#FEF3C7',
  info: palette.blue500,

  // Tab bar
  tabBar: palette.white,
  tabBarBorder: palette.gray200,
  tabActive: palette.teal500,
  tabInactive: palette.gray400,

  // Input
  inputBackground: palette.white,
  inputBorder: palette.gray300,
  inputText: palette.gray900,
  inputPlaceholder: palette.gray400,

  // Overlay
  overlay: 'rgba(0, 0, 0, 0.5)',

  // Shadows
  shadow: 'rgba(0, 0, 0, 0.08)',
  shadowMedium: 'rgba(0, 0, 0, 0.12)',
} as const;

export const darkColors = {
  // Backgrounds - Deep navy tone
  background: palette.navy950,
  surface: palette.navy900,
  surfaceSecondary: palette.navy800,
  surfaceElevated: palette.navy800,

  // Primary - Soft lavender for navy dark mode
  primary: '#818CF8',
  primaryLight: '#1A1D3A',
  primaryDark: '#A5B4FC',
  primaryForeground: palette.navy950,

  // Text
  text: '#E8EAF0',
  textSecondary: '#8B90A8',
  // DAR-144: #5C6180는 navy950 대비 ~3.3:1로 AA 미달. #7B82A0로 상향(navy950 5.2:1)해
  // 가독 텍스트는 AA를 충족하고 secondary(#8B90A8)와 단계 구분은 유지한다.
  textTertiary: '#7B82A0',
  textInverse: palette.navy900,

  // Borders
  border: palette.navy600,
  borderLight: palette.navy700,

  // Card
  cardGradientStart: '#1A3A5C',
  cardGradientEnd: palette.navy900,

  // On-color — 컬러 그라데이션 히어로/카드 위 흰색 전경 (DAR-269)
  // 라이트와 동일 값(배경이 양모드 모두 진한 컬러 그라데이션이라 흰색 전경 유지).
  onColor: palette.white,
  onColorStrong: palette.whiteAlpha90,
  onColorMuted: palette.whiteAlpha80,
  onColorSubtle: palette.whiteAlpha70,
  onColorFaint: palette.whiteAlpha50,
  hairlineOnColor: palette.whiteAlpha25,
  avatarOnColor: palette.whiteAlpha20,

  // Snackbar (컬러 표면 토스트 — DAR-269): 기존 다크 배경(#282E58=navy600) 유지
  snackbarBackground: palette.navy600,
  snackbarText: palette.white,

  // Status
  success: palette.green400,
  successSurface: '#052E16',
  error: palette.red400,
  errorSurface: '#450A0A',
  warning: palette.yellow400,
  // DAR-173: 다크 오프라인 배너 배경(deep amber). errorSurface 다크값과 동일 톤 규약.
  warningSurface: '#422006',
  info: palette.blue400,

  // Tab bar
  tabBar: palette.navy900,
  tabBarBorder: palette.navy800,
  tabActive: '#818CF8',
  tabInactive: '#5C6180',

  // Input
  inputBackground: palette.navy800,
  inputBorder: palette.navy600,
  inputText: '#E8EAF0',
  inputPlaceholder: '#5C6180',

  // Overlay
  overlay: 'rgba(4, 6, 16, 0.75)',

  // Shadows
  shadow: 'rgba(0, 0, 0, 0.4)',
  shadowMedium: 'rgba(0, 0, 0, 0.6)',
} as const;

// Use widened string type so light and dark are assignable to the same type
export type ThemeColors = { [K in keyof typeof lightColors]: string };
