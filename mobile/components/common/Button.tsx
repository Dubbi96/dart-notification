import React, { useState } from 'react';
import {
  Pressable,
  Text,
  StyleSheet,
  ActivityIndicator,
  type ViewStyle,
  type TextStyle,
} from 'react-native';
import { useTheme } from '@theme';
import { palette } from '@theme/colors';
import { radius, spacing } from '@theme/spacing';

interface ButtonProps {
  title: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'outline' | 'ghost';
  size?: 'sm' | 'md' | 'lg';
  loading?: boolean;
  disabled?: boolean;
  style?: ViewStyle;
  textStyle?: TextStyle;
  fullWidth?: boolean;
}

export function Button({
  title,
  onPress,
  variant = 'primary',
  size = 'md',
  loading = false,
  disabled = false,
  style,
  textStyle,
  fullWidth = false,
}: ButtonProps) {
  const { colors, typography, isDark } = useTheme();
  const [focused, setFocused] = useState(false);
  const accent = isDark ? colors.primary : colors.primaryDark;
  const inactive = disabled || loading;

  const containerStyles: ViewStyle[] = [
    styles.base,
    {
      paddingVertical: size === 'sm' ? spacing.sm : size === 'lg' ? spacing.base : spacing.md,
      paddingHorizontal: size === 'sm' ? spacing.base : size === 'lg' ? spacing.xl : spacing.lg,
      borderRadius: radius.lg,
    },
  ];

  // 폰트 크기는 typography 토큰(sm=captionMedium 14 / md=bodyMedium 16 / lg=h3 18)에서 취해
  // makeTypography 스케일 경로에 태운다(전역 allowFontScaling=false 체계의 유일한 확대 경로).
  // fontWeight는 기존 시각(600) 유지를 위해 styles.label로 고정 — scale 1.0에서 시각 변화 없음.
  const labelTypo =
    size === 'sm'
      ? typography.captionMedium
      : size === 'lg'
        ? typography.h3
        : typography.bodyMedium;

  const labelStyles: TextStyle[] = [labelTypo, styles.label];

  switch (variant) {
    case 'primary':
      containerStyles.push({
        backgroundColor: disabled ? colors.surfaceSecondary : accent,
      });
      labelStyles.push({ color: disabled ? colors.textSecondary : colors.primaryForeground });
      break;
    case 'secondary':
      containerStyles.push({ backgroundColor: colors.primaryLight });
      labelStyles.push({ color: disabled ? colors.textSecondary : colors.primaryDark });
      break;
    case 'outline':
      containerStyles.push({
        backgroundColor: 'transparent',
        borderWidth: 1.5,
        borderColor: disabled ? colors.textTertiary : accent,
      });
      labelStyles.push({ color: disabled ? colors.textSecondary : colors.primaryDark });
      break;
    case 'ghost':
      containerStyles.push({ backgroundColor: 'transparent' });
      labelStyles.push({ color: disabled ? colors.textSecondary : colors.primaryDark });
      break;
  }

  if (fullWidth) containerStyles.push({ width: '100%' });

  return (
    <Pressable
      style={({ pressed }) => [
        containerStyles,
        style,
        pressed &&
          !inactive && {
            backgroundColor:
              variant === 'primary'
                ? isDark
                  ? colors.primaryDark
                  : palette.teal800
                : colors.primaryLight,
          },
        focused && [styles.focused, { borderColor: colors.text }],
      ]}
      onPress={onPress}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      disabled={inactive}
      accessibilityRole="button"
      // loading 중엔 자식이 ActivityIndicator뿐이라 title 기반 라벨로 스크린리더 무음을 방지한다.
      accessibilityLabel={title}
      accessibilityState={{ disabled: inactive, busy: loading }}
    >
      {loading ? (
        <ActivityIndicator
          color={variant === 'primary' && !disabled ? colors.primaryForeground : colors.primaryDark}
          size="small"
        />
      ) : (
        <Text style={[labelStyles, textStyle]}>{title}</Text>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    minHeight: 48,
    minWidth: 48,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
  },
  label: {
    fontWeight: '600',
    textAlign: 'center',
    flexShrink: 1,
  },
  focused: { borderWidth: 2 },
});
