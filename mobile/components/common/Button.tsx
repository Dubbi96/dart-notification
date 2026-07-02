import React from 'react';
import {
  TouchableOpacity,
  Text,
  StyleSheet,
  ActivityIndicator,
  type ViewStyle,
  type TextStyle,
} from 'react-native';
import { useTheme } from '@theme';
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
  const { colors, typography } = useTheme();

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
    size === 'sm' ? typography.captionMedium : size === 'lg' ? typography.h3 : typography.bodyMedium;

  const labelStyles: TextStyle[] = [styles.label, { fontSize: labelTypo.fontSize }];

  switch (variant) {
    case 'primary':
      containerStyles.push({
        backgroundColor: disabled ? colors.textTertiary : colors.primary,
      });
      labelStyles.push({ color: colors.primaryForeground });
      break;
    case 'secondary':
      containerStyles.push({ backgroundColor: colors.primaryLight });
      labelStyles.push({ color: colors.primary });
      break;
    case 'outline':
      containerStyles.push({
        backgroundColor: 'transparent',
        borderWidth: 1.5,
        borderColor: disabled ? colors.textTertiary : colors.primary,
      });
      labelStyles.push({ color: disabled ? colors.textTertiary : colors.primary });
      break;
    case 'ghost':
      containerStyles.push({ backgroundColor: 'transparent' });
      labelStyles.push({ color: colors.primary });
      break;
  }

  if (fullWidth) containerStyles.push({ width: '100%' });

  return (
    <TouchableOpacity
      style={[containerStyles, style]}
      onPress={onPress}
      disabled={disabled || loading}
      activeOpacity={0.7}
      accessibilityRole="button"
      // loading 중엔 자식이 ActivityIndicator뿐이라 title 기반 라벨로 스크린리더 무음을 방지한다.
      accessibilityLabel={title}
      accessibilityState={{ disabled: disabled || loading, busy: loading }}
    >
      {loading ? (
        <ActivityIndicator
          color={variant === 'primary' ? colors.primaryForeground : colors.primary}
          size="small"
        />
      ) : (
        <Text style={[labelStyles, textStyle]}>{title}</Text>
      )}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  base: {
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
  },
  label: {
    fontWeight: '600',
  },
});
