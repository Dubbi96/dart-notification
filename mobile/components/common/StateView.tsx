import React from 'react';
import { View, Text, StyleSheet, ActivityIndicator } from 'react-native';
import { Button } from 'react-native-paper';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '@theme';
import { spacing } from '@theme/spacing';
import { API_BASE_URL, isConnectionError } from '@services/api';

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
  /**
   * true면 화면 중앙 전체 대신 상단 정렬(콤팩트) — 아래에 다른 섹션이 이어질 때 사용
   * (DAR-552 빈 에디션 폴백 브리핑: 정직 카피가 상위, 브리핑 섹션이 그 아래).
   */
  compact?: boolean;
}

export function EmptyState({
  icon = 'inbox',
  title,
  description,
  actionLabel,
  onAction,
  compact = false,
}: EmptyStateProps) {
  const { colors, typography: typo } = useTheme();
  // 기획 §2-2 빈 상태 구성 표준: 아이콘 48dp(textTertiary) · 메인(bodyMedium, text) ·
  // 보조(caption) · 액션(outlined, primary).
  // 보조 문구는 '읽어야 하는 텍스트' → textSecondary(다크 AA 6.1:1, DAR-31 P0-A §2).
  return (
    <View style={compact ? styles.compact : styles.centered}>
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
        <Button mode="outlined" onPress={onAction} style={styles.action}>
          {actionLabel}
        </Button>
      ) : null}
    </View>
  );
}

interface ErrorStateProps {
  icon?: keyof typeof Feather.glyphMap;
  title?: string;
  description?: string;
  onRetry?: () => void;
  retryLabel?: string;
  // 보조 액션(예: 게스트 둘러보기) — 재시도 버튼 아래에 outlined 보조 버튼으로 표시.
  secondaryLabel?: string;
  onSecondary?: () => void;
}

export function ErrorState({
  icon = 'alert-circle',
  title = '불러오지 못했습니다',
  description = '잠시 후 다시 시도해 주세요.',
  onRetry,
  retryLabel = '재시도',
  secondaryLabel,
  onSecondary,
}: ErrorStateProps) {
  const { colors, typography: typo } = useTheme();
  return (
    <View style={styles.centered}>
      <Feather name={icon} size={48} color={colors.error} />
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
          {retryLabel}
        </Button>
      ) : null}
      {secondaryLabel && onSecondary ? (
        <Button mode="text" onPress={onSecondary} style={styles.secondary}>
          {secondaryLabel}
        </Button>
      ) : null}
    </View>
  );
}

// API 에러를 연결 실패 / 일반 실패로 분기해 일관된 안내를 띄우는 래퍼.
// 공시 리스트·관심기업·시그널 등 서버 의존 화면이 빈 화면 대신 이 컴포넌트로 사유를 노출한다.
interface ApiErrorStateProps {
  error?: unknown;
  onRetry?: () => void;
  // 연결 실패가 아닌 일반 에러일 때 표시할 문구(화면별 맥락).
  title?: string;
  description?: string;
  // 게스트 둘러보기 등 보조 동선.
  secondaryLabel?: string;
  onSecondary?: () => void;
}

export function ApiErrorState({
  error,
  onRetry,
  title,
  description,
  secondaryLabel,
  onSecondary,
}: ApiErrorStateProps) {
  if (isConnectionError(error)) {
    // 연결 차단·타임아웃: 인프라 원인 안내 + dev에서 현재 API 주소 표기(진단성).
    const base = '같은 Wi-Fi에 연결돼 있는지, 서버가 켜져 있는지 확인해 주세요.';
    return (
      <ErrorState
        icon="wifi-off"
        title="백엔드 연결 실패"
        description={__DEV__ ? `${base}\n\nAPI: ${API_BASE_URL}` : base}
        onRetry={onRetry}
        secondaryLabel={secondaryLabel}
        onSecondary={onSecondary}
      />
    );
  }
  return (
    <ErrorState
      title={title}
      description={description}
      onRetry={onRetry}
      secondaryLabel={secondaryLabel}
      onSecondary={onSecondary}
    />
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
  compact: {
    alignItems: 'center',
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.xl,
  },
  action: {
    marginTop: spacing.lg,
  },
  secondary: {
    marginTop: spacing.sm,
  },
});
