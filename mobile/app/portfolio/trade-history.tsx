import React, { useCallback } from 'react';
import { View, Text, FlatList, StyleSheet, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Surface, Banner } from 'react-native-paper';
import { Feather } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useTheme } from '@theme';
import { spacing, radius } from '@theme/spacing';
import { LoadingState, ApiErrorState, EmptyState } from '@components/common/StateView';
import { AppRefreshControl } from '@components/common/AppRefreshControl';
import { PriceChangeChip } from '@components/common/PriceChangeChip';
import { SignalAccuracySection } from '@components/portfolio/SignalAccuracySection';
import { CalibrationSection } from '@components/portfolio/CalibrationSection';
import { useTradeHistory } from '@hooks/useTradeHistory';

import type { TradeRationale, TradeScorecard } from '@app-types/trade-rationale.types';

// 모의 매매 사유 추적 + 성적표 화면 — DAR-64.
// 포지션별 진입/청산 근거 + 누적 성적표. 표본 부족 시 '데이터 한계' 배지(과신방지).
// 테마토큰만(하드코딩 색상 0)·면책·접근성·FlatList·빈/로딩/에러 처리.

// 청산 트리거 enum → 한국어 라벨 (백엔드 ExitTriggerType)
const TRIGGER_LABEL: Record<string, string> = {
  STOP_LOSS: '손절',
  TAKE_PROFIT: '익절',
  THESIS_INVALIDATED: '논리 훼손',
  TIME_LIMIT: '보유기간 초과',
  CHART_BREAKDOWN: '차트 이탈',
  REBALANCING: '리밸런싱',
};

// 청산 액션 enum → 한국어 라벨 (백엔드 ExitAction)
const ACTION_LABEL: Record<string, string> = {
  EXIT: '전량 청산',
  BLOCK_REBUY: '청산·재매수 차단',
  REDUCE: '비중 축소',
  WATCH: '관찰',
  HOLD: '보유',
};

function triggerLabel(t: string): string {
  return TRIGGER_LABEL[t] ?? t;
}

function formatPnl(pnl: number): string {
  const sign = pnl > 0 ? '+' : '';
  return `${sign}${Math.round(pnl).toLocaleString('ko-KR')}원`;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`;
}

function StatusBadge({ status }: { status: 'OPEN' | 'CLOSED' }) {
  const { colors, typography: typo } = useTheme();
  const isOpen = status === 'OPEN';
  const color = isOpen ? colors.info : colors.textSecondary;
  return (
    <View
      style={[styles.statusBadge, { backgroundColor: colors.surfaceSecondary }]}
      accessibilityLabel={isOpen ? '보유 중' : '청산 완료'}
    >
      <Text style={[typo.small, { color, fontWeight: '600' }]}>{isOpen ? '보유 중' : '청산 완료'}</Text>
    </View>
  );
}

function Chip({ label }: { label: string }) {
  const { colors, typography: typo } = useTheme();
  return (
    <View style={[styles.chip, { backgroundColor: colors.surfaceSecondary, borderColor: colors.borderLight }]}>
      <Text style={[typo.small, { color: colors.textSecondary }]} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

function Scorecard({ scorecard }: { scorecard: TradeScorecard }) {
  const { colors, typography: typo } = useTheme();
  const winRateText = scorecard.winRate === null ? '표본 부족' : `${Math.round(scorecard.winRate * 100)}%`;
  const avgHoldText = scorecard.avgHoldDays === null ? '—' : `${scorecard.avgHoldDays}일`;

  return (
    <Surface
      elevation={1}
      style={[styles.scorecard, { backgroundColor: colors.surface, borderColor: colors.border }]}
    >
      <View style={styles.scorecardHeader}>
        <Text style={[typo.captionMedium, { color: colors.text }]}>매매 성적표</Text>
        {scorecard.lowSample ? (
          <View style={[styles.warnBadge, { backgroundColor: colors.surfaceSecondary }]}>
            <Feather name="alert-triangle" size={11} color={colors.warning} />
            <Text style={[typo.small, { color: colors.warning, marginLeft: spacing.xs, fontWeight: '600' }]}>
              데이터 한계 (표본 {scorecard.sampleSize})
            </Text>
          </View>
        ) : null}
      </View>

      <View style={styles.metricGrid}>
        <Metric label="승률" value={winRateText} sub={`${scorecard.winCount}승 ${scorecard.lossCount}패`} />
        <Metric
          label="누적 수익률"
          value={`${scorecard.cumulativeReturnPct >= 0 ? '+' : ''}${scorecard.cumulativeReturnPct.toFixed(2)}%`}
          valueColor={scorecard.cumulativeReturnPct >= 0 ? colors.success : colors.error}
        />
        <Metric label="평균 손익" value={formatPnl(scorecard.avgPnl)} />
        <Metric label="평균 보유" value={avgHoldText} />
      </View>
    </Surface>
  );
}

function Metric({
  label,
  value,
  sub,
  valueColor,
}: {
  label: string;
  value: string;
  sub?: string;
  valueColor?: string;
}) {
  const { colors, typography: typo } = useTheme();
  return (
    <View style={styles.metric} accessibilityRole="text" accessibilityLabel={`${label} ${value}${sub ? ` ${sub}` : ''}`}>
      <Text style={[typo.small, { color: colors.textSecondary }]}>{label}</Text>
      <Text style={[typo.captionMedium, { color: valueColor ?? colors.text, marginTop: spacing.xs }]}>{value}</Text>
      {sub ? <Text style={[typo.small, { color: colors.textTertiary }]}>{sub}</Text> : null}
    </View>
  );
}

function TradeCard({ item }: { item: TradeRationale }) {
  const { colors, typography: typo } = useTheme();
  const name = item.corpName ?? item.stockCode;

  return (
    <Surface
      elevation={1}
      style={[styles.tradeCard, { backgroundColor: colors.surface, borderColor: colors.border }]}
    >
      <View style={styles.tradeTop}>
        <View style={styles.tradeNameBox}>
          <View style={styles.tradeNameRow}>
            <Text style={[typo.bodyMedium, { color: colors.text }]} numberOfLines={1}>
              {name}
            </Text>
            <StatusBadge status={item.status} />
          </View>
          <Text style={[typo.small, { color: colors.textSecondary, marginTop: spacing.xs }]}>
            {formatDate(item.entryDate)}
            {item.exitDate ? ` → ${formatDate(item.exitDate)}` : ''}
            {item.holdDays !== null ? `  ·  ${item.holdDays}일 보유` : ''}
            {`  ·  ${item.quantity.toLocaleString('ko-KR')}주`}
          </Text>
        </View>
        <PriceChangeChip value={item.pnlPct} amount={item.pnl} />
      </View>

      {/* 진입 사유 */}
      <View style={[styles.section, { borderTopColor: colors.borderLight }]}>
        <Text style={[typo.small, { color: colors.textTertiary, marginBottom: spacing.xs }]}>진입 사유</Text>
        <Text style={[typo.caption, { color: colors.text }]}>
          {item.entryReason ?? '근거 기록 없음 (룰 기반 진입)'}
        </Text>
        {item.entryBasis.length > 0 ? (
          <View style={styles.chipWrap}>
            {item.entryBasis.map((b, i) => (
              <Chip key={`${item.positionId}-eb-${i}`} label={b} />
            ))}
          </View>
        ) : null}
      </View>

      {/* 청산 사유 (CLOSED 만) */}
      {item.status === 'CLOSED' ? (
        <View style={[styles.section, { borderTopColor: colors.borderLight }]}>
          <Text style={[typo.small, { color: colors.textTertiary, marginBottom: spacing.xs }]}>청산 사유</Text>
          <Text style={[typo.caption, { color: colors.text }]}>
            {item.exitAction ? ACTION_LABEL[item.exitAction] ?? item.exitAction : '청산 완료'}
          </Text>
          {item.exitTriggers.length > 0 ? (
            <View style={styles.chipWrap}>
              {item.exitTriggers.map((t, i) => (
                <Chip key={`${item.positionId}-et-${i}`} label={triggerLabel(t)} />
              ))}
            </View>
          ) : null}
        </View>
      ) : null}
    </Surface>
  );
}

export default function TradeHistoryScreen() {
  const { colors, typography: typo } = useTheme();
  const query = useTradeHistory();

  const renderTrade = useCallback(
    ({ item }: { item: TradeRationale }) => <TradeCard item={item} />,
    [],
  );

  const data = query.data;

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={['top']}>
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <TouchableOpacity
          onPress={() => router.back()}
          hitSlop={8}
          style={styles.backButton}
          accessibilityRole="button"
          accessibilityLabel="뒤로 가기"
        >
          <Feather name="chevron-left" size={26} color={colors.text} />
        </TouchableOpacity>
        <Text style={[typo.h3, { color: colors.text }]}>매매 성적표</Text>
        <View style={styles.backButton} />
      </View>

      {query.isLoading ? (
        <LoadingState message="매매 기록을 불러오는 중..." />
      ) : query.isError ? (
        <ApiErrorState
          error={query.error}
          onRetry={query.refetch}
          title="매매 기록을 불러오지 못했습니다"
          description="잠시 후 다시 시도해 주세요."
        />
      ) : (
        <FlatList
          data={data?.trades ?? []}
          renderItem={renderTrade}
          keyExtractor={(item) => item.positionId}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          refreshControl={<AppRefreshControl refreshing={query.isRefetching} onRefresh={query.refetch} />}
          ListHeaderComponent={
            <View style={styles.headerBox}>
              <Banner
                visible
                actions={[]}
                icon="flask"
                style={[styles.banner, { backgroundColor: colors.surfaceSecondary }]}
              >
                <Text style={[typo.small, { color: colors.info }]}>
                  모의운용 — 실제 주문이 아닙니다. 모든 매매에 추적 가능한 근거를 함께 표시합니다.
                </Text>
              </Banner>
              {data ? <Scorecard scorecard={data.scorecard} /> : null}
              <SignalAccuracySection />
              <CalibrationSection />
              <Text style={[typo.captionMedium, { color: colors.text, marginTop: spacing.sm }]}>
                매매 내역
              </Text>
            </View>
          }
          ListEmptyComponent={
            <EmptyState
              icon="clipboard"
              title="아직 매매 기록이 없습니다"
              description="모의운용에서 매수가 발생하면 진입/청산 근거가 여기에 기록됩니다."
            />
          }
        />
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
  backButton: { width: 40, alignItems: 'flex-start' },
  listContent: { padding: spacing.lg, gap: spacing.md, flexGrow: 1 },
  headerBox: { gap: spacing.md },
  banner: { borderRadius: radius.md },
  scorecard: { borderRadius: radius.lg, borderWidth: 1, padding: spacing.base },
  scorecardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.md,
  },
  warnBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: radius.full,
  },
  metricGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  metric: { width: '50%', marginBottom: spacing.sm },
  tradeCard: { borderRadius: radius.lg, borderWidth: 1, padding: spacing.base },
  tradeTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: spacing.sm,
  },
  tradeNameBox: { flex: 1 },
  tradeNameRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  section: {
    borderTopWidth: 1,
    marginTop: spacing.md,
    paddingTop: spacing.md,
  },
  chipWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
    marginTop: spacing.sm,
  },
  chip: {
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: radius.sm,
    borderWidth: 1,
  },
  statusBadge: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: radius.full,
  },
});
