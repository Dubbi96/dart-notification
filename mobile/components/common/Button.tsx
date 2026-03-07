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
  const { colors } = useTheme();

  const containerStyles: ViewStyle[] = [
    styles.base,
    {
      paddingVertical: size === 'sm' ? spacing.sm : size === 'lg' ? spacing.base : spacing.md,
      paddingHorizontal: size === 'sm' ? spacing.base : size === 'lg' ? spacing.xl : spacing.lg,
      borderRadius: radius.lg,
    },
  ];

  const labelStyles: TextStyle[] = [
    styles.label,
    { fontSize: size === 'sm' ? 14 : size === 'lg' ? 18 : 16 },
  ];

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
