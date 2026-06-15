import React, { useCallback } from 'react';
import { View, Text, FlatList, StyleSheet, TouchableOpacity } from 'react-native';
import { Surface, Banner } from 'react-native-paper';
import { Feather } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useTheme } from '@theme';
import { spacing, radius } from '@theme/spacing';
import { PriceChangeChip } from '@components/common/PriceChangeChip';
import { EmptyState, ErrorState } from '@components/common/StateView';
import { SkeletonList } from '@components/common/SkeletonCard';
import { EquityCurveChart } from '@components/portfolio/EquityCurveChart';
import { useSimulationStatus, useSimulationEquityCurve } from '@hooks/useSimulationStatus';
import { formatYmdDots } from '@utils/datetime';
import { dedupeByStock } from '@utils/dedupe';

import type { SimPosition, SimulationMetrics } from '@app-types/simulation.types';

// 모의운용(서버 시뮬) 현황 섹션 — DAR-42.
// 서버가 일일 사이클로 처리한 모의운용 결과(평가금액·보유 포지션·졸업지표)를 준실시간(45s 폴링) 표시.
// 테마 토큰만 사용·하드코딩 색상 0·접근성 라벨. AI 지표는 참고정보(면책 유지).

/** 적중률/정확도(0~1) 표시 — 표본 없으면 '표본 부족'(정직 표기) */
function formatRate(value: number | null): string {
  return value === null ? '표본 부족' : `${Math.round(value * 100)}%`;
}

/** AI비용/순익 비율 — 순익 ≤ 0이면 측정 불가 */
function formatRatio(value: number | null): string {
  return value === null ? '측정 불가' : value.toFixed(2);
}

interface MetricRowProps {
  label: string;
  value: string;
  sub?: string;
}

function MetricRow({ label, value, sub }: MetricRowProps) {
  const { colors, typography: typo } = useTheme();
  return (
    <View
      style={styles.metricRow}
      accessibilityRole="text"
      accessibilityLabel={`${label} ${value}${sub ? ` ${sub}` : ''}`}
    >
      <Text style={[typo.small, { color: colors.textSecondary }]}>{label}</Text>
      <Text style={[typo.captionMedium, { color: colors.text }]}>
        {value}
        {sub ? <Text style={[typo.small, { color: colors.textTertiary }]}>{`  ${sub}`}</Text> : null}
      </Text>
    </View>
  );
}

function PositionRow({ item }: { item: SimPosition }) {
  const { colors, typography: typo } = useTheme();
  const name = item.corpName ?? item.stockCode;
  return (
    <Surface
      elevation={1}
      style={[styles.positionCard, { backgroundColor: colors.surface, borderColor: colors.border }]}
    >
      <View style={styles.positionTop}>
        <View style={styles.positionNameBox}>
          <Text style={[typo.bodyMedium, { color: colors.text }]} numberOfLines={1}>
            {name}
          </Text>
          <Text style={[typo.small, { color: colors.textSecondary }]}>
            {item.quantity.toLocaleString('ko-KR')}주
          </Text>
        </View>
        <PriceChangeChip value={item.unrealizedPnlPct} amount={item.unrealizedPnl} />
      </View>
      <Text style={[typo.small, { color: colors.textSecondary, marginTop: spacing.xs }]}>
        평가금액 {Math.round(item.currentValue).toLocaleString('ko-KR')}원
      </Text>
    </Surface>
  );
}

// 모의 자산곡선 카드 — DAR-105. status 와 동일 주기로 폴링하는 별도 쿼리를 자체 소비.
// 자산곡선은 보조 지표이므로 로딩/에러/빈상태를 카드 내부에서 비차단(non-blocking)으로 처리:
// 메인 현황 리스트는 자산곡선 실패와 무관하게 계속 표시된다(동선 단절 방지).
function EquityCurveCard() {
  const { colors, typography: typo } = useTheme();
  const query = useSimulationEquityCurve();
  const curve = query.data;

  const renderBody = () => {
    if (query.isLoading) {
      return (
        <Text style={[typo.small, { color: colors.textTertiary, paddingVertical: spacing.sm }]}>
          자산곡선 불러오는 중…
        </Text>
      );
    }
    if (query.isError) {
      return (
        <TouchableOpacity
          activeOpacity={0.7}
          onPress={() => query.refetch()}
          accessibilityRole="button"
          accessibilityLabel="자산곡선을 불러오지 못했습니다. 다시 시도"
          style={styles.curveRetry}
        >
          <Feather name="refresh-cw" size={14} color={colors.primary} />
          <Text style={[typo.small, { color: colors.primary }]}>
            자산곡선을 불러오지 못했습니다 · 다시 시도
          </Text>
        </TouchableOpacity>
      );
    }
    if (!curve || curve.points.length === 0) {
      return (
        <Text style={[typo.small, { color: colors.textTertiary, paddingVertical: spacing.sm }]}>
          아직 자산곡선 데이터가 없습니다 — 일일 사이클이 누적되면 표시됩니다.
        </Text>
      );
    }
    return <EquityCurveChart points={curve.points} initialCapital={curve.initialCapital} />;
  };

  return (
    <Surface
      elevation={1}
      style={[styles.summary, { backgroundColor: colors.surface, borderColor: colors.border }]}
    >
      <Text style={[typo.captionMedium, { color: colors.text, marginBottom: spacing.xs }]}>
        모의 자산곡선
      </Text>
      {renderBody()}
    </Surface>
  );
}

// 드릴다운 진입 카드 — DAR-105. 매매 성적표·철학 체크리스트 등 검증 동선 진입점 공용.
function DrilldownLink({
  icon,
  title,
  subtitle,
  onPress,
  accessibilityLabel,
}: {
  icon: keyof typeof Feather.glyphMap;
  title: string;
  subtitle: string;
  onPress: () => void;
  accessibilityLabel: string;
}) {
  const { colors, typography: typo } = useTheme();
  return (
    <TouchableOpacity
      activeOpacity={0.7}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
    >
      <Surface
        elevation={1}
        style={[styles.tradeLink, { backgroundColor: colors.surface, borderColor: colors.border }]}
      >
        <Feather name={icon} size={18} color={colors.primary} />
        <View style={styles.tradeLinkText}>
          <Text style={[typo.captionMedium, { color: colors.text }]}>{title}</Text>
          <Text style={[typo.small, { color: colors.textSecondary }]}>{subtitle}</Text>
        </View>
        <Feather name="chevron-right" size={18} color={colors.textTertiary} />
      </Surface>
    </TouchableOpacity>
  );
}

function SummaryHeader({
  equity,
  initialCapital,
  metrics,
  latestSnapshotDate,
}: {
  equity: number;
  initialCapital: number;
  metrics: SimulationMetrics;
  latestSnapshotDate: string | null;
}) {
  const { colors, typography: typo } = useTheme();
  return (
    <View style={styles.headerBox}>
      <Banner
        visible
        actions={[]}
        icon="flask"
        style={[styles.banner, { backgroundColor: colors.surfaceSecondary }]}
      >
        <Text style={[typo.small, { color: colors.info }]}>
          모의운용 — 실제 주문이 아닙니다. 졸업지표·AI 분석은 참고용입니다.
        </Text>
      </Banner>

      <Surface
        elevation={1}
        style={[styles.summary, { backgroundColor: colors.surface, borderColor: colors.border }]}
      >
        <Text style={[typo.small, { color: colors.textSecondary }]}>모의 평가금액</Text>
        <Text style={[typo.h2, { color: colors.text, marginTop: spacing.xs }]}>
          {Math.round(equity).toLocaleString('ko-KR')}원
        </Text>
        <View style={styles.summaryChipRow}>
          <PriceChangeChip value={metrics.cumulativeReturnPct} amount={metrics.netPnl} />
        </View>
        <Text style={[typo.small, { color: colors.textTertiary, marginTop: spacing.xs }]}>
          초기 가상원금 {initialCapital.toLocaleString('ko-KR')}원
          {latestSnapshotDate ? `  ·  기준일 ${formatYmdDots(latestSnapshotDate)}` : ''}
        </Text>
      </Surface>

      {/* 모의 자산곡선 연동 (DAR-105) — 컴포넌트는 존재했으나 포트폴리오 동선에 미연결이었음 */}
      <EquityCurveCard />

      <Surface
        elevation={1}
        style={[styles.summary, { backgroundColor: colors.surface, borderColor: colors.border }]}
      >
        <Text style={[typo.captionMedium, { color: colors.text, marginBottom: spacing.xs }]}>
          졸업지표 요약
        </Text>
        <MetricRow
          label="신호 적중률(D+5)"
          value={formatRate(metrics.hitRateD5)}
          sub={`n=${metrics.hitRateSampleSize}`}
        />
        <MetricRow
          label="누적 수익률"
          value={`${metrics.cumulativeReturnPct >= 0 ? '+' : ''}${metrics.cumulativeReturnPct.toFixed(2)}%`}
        />
        <MetricRow
          label="Exit 정확도(D+3)"
          value={formatRate(metrics.exitAccuracyD3)}
          sub={`n=${metrics.exitAccuracySampleSize}`}
        />
        <MetricRow label="AI비용/순익" value={formatRatio(metrics.aiCostToNetPnlRatio)} />
      </Surface>

      {/* 검증 동선 드릴다운 진입점 (DAR-105) */}
      {/* 성과 리포트 진입 (DAR-64 성적표 → DAR-120 성과·정밀도·보정 3탭) */}
      <DrilldownLink
        icon="clipboard"
        title="성과 리포트"
        subtitle="매매 성적표 · 신호 정밀도 · 보정 권고"
        onPress={() => router.push('/portfolio/trade-history')}
        accessibilityLabel="성과 리포트 — 매매 성적표·신호 정밀도·보정 권고"
      />

      {/* 철학 체크리스트 진입점 (DAR-105) — 투자거장 허브에서 거장별 체크리스트로 종목 점검 */}
      <DrilldownLink
        icon="check-square"
        title="철학 체크리스트"
        subtitle="투자거장 원칙으로 보유 종목 점검 · 참고용"
        onPress={() => router.push('/philosophy')}
        accessibilityLabel="철학 체크리스트 — 투자거장 원칙으로 종목 점검"
      />

      <Text style={[typo.captionMedium, { color: colors.text, marginTop: spacing.sm }]}>
        보유 포지션
      </Text>
    </View>
  );
}

export function SimulationStatusSection() {
  const { colors } = useTheme();
  const query = useSimulationStatus();

  const renderPosition = useCallback(
    ({ item }: { item: SimPosition }) => <PositionRow item={item} />,
    [],
  );

  if (query.isLoading) return <SkeletonList variant="buyScore" />;
  if (query.isError) {
    return <ErrorState title="모의운용 현황을 불러오지 못했습니다." onRetry={query.refetch} />;
  }

  const status = query.data;

  // DAR-122: 종목당 1카드(데이터 레벨 중복 보조 방어선). keyExtractor에 index를 쓰면
  // 중복이 '정상 렌더'되어 오히려 눈에 보이므로, 디듑 후 안정 키(stockCode/corpCode)만 사용.
  const positions = dedupeByStock(status?.positions ?? [], (item) => item.corpCode);

  return (
    <FlatList
      data={positions}
      renderItem={renderPosition}
      keyExtractor={(item) => item.stockCode || item.corpCode}
      contentContainerStyle={styles.listContent}
      showsVerticalScrollIndicator={false}
      refreshing={query.isRefetching}
      onRefresh={query.refetch}
      ListHeaderComponent={
        status ? (
          <SummaryHeader
            equity={status.equity}
            initialCapital={status.initialCapital}
            metrics={status.metrics}
            latestSnapshotDate={status.latestSnapshotDate}
          />
        ) : null
      }
      ListEmptyComponent={
        <EmptyState
          icon="inbox"
          title="아직 BUY 신호 없음"
          description="매수 후보가 생기면 모의운용에 자동 반영됩니다."
        />
      }
      style={{ backgroundColor: colors.background }}
    />
  );
}

const styles = StyleSheet.create({
  listContent: {
    padding: spacing.lg,
    gap: spacing.md,
    flexGrow: 1,
  },
  headerBox: {
    gap: spacing.md,
  },
  banner: {
    borderRadius: radius.md,
  },
  summary: {
    borderRadius: radius.lg,
    borderWidth: 1,
    padding: spacing.base,
  },
  summaryChipRow: {
    flexDirection: 'row',
    marginTop: spacing.sm,
  },
  metricRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: spacing.xs,
  },
  positionCard: {
    borderRadius: radius.lg,
    borderWidth: 1,
    padding: spacing.base,
  },
  positionTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: spacing.sm,
  },
  positionNameBox: {
    flex: 1,
    gap: spacing.xs,
  },
  tradeLink: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    borderRadius: radius.lg,
    borderWidth: 1,
    padding: spacing.base,
  },
  tradeLinkText: {
    flex: 1,
    gap: spacing.xs,
  },
  curveRetry: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingVertical: spacing.sm,
  },
});
