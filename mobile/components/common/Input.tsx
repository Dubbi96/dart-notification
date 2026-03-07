import React, { useState } from 'react';
import {
  View,
  TextInput,
  Text,
  StyleSheet,
  TouchableOpacity,
  type TextInputProps,
  type ViewStyle,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '@theme';
import { radius, spacing } from '@theme/spacing';

interface InputProps extends TextInputProps {
  label?: string;
  error?: string;
  containerStyle?: ViewStyle;
}

export function Input({ label, error, containerStyle, style, secureTextEntry, ...props }: InputProps) {
  const { colors, typography } = useTheme();
  const [focused, setFocused] = useState(false);
  const [hidden, setHidden] = useState(true);

  const isPassword = secureTextEntry;

  return (
    <View style={[styles.container, containerStyle]}>
      {label && (
        <Text style={[typography.captionMedium, { color: colors.textSecondary, marginBottom: spacing.sm }]}>
          {label}
        </Text>
      )}
      <View style={[
        styles.inputRow,
        {
          backgroundColor: colors.inputBackground,
          borderColor: error ? colors.error : focused ? colors.primary : colors.inputBorder,
        },
      ]}>
        <TextInput
          style={[
            styles.input,
            {
              color: colors.inputText,
              ...typography.body,
            },
            style,
          ]}
          placeholderTextColor={colors.inputPlaceholder}
          secureTextEntry={isPassword && hidden}
          onFocus={(e) => {
            setFocused(true);
            props.onFocus?.(e);
          }}
          onBlur={(e) => {
            setFocused(false);
            props.onBlur?.(e);
          }}
          {...props}
        />
        {isPassword && (
          <TouchableOpacity
            onPress={() => setHidden((v) => !v)}
            style={styles.eyeButton}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Feather
              name={hidden ? 'eye-off' : 'eye'}
              size={18}
              color={colors.textTertiary}
            />
          </TouchableOpacity>
        )}
      </View>
      {error && (
        <Text style={[typography.small, { color: colors.error, marginTop: spacing.xs }]}>
          {error}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginBottom: spacing.base,
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: radius.md,
  },
  input: {
    flex: 1,
    paddingHorizontal: spacing.base,
    paddingVertical: spacing.md,
  },
  eyeButton: {
    paddingHorizontal: spacing.md,
  },
});
