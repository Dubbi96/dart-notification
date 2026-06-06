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
import { useAiCostMetrics, useAiCostHealth } from '@hooks/useAiCost';

import type { AiCostHealth } from '@app-types/api.types';

const USD_TO_KRW = 1300;

function formatUsd(value: number): string {
  return `$${value.toFixed(4)}`;
}

function formatPct(ratio: number): string {
  return `${Math.round(ratio * 100)}%`;
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

/** 수용기준 충족/위반 배지 — 테마 토큰만 사용 (하드코딩 색상 0). */
function AcceptanceBadge({ ok, label }: { ok: boolean; label: string }) {
  const { colors, typography: typo } = useTheme();
  const fg = ok ? colors.success : colors.error;
  const bg = ok ? colors.successSurface : colors.errorSurface;
  return (
    <View
      style={[styles.badge, { backgroundColor: bg }]}
      accessibilityRole="text"
      accessibilityLabel={`${label} ${ok ? '충족' : '위반'}`}
    >
      <Feather name={ok ? 'check-circle' : 'alert-triangle'} size={13} color={fg} />
      <Text style={[typo.caption, { color: fg, marginLeft: spacing.xs }]}>
        {label} {ok ? 'OK' : '위반'}
      </Text>
    </View>
  );
}

/** 한도 사용률 게이지 — 100% 초과 시 error 색. */
function LimitUsageBar({
  label,
  usedUsd,
  limitUsd,
  ratio,
}: {
  label: string;
  usedUsd: number;
  limitUsd: number;
  ratio: number;
}) {
  const { colors, typography: typo } = useTheme();
  const exceeded = ratio >= 1;
  const fillColor = exceeded ? colors.error : ratio >= 0.8 ? colors.warning : colors.primary;
  const fillWidth = `${Math.min(100, Math.max(0, ratio * 100))}%` as const;
  return (
    <View
      style={styles.usageBlock}
      accessibilityRole="text"
      accessibilityLabel={`${label} 사용률 ${formatPct(ratio)}, ${formatUsd(usedUsd)} / ${formatUsd(limitUsd)}`}
    >
      <View style={styles.usageHeader}>
        <Text style={[typo.caption, { color: colors.textSecondary }]}>{label}</Text>
        <Text style={[typo.caption, { color: exceeded ? colors.error : colors.text }]}>
          {formatUsd(usedUsd)} / {formatUsd(limitUsd)} ({formatPct(ratio)})
        </Text>
      </View>
      <View style={[styles.usageTrack, { backgroundColor: colors.borderLight }]}>
        <View style={[styles.usageFill, { width: fillWidth, backgroundColor: fillColor }]} />
      </View>
    </View>
  );
}

/** 라이브 AI 비용게이트 상시 모니터링 카드 (수용기준 배지 + 한도 사용률). */
function MonitoringCard({ health }: { health: AiCostHealth }) {
  const { colors, typography: typo } = useTheme();
  return (
    <View style={[styles.monitorCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      <View style={styles.monitorHeader}>
        <Feather name="activity" size={16} color={colors.primary} />
        <Text style={[typo.bodyMedium, { color: colors.text, marginLeft: spacing.xs }]}>
          비용게이트 상시 모니터링
        </Text>
      </View>

      <View style={styles.badgeRow}>
        <AcceptanceBadge ok={health.acceptance.costOk} label="건당비용" />
        <AcceptanceBadge ok={health.acceptance.l0Ok} label="L0비율" />
      </View>
      <Text style={[typo.small, { color: colors.textSecondary, marginBottom: spacing.md }]}>
        건당 {formatUsd(health.acceptance.costPerDisclosureUsd)} (기준 &lt;{formatUsd(health.acceptance.costThresholdUsd)})
        {' · '}L0 {formatPct(health.acceptance.l0Ratio)} (기준 ≥{formatPct(health.acceptance.l0ThresholdRatio)})
      </Text>

      <View style={[styles.divider, { backgroundColor: colors.borderLight }]} />

      <LimitUsageBar
        label="일 한도"
        usedUsd={health.limit.dailyCostUsd}
        limitUsd={health.limit.dailyLimitUsd}
        ratio={health.limitUsage.dailyUsedRatio}
      />
      <LimitUsageBar
        label="월 한도"
        usedUsd={health.limit.monthlyCostUsd}
        limitUsd={health.limit.monthlyLimitUsd}
        ratio={health.limitUsage.monthlyUsedRatio}
      />

      {!health.llmKeyConfigured && (
        <Text style={[typo.small, { color: colors.warning, marginTop: spacing.sm }]}>
          ⚠ LLM 키 미설정 — 과거 기록 기준 집계 (라이브 호출 없음)
        </Text>
      )}
      {health.alert.violated && (
        <Text
          style={[typo.small, { color: colors.error, marginTop: spacing.sm }]}
          accessibilityLabel={`운영 알림 ${health.alert.reasons.join(', ')}`}
        >
          ⚠ {health.alert.reasons.join(' · ')}
        </Text>
      )}
    </View>
  );
}

export default function AiCostScreen() {
  const { colors, typography: typo } = useTheme();
  const { data, isLoading, isError, refetch } = useAiCostMetrics();
  const { data: health } = useAiCostHealth();

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

          {/* Live monitoring card (DAR-75) */}
          {health && <MonitoringCard health={health} />}

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
  monitorCard: {
    borderRadius: radius.lg,
    borderWidth: 1,
    padding: spacing.lg,
    marginBottom: spacing.lg,
  },
  monitorHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacing.md,
  },
  badgeRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginBottom: spacing.sm,
  },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: radius.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    marginRight: spacing.sm,
    marginBottom: spacing.xs,
  },
  usageBlock: {
    marginTop: spacing.md,
  },
  usageHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: spacing.xs,
  },
  usageTrack: {
    height: 6,
    borderRadius: radius.sm,
    overflow: 'hidden',
  },
  usageFill: {
    height: 6,
    borderRadius: radius.sm,
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
