import React from 'react';
import { View, Text, ScrollView, RefreshControl, StyleSheet, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useTheme } from '@theme';
import { spacing, radius } from '@theme/spacing';
import { LoadingState, ApiErrorState, EmptyState } from '@components/common/StateView';
import { useCollectionStatus } from '@hooks/useCollectionStatus';
import { relativeTimeOrFallback } from '@utils/datetime';
import type {
  CollectionMaturity,
  CollectionRunStatus,
} from '@app-types/collection-status.types';

// 수집 현황 화면 — DAR-63. 공시·재무·지표·모의 4개 카드로 커버리지·최근수집·성숙도 노출.
// read-only 집계 소비. 테마토큰만 사용(하드코딩 색상 0), 빈/로딩/에러/접근성 처리.

const MATURITY_LABEL: Record<CollectionMaturity, string> = {
  SUFFICIENT: '충분',
  COLLECTING: '수집중',
  WAITING: '대기',
};

const STATUS_LABEL: Record<NonNullable<CollectionRunStatus>, string> = {
  SUCCESS: '성공',
  PARTIAL: '부분 성공',
  FAILED: '실패',
  RUNNING: '진행중',
};

// 성숙도 → 의미 색상 토큰. 배경은 surfaceSecondary 고정(테마 토큰), 글자만 의미색.
function maturityColor(
  maturity: CollectionMaturity,
  colors: ReturnType<typeof useTheme>['colors'],
): string {
  if (maturity === 'SUFFICIENT') return colors.success;
  if (maturity === 'COLLECTING') return colors.warning;
  return colors.textTertiary;
}

function formatStatus(status: CollectionRunStatus): string {
  return status ? STATUS_LABEL[status] : '–';
}

// YYYYMMDD → 'YYYY.MM.DD'. 형식이 다르면 원문 반환.
function formatTradeDate(yyyymmdd: string | null): string {
  if (!yyyymmdd || yyyymmdd.length !== 8) return yyyymmdd ?? '기록 없음';
  return `${yyyymmdd.slice(0, 4)}.${yyyymmdd.slice(4, 6)}.${yyyymmdd.slice(6, 8)}`;
}

function MaturityBadge({ maturity }: { maturity: CollectionMaturity }) {
  const { colors, typography: typo } = useTheme();
  const color = maturityColor(maturity, colors);
  return (
    <View
      style={[styles.badge, { backgroundColor: colors.surfaceSecondary }]}
      accessibilityLabel={`수집 성숙도: ${MATURITY_LABEL[maturity]}`}
    >
      <View style={[styles.badgeDot, { backgroundColor: color }]} />
      <Text style={[typo.small, { color, fontWeight: '600' }]}>
        {MATURITY_LABEL[maturity]}
      </Text>
    </View>
  );
}

function StatRow({ label, value }: { label: string; value: string }) {
  const { colors, typography: typo } = useTheme();
  return (
    <View style={styles.statRow}>
      <Text style={[typo.caption, { color: colors.textSecondary }]}>{label}</Text>
      <Text style={[typo.caption, { color: colors.text, fontWeight: '600' }]} numberOfLines={1}>
        {value}
      </Text>
    </View>
  );
}

interface CoverageCardProps {
  icon: keyof typeof Feather.glyphMap;
  title: string;
  metricLabel: string;
  metricValue: string;
  maturity: CollectionMaturity;
  rows: { label: string; value: string }[];
}

function CoverageCard({ icon, title, metricLabel, metricValue, maturity, rows }: CoverageCardProps) {
  const { colors, typography: typo } = useTheme();
  return (
    <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      <View style={styles.cardHeader}>
        <View style={styles.cardTitleGroup}>
          <View style={[styles.iconWrap, { backgroundColor: colors.primaryLight }]}>
            <Feather name={icon} size={18} color={colors.primary} />
          </View>
          <Text style={[typo.bodyMedium, { color: colors.text, fontWeight: '600' }]}>{title}</Text>
        </View>
        <MaturityBadge maturity={maturity} />
      </View>

      <View style={styles.metricRow}>
        <Text style={[typo.h2, { color: colors.primary }]}>{metricValue}</Text>
        <Text style={[typo.caption, { color: colors.textSecondary, marginLeft: spacing.xs }]}>
          {metricLabel}
        </Text>
      </View>

      <View style={[styles.divider, { backgroundColor: colors.borderLight }]} />
      {rows.map((r) => (
        <StatRow key={r.label} label={r.label} value={r.value} />
      ))}
    </View>
  );
}

export default function CollectionStatusScreen() {
  const { colors, typography: typo } = useTheme();
  const { data, isLoading, isError, error, refetch, isRefetching } = useCollectionStatus();

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={['top']}>
      {/* Header */}
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
        <Text style={[typo.h3, { color: colors.text }]}>수집 현황</Text>
        <View style={styles.backButton} />
      </View>

      {isLoading ? (
        <LoadingState message="수집 현황을 불러오는 중..." />
      ) : isError ? (
        <ApiErrorState
          error={error}
          onRetry={refetch}
          title="수집 현황을 불러오지 못했습니다"
          description="잠시 후 다시 시도해 주세요."
        />
      ) : !data ? (
        <EmptyState
          icon="database"
          title="수집 데이터가 없습니다"
          description="아직 집계할 수집 기록이 없습니다."
        />
      ) : (
        <ScrollView
          contentContainerStyle={styles.content}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={isRefetching}
              onRefresh={refetch}
              colors={[colors.primary]}
              tintColor={colors.primary}
            />
          }
        >
          <Text style={[typo.caption, { color: colors.textSecondary, marginBottom: spacing.md }]}>
            정보가 실제로 모이고 있는지 한눈에 확인하세요. 집계 {relativeTimeOrFallback(data.generatedAt)}.
          </Text>

          <CoverageCard
            icon="file-text"
            title="공시 수집"
            metricValue={data.disclosure.totalCount.toLocaleString('ko-KR')}
            metricLabel="누적 공시"
            maturity={data.disclosure.maturity}
            rows={[
              { label: '최근 신규', value: `${data.disclosure.lastNewCount.toLocaleString('ko-KR')}건` },
              { label: '최근 수집', value: relativeTimeOrFallback(data.disclosure.lastCollectedAt) },
              { label: '수집 상태', value: formatStatus(data.disclosure.lastStatus) },
            ]}
          />

          <CoverageCard
            icon="bar-chart-2"
            title="재무"
            metricValue={data.financial.coveredCompanies.toLocaleString('ko-KR')}
            metricLabel="보유 종목"
            maturity={data.financial.maturity}
            rows={[
              { label: '최근 분기', value: data.financial.latestPeriod ?? '기록 없음' },
              { label: '최근 수집', value: relativeTimeOrFallback(data.financial.lastCollectedAt) },
              { label: '수집 상태', value: formatStatus(data.financial.lastStatus) },
            ]}
          />

          <CoverageCard
            icon="trending-up"
            title="시세·지표"
            metricValue={data.indicator.coveredStocks.toLocaleString('ko-KR')}
            metricLabel="백필 종목"
            maturity={data.indicator.maturity}
            rows={[
              { label: '최근 거래일', value: formatTradeDate(data.indicator.latestTradeDate) },
              { label: '최근 수집', value: relativeTimeOrFallback(data.indicator.lastCollectedAt) },
              { label: '수집 상태', value: formatStatus(data.indicator.lastStatus) },
            ]}
          />

          <CoverageCard
            icon="activity"
            title="모의운용"
            metricValue={data.simulation.openPositions.toLocaleString('ko-KR')}
            metricLabel="보유 포지션"
            maturity={data.simulation.maturity}
            rows={[
              { label: '누적 체결', value: `${data.simulation.totalTrades.toLocaleString('ko-KR')}건` },
              { label: '최근 체결', value: relativeTimeOrFallback(data.simulation.lastTradeAt) },
            ]}
          />

          <Text style={[typo.small, { color: colors.textTertiary, marginTop: spacing.lg, textAlign: 'center' }]}>
            * 성숙도 배지: 충분(임계치 이상 누적) · 수집중(누적 진행) · 대기(데이터 없음).
          </Text>
          <View style={{ height: spacing['2xl'] }} />
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
  card: {
    borderRadius: radius.lg,
    borderWidth: 1,
    padding: spacing.base,
    marginBottom: spacing.md,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  cardTitleGroup: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  iconWrap: {
    width: 32,
    height: 32,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.sm,
  },
  metricRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    marginTop: spacing.md,
  },
  divider: {
    height: 1,
    marginVertical: spacing.md,
  },
  statRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.xs,
  },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: radius.full,
  },
  badgeDot: {
    width: 6,
    height: 6,
    borderRadius: radius.full,
    marginRight: spacing.xs,
  },
});
