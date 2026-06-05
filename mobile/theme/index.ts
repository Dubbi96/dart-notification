import { useColorScheme, PixelRatio } from 'react-native';
import { createContext, useContext } from 'react';
import { useSettingsStore } from '@stores/settingsStore';
import {
  MD3LightTheme,
  MD3DarkTheme,
  type MD3Theme,
} from 'react-native-paper';
import { lightColors, darkColors, type ThemeColors } from './colors';
import { spacing, radius } from './spacing';
import { typography, makeTypography, clampTextScale, type Typography } from './typography';

export type ColorScheme = 'light' | 'dark';

export interface Theme {
  colors: ThemeColors;
  spacing: typeof spacing;
  radius: typeof radius;
  typography: Typography;
  isDark: boolean;
}

/**
 * 테마 생성. scale 미지정 시 기본 배율(1.0) typography 재사용.
 * scale은 makeTypography 내부에서 1.0~1.5로 클램프된다(§9).
 */
export function getTheme(scheme: ColorScheme, scale = 1.0): Theme {
  return {
    colors: scheme === 'dark' ? darkColors : lightColors,
    spacing,
    radius,
    typography: scale === 1.0 ? typography : makeTypography(scale),
    isDark: scheme === 'dark',
  };
}

export const ThemeContext = createContext<Theme>(getTheme('light'));

export function useTheme(): Theme {
  return useContext(ThemeContext);
}

export function useAppColorScheme(): ColorScheme {
  const systemScheme = useColorScheme();
  const override = useSettingsStore((s) => s.colorSchemeOverride);
  if (override === 'system') {
    return systemScheme === 'dark' ? 'dark' : 'light';
  }
  return override;
}

/**
 * 적용할 글자 배율(§9). 사용자 재정의(설정 화면) 우선, 없으면 시스템 폰트 배율.
 * 항상 1.0~1.5로 클램프되어 레이아웃 붕괴를 막는다.
 */
export function useTextScale(): number {
  const override = useSettingsStore((s) => s.textScaleOverride);
  const systemScale = PixelRatio.getFontScale();
  return clampTextScale(override ?? systemScale);
}

export function getPaperTheme(scheme: ColorScheme): MD3Theme {
  const baseTheme = scheme === 'dark' ? MD3DarkTheme : MD3LightTheme;
  const c = scheme === 'dark' ? darkColors : lightColors;

  return {
    ...baseTheme,
    colors: {
      ...baseTheme.colors,
      primary: c.primary,
      onPrimary: c.primaryForeground,
      primaryContainer: c.primaryLight,
      onPrimaryContainer: c.primaryDark,
      secondary: c.primary,
      onSecondary: c.primaryForeground,
      background: c.background,
      onBackground: c.text,
      surface: c.surface,
      onSurface: c.text,
      surfaceVariant: c.surfaceSecondary,
      onSurfaceVariant: c.textSecondary,
      error: c.error,
      outline: c.border,
      outlineVariant: c.borderLight,
    },
  };
}

export { lightColors, darkColors, spacing, radius, typography };
export type { ThemeColors };
