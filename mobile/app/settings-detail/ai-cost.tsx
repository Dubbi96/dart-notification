import React from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useTheme } from '@theme';
import { spacing, radius } from '@theme/spacing';
import { LoadingState, ErrorState, EmptyState } from '@components/common/StateView';
import { emptyStateCopy } from '@components/common/emptyStateCopy';
import { useAiCostMetrics } from '@hooks/useAiCost';

const USD_TO_KRW = 1300;

function formatUsd(value: number): string {
  return `$${value.toFixed(4)}`;
}

function formatKrw(usd: number): string {
  const krw = Math.round(usd * USD_TO_KRW);
  return `₩${krw.toLocaleString('ko-KR')}`;
}

function formatTokens(tokens: number): string {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`;
  if (tokens >= 1_000) return `${(tokens / 1_000).toFixed(1)}K`;
  return String(tokens);
}

export default function AiCostScreen() {
  const { colors, typography: typo } = useTheme();
  const { data, isLoading, isError, refetch } = useAiCostMetrics();

  const taskEntries = data
    ? Object.entries(data.byTask).sort((a, b) => b[1].costUsd - a[1].costUsd)
    : [];

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
      {/* Header */}
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={8} style={styles.backButton}>
          <Feather name="chevron-left" size={26} color={colors.text} />
        </TouchableOpacity>
        <Text style={[typo.h3, { color: colors.text }]}>AI 비용</Text>
        <View style={styles.backButton} />
      </View>

      {isLoading ? (
        <LoadingState message="비용 데이터를 불러오는 중..." />
      ) : isError ? (
        <ErrorState
          title="데이터를 불러오지 못했습니다"
          description="AI 비용 데이터를 가져오는 중 오류가 발생했습니다."
          onRetry={refetch}
        />
      ) : !data ? (
        <EmptyState {...emptyStateCopy.aiCostEmpty} />
      ) : (
        <ScrollView
          contentContainerStyle={styles.content}
          showsVerticalScrollIndicator={false}
        >
          {/* Period */}
          <Text style={[typo.caption, { color: colors.textSecondary, marginBottom: spacing.md }]}>
            기간: {data.period.from} ~ {data.period.to}
          </Text>

          {/* Total cost card */}
          <View
            style={[
              styles.totalCard,
              { backgroundColor: colors.surface, borderColor: colors.border },
            ]}
          >
            <Text style={[typo.caption, { color: colors.textSecondary, marginBottom: spacing.xs }]}>
              총 비용 (월간)
            </Text>
            <Text style={[typo.h3, { color: colors.primary }]}>
              {formatUsd(data.totalCostUsd)}
            </Text>
            <Text style={[typo.bodyMedium, { color: colors.textSecondary, marginTop: spacing.xs }]}>
              ≈ {formatKrw(data.totalCostUsd)} 추정
            </Text>
            <View style={[styles.divider, { backgroundColor: colors.borderLight }]} />
            <View style={styles.tokenRow}>
              <Feather name="cpu" size={14} color={colors.textTertiary} />
              <Text style={[typo.caption, { color: colors.textSecondary, marginLeft: spacing.xs }]}>
                총 토큰: {formatTokens(data.totalTokens)}
              </Text>
            </View>
          </View>

          {/* By-task breakdown */}
          <Text style={[typo.h3, { color: colors.text, marginTop: spacing.xl, marginBottom: spacing.md }]}>
            태스크별 비용
          </Text>

          {taskEntries.length === 0 ? (
            <Text style={[typo.caption, { color: colors.textTertiary }]}>태스크 데이터 없음</Text>
          ) : (
            taskEntries.map(([task, stat]) => (
              <View
                key={task}
                style={[
                  styles.taskRow,
                  { backgroundColor: colors.surface, borderColor: colors.border },
                ]}
              >
                <View style={styles.taskInfo}>
                  <Text
                    style={[typo.bodyMedium, { color: colors.text }]}
                    numberOfLines={1}
                  >
                    {task}
                  </Text>
                  <Text style={[typo.caption, { color: colors.textSecondary, marginTop: spacing.xs }]}>
                    {formatTokens(stat.tokens)} 토큰 · {stat.count}건
                  </Text>
                </View>
                <View style={styles.taskCost}>
                  <Text style={[typo.bodyMedium, { color: colors.primary }]}>
                    {formatUsd(stat.costUsd)}
                  </Text>
                  <Text style={[typo.small, { color: colors.textSecondary, marginTop: spacing.xs }]}>
                    {formatKrw(stat.costUsd)}
                  </Text>
                </View>
              </View>
            ))
          )}

          {/* Disclaimer */}
          <Text
            style={[
              typo.small,
              {
                color: colors.textTertiary,
                marginTop: spacing.xl,
                textAlign: 'center',
              },
            ]}
          >
            * KRW 환산은 1 USD = {USD_TO_KRW} KRW 기준 추정값입니다.
          </Text>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.base,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
  },
  backButton: {
    width: 40,
    alignItems: 'flex-start',
  },
  content: {
    padding: spacing.lg,
    paddingBottom: spacing['4xl'],
  },
  totalCard: {
    borderRadius: radius.lg,
    borderWidth: 1,
    padding: spacing.lg,
  },
  divider: {
    height: 1,
    marginVertical: spacing.md,
  },
  tokenRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  taskRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderRadius: radius.md,
    borderWidth: 1,
    padding: spacing.base,
    marginBottom: spacing.sm,
  },
  taskInfo: {
    flex: 1,
    marginRight: spacing.md,
  },
  taskCost: {
    alignItems: 'flex-end',
  },
});
