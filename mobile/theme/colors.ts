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

  // Semantic
  white: '#FFFFFF',
  black: '#000000',
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
  primaryLight: palette.teal100,
  primaryDark: palette.teal700,
  primaryForeground: palette.white,

  // Text
  text: palette.gray900,
  textSecondary: palette.gray500,
  textTertiary: palette.gray400,
  textInverse: palette.white,

  // Borders
  border: palette.gray200,
  borderLight: palette.gray100,

  // Card (Paychain style gradient card area)
  cardGradientStart: palette.teal500,
  cardGradientEnd: palette.teal800,

  // Status
  success: palette.green500,
  error: palette.red500,
  warning: palette.yellow500,
  info: palette.blue500,

  // Tab bar
  tabBar: palette.white,
  tabBarBorder: palette.gray200,
  tabActive: palette.teal500,
  tabInactive: palette.gray400,

  // Input
  inputBackground: palette.gray100,
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
  // Backgrounds
  background: palette.gray950,
  surface: palette.gray900,
  surfaceSecondary: palette.gray800,
  surfaceElevated: palette.gray800,

  // Primary
  primary: palette.teal400,
  primaryLight: palette.teal900,
  primaryDark: palette.teal300,
  primaryForeground: palette.gray950,

  // Text
  text: palette.gray50,
  textSecondary: palette.gray400,
  textTertiary: palette.gray500,
  textInverse: palette.gray900,

  // Borders
  border: palette.gray700,
  borderLight: palette.gray800,

  // Card
  cardGradientStart: palette.teal600,
  cardGradientEnd: palette.teal950,

  // Status
  success: palette.green400,
  error: palette.red400,
  warning: palette.yellow400,
  info: palette.blue400,

  // Tab bar
  tabBar: palette.gray900,
  tabBarBorder: palette.gray800,
  tabActive: palette.teal400,
  tabInactive: palette.gray500,

  // Input
  inputBackground: palette.gray800,
  inputBorder: palette.gray700,
  inputText: palette.gray50,
  inputPlaceholder: palette.gray500,

  // Overlay
  overlay: 'rgba(0, 0, 0, 0.7)',

  // Shadows
  shadow: 'rgba(0, 0, 0, 0.3)',
  shadowMedium: 'rgba(0, 0, 0, 0.5)',
} as const;

// Use widened string type so light and dark are assignable to the same type
export type ThemeColors = { [K in keyof typeof lightColors]: string };
