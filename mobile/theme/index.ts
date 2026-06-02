import { useColorScheme } from 'react-native';
import { createContext, useContext } from 'react';
import { useSettingsStore } from '@stores/settingsStore';
import {
  MD3LightTheme,
  MD3DarkTheme,
  type MD3Theme,
} from 'react-native-paper';
import { lightColors, darkColors, type ThemeColors } from './colors';
import { spacing, radius } from './spacing';
import { typography } from './typography';

export type ColorScheme = 'light' | 'dark';

export interface Theme {
  colors: ThemeColors;
  spacing: typeof spacing;
  radius: typeof radius;
  typography: typeof typography;
  isDark: boolean;
}

export function getTheme(scheme: ColorScheme): Theme {
  return {
    colors: scheme === 'dark' ? darkColors : lightColors,
    spacing,
    radius,
    typography,
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
