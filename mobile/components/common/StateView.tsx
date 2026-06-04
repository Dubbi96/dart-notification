import React from 'react';
import { View, Text, StyleSheet, ActivityIndicator } from 'react-native';
import { Button } from 'react-native-paper';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '@theme';
import { spacing } from '@theme/spacing';

// 로딩/빈/에러 상태를 일관되게 표시하는 공통 상태 뷰.
// 화면별 셸이 로딩·빈·에러 상태를 동일한 패턴으로 렌더링하도록 한다.

interface LoadingStateProps {
  message?: string;
}

export function LoadingState({ message }: LoadingStateProps) {
  const { colors, typography: typo } = useTheme();
  return (
    <View style={styles.centered}>
      <ActivityIndicator size="large" color={colors.primary} />
      {message ? (
        <Text style={[typo.caption, { color: colors.textSecondary, marginTop: spacing.md }]}>
          {message}
        </Text>
      ) : null}
    </View>
  );
}

interface EmptyStateProps {
  icon?: keyof typeof Feather.glyphMap;
  title: string;
  description?: string;
  actionLabel?: string;
  onAction?: () => void;
}

export function EmptyState({ icon = 'inbox', title, description, actionLabel, onAction }: EmptyStateProps) {
  const { colors, typography: typo } = useTheme();
  return (
    <View style={styles.centered}>
      <Feather name={icon} size={48} color={colors.textTertiary} />
      <Text style={[typo.bodyMedium, { color: colors.text, marginTop: spacing.md, textAlign: 'center' }]}>
        {title}
      </Text>
      {description ? (
        <Text
          style={[typo.caption, { color: colors.textSecondary, marginTop: spacing.xs, textAlign: 'center' }]}
        >
          {description}
        </Text>
      ) : null}
      {actionLabel && onAction ? (
        <Button mode="contained" onPress={onAction} style={styles.action}>
          {actionLabel}
        </Button>
      ) : null}
    </View>
  );
}

interface ErrorStateProps {
  title?: string;
  description?: string;
  onRetry?: () => void;
}

export function ErrorState({
  title = '불러오지 못했습니다',
  description = '잠시 후 다시 시도해 주세요.',
  onRetry,
}: ErrorStateProps) {
  const { colors, typography: typo } = useTheme();
  return (
    <View style={styles.centered}>
      <Feather name="alert-circle" size={48} color={colors.error} />
      <Text style={[typo.bodyMedium, { color: colors.text, marginTop: spacing.md, textAlign: 'center' }]}>
        {title}
      </Text>
      <Text
        style={[typo.caption, { color: colors.textSecondary, marginTop: spacing.xs, textAlign: 'center' }]}
      >
        {description}
      </Text>
      {onRetry ? (
        <Button mode="outlined" onPress={onRetry} style={styles.action} icon="refresh">
          재시도
        </Button>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: spacing.xl,
    paddingTop: 80,
  },
  action: {
    marginTop: spacing.lg,
  },
});
