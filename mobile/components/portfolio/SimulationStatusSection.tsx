import React, { useCallback, useState } from 'react';
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

// 검증 동선 푸터 링크 — DAR-358. DAR-105의 인라인 카드(고가치 시각공간 점유)를
// 푸터 바의 경량 버튼으로 강등. 터치 영역은 44pt 이상 유지.
function FooterLink({
  icon,
  label,
  onPress,
  accessibilityLabel,
}: {
  icon: keyof typeof Feather.glyphMap;
  label: string;
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
      style={styles.footerLink}
    >
      <Feather name={icon} size={16} color={colors.primary} />
      <Text style={[typo.small, { color: colors.primary }]} numberOfLines={1}>
        {label}
      </Text>
    </TouchableOpacity>
  );
}

// DAR-358: 모의 성과 헤더 간결화 — 7+ 섹션 워터폴 → 핵심 3카드 + 점진적 공개.
// ① 핵심 카드(평가금액·손익=누적수익률·승률) — 진입 즉시 가장 중요한 지표 노출.
// ② 자산곡선(async 논블로킹 유지). ③ 나머지 졸업지표는 접이(More)로 점진적 공개.
// 드릴다운(성과 리포트·철학 체크)은 인라인 카드 → 푸터 바로 강등.
function SummaryHeader({
  equity,
  initialCapital,
  metrics,
  latestSnapshotDate,
  positionCount,
}: {
  equity: number;
  initialCapital: number;
  metrics: SimulationMetrics;
  latestSnapshotDate: string | null;
  positionCount: number;
}) {
  const { colors, typography: typo } = useTheme();
  const [metricsExpanded, setMetricsExpanded] = useState(false);
  const cumReturnText = `${metrics.cumulativeReturnPct >= 0 ? '+' : ''}${metrics.cumulativeReturnPct.toFixed(2)}%`;

  return (
    <View style={styles.headerBox}>
      {/* 면책(정직 라벨) — 카드 아님, 얇은 배너 유지 */}
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

      {/* 카드 ① 핵심 — 평가금액 + 손익(누적수익률) + 승률을 진입 즉시 노출 */}
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
        {/* DAR-393: 평가금액·등락률은 '지금' 실시간 실가 재평가값(자산곡선 최신점과 동일). 과거
            스냅샷일을 기준일로 표기하면 live 값을 stale 로 오인시키므로 '실시간 현재가 기준'으로 정직 표기. */}
        <Text style={[typo.small, { color: colors.textTertiary, marginTop: spacing.xs }]}>
          실시간 현재가 기준 · 자산곡선 최신점과 동일
        </Text>
        {/* 핵심지표: 승률(누적수익률은 위 칩으로 노출) — 4번째 카드에 묻히던 지표를 전면 배치 */}
        <View
          style={[styles.keyMetric, { borderTopColor: colors.border }]}
          accessibilityRole="text"
          accessibilityLabel={`신호 적중률 D+5 ${formatRate(metrics.hitRateD5)} 표본 ${metrics.hitRateSampleSize}`}
        >
          <Text style={[typo.small, { color: colors.textSecondary }]}>신호 적중률(D+5)</Text>
          <Text style={[typo.captionMedium, { color: colors.text }]}>
            {formatRate(metrics.hitRateD5)}
            <Text style={[typo.small, { color: colors.textTertiary }]}>
              {`  n=${metrics.hitRateSampleSize}`}
            </Text>
          </Text>
        </View>
        <Text style={[typo.small, { color: colors.textTertiary, marginTop: spacing.xs }]}>
          초기 가상원금 {initialCapital.toLocaleString('ko-KR')}원
          {latestSnapshotDate ? `  ·  최근 스냅샷 ${formatYmdDots(latestSnapshotDate)}` : ''}
        </Text>
      </Surface>

      {/* 카드 ② 모의 자산곡선 (DAR-105) — async 논블로킹 유지 */}
      <EquityCurveCard />

      {/* 카드 ③ 나머지 졸업지표 — 점진적 공개(접이). 기본 접힘으로 카드 체감 수 감소 */}
      <Surface
        elevation={1}
        style={[styles.summary, { backgroundColor: colors.surface, borderColor: colors.border }]}
      >
        <TouchableOpacity
          activeOpacity={0.7}
          onPress={() => setMetricsExpanded((v) => !v)}
          accessibilityRole="button"
          accessibilityState={{ expanded: metricsExpanded }}
          accessibilityLabel={`상세 졸업지표 ${metricsExpanded ? '접기' : '펼치기'}`}
          style={styles.collapseHeader}
        >
          <Text style={[typo.captionMedium, { color: colors.text }]}>상세 졸업지표</Text>
          <Feather
            name={metricsExpanded ? 'chevron-up' : 'chevron-down'}
            size={18}
            color={colors.textTertiary}
          />
        </TouchableOpacity>
        {metricsExpanded ? (
          <View style={{ marginTop: spacing.xs }}>
            <MetricRow label="누적 수익률" value={cumReturnText} />
            <MetricRow
              label="Exit 정확도(D+3)"
              value={formatRate(metrics.exitAccuracyD3)}
              sub={`n=${metrics.exitAccuracySampleSize}`}
            />
            <MetricRow label="AI비용/순익" value={formatRatio(metrics.aiCostToNetPnlRatio)} />
          </View>
        ) : null}
      </Surface>

      {/* 검증 동선 — 인라인 카드 → 푸터 바로 강등 (DAR-358) */}
      <View style={styles.footerBar}>
        <FooterLink
          icon="clipboard"
          label="성과 리포트"
          onPress={() => router.push('/portfolio/trade-history')}
          accessibilityLabel="성과 리포트 — 매매 성적표·신호 정밀도·보정 권고"
        />
        <View style={[styles.footerDivider, { backgroundColor: colors.border }]} />
        <FooterLink
          icon="check-square"
          label="철학 체크"
          onPress={() => router.push('/philosophy')}
          accessibilityLabel="철학 체크리스트 — 투자거장 원칙으로 종목 점검"
        />
        {/* DAR-361: 자동매매 상태(읽기전용 투명성) 진입을 C(DAR-358) 간결 푸터 바에 합류.
            중복 '철학 체크' 금지 — 모니터링 전용 진입만 추가. */}
        <View style={[styles.footerDivider, { backgroundColor: colors.border }]} />
        <FooterLink
          icon="shield"
          label="자동매매 상태"
          onPress={() => router.push('/portfolio/auto-trading')}
          accessibilityLabel="자동매매 상태 — 킬스위치·리스크게이트·최근 실행 모니터링. 자동 실행은 준비중."
        />
      </View>

      {/* 보유 포지션 — 리스트 헤더로 시각 축소 (DAR-358) */}
      <Text style={[typo.small, { color: colors.textSecondary, marginTop: spacing.xs }]}>
        보유 포지션 {positionCount}
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
  // 중복이 '정상 렌더'되어 오히려 눈에 보이므로, 디듑 후 안정 키만 사용.
  // DAR-335: 디듑 보장키와 keyExtractor를 corpCode로 일치(서로 다른 corpCode가 동일
  // stockCode를 가질 때의 키 충돌 위험 제거). corpCode는 포지션 자연 FK로 항상 존재.
  const positions = dedupeByStock(status?.positions ?? [], (item) => item.corpCode);

  return (
    <FlatList
      data={positions}
      renderItem={renderPosition}
      keyExtractor={(item) => item.corpCode}
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
            positionCount={positions.length}
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
  keyMetric: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: spacing.sm,
    paddingTop: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  collapseHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    minHeight: 44,
  },
  footerBar: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  footerLink: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    minHeight: 44,
  },
  footerDivider: {
    width: StyleSheet.hairlineWidth,
    alignSelf: 'stretch',
    marginVertical: spacing.sm,
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
  curveRetry: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingVertical: spacing.sm,
  },
});
