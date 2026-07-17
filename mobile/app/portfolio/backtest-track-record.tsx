import React, { useMemo } from 'react';
import { View, Text, ScrollView, StyleSheet, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Surface } from 'react-native-paper';
import { Feather } from '@expo/vector-icons';
import { router } from 'expo-router';
import { withTradingGuard } from '@components/common/withTradingGuard';
import { useTheme, MAX_CHIP_FONT_SCALE } from '@theme';
import { spacing, radius } from '@theme/spacing';
import { ScreenHeader } from '@components/common/ScreenHeader';
import { ApiErrorState, EmptyState } from '@components/common/StateView';
import { DetailSkeleton } from '@components/common/DetailSkeleton';
import { FEE_BASIS_NOTICE } from '@components/common/feeBasisCopy';
import { EquityCurveChart } from '@components/portfolio/EquityCurveChart';
import { useBacktestTrackRecord } from '@hooks/useBacktestTrackRecord';
import { useManualRefresh } from '@hooks/useManualRefresh';
import { pnlColor } from '@utils/signalDisplay';
import { formatReturnPct } from '@utils/numberFormat';
import { getEventTypeLabel } from '@utils/disclosureType';

import type { EquityCurvePoint } from '@app-types/simulation.types';
import type {
  BacktestTrackRecord,
  BacktestMetrics,
  BacktestGroupMetrics,
} from '@app-types/backtest.types';

// 1년 자동매매 백테스트 트랙레코드 화면 — DAR-388 (백엔드 DAR-385).
// 목적: 사용자가 1년 point-in-time 리플레이 성과를 직접 보고 시스템 트레이딩 신뢰를 판단.
// 정직 원칙: ① 미래정보 미사용 백테스트임을 명시 ② 신호 커버리지가 추출 진행에 따라 채워짐 고지
//            ③ 손실도 그대로 표시(체리피킹 아님). 테마 토큰만(하드코딩 색상 0).

/** YYYY-MM-DD → YYYYMMDD (EquityCurveChart 의 snapshotDate 계약). */
function compactDate(isoDate: string): string {
  return isoDate.replace(/-/g, '');
}

/** YYYY-MM-DD → YYYY.MM.DD (헤더 기간 표기). */
function dotDate(isoDate: string): string {
  return isoDate.replace(/-/g, '.');
}

/** % 값(0~100 스케일)을 소수 1자리 + % 로. null/NaN 은 '—'. */
function formatPct(value: number | null | undefined, digits = 1): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '—';
  return `${value.toFixed(digits)}%`;
}

function formatNumber(value: number | null | undefined, digits = 2): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '—';
  return value.toFixed(digits);
}

/**
 * CONF-02: 검증 상태 뱃지 — 매수 로직 재검증이 진행 중임을 헤더에서 고지한다.
 * DataLimitBadge 톤(warning 테두리·아이콘+평문, 색 단독 의미 금지) 재사용.
 * ★불합격 수치·rankCorr 등 구체 수치는 절대 비노출 — 2회차 확정값만 표면화 방침.
 */
function VerificationStatusBadge() {
  const { colors, typography: typo } = useTheme();
  return (
    <View
      style={[
        styles.verifyBadge,
        { backgroundColor: colors.surfaceSecondary, borderColor: colors.warning },
      ]}
      accessibilityRole="text"
      accessibilityLabel="검증 상태: 매수 로직 재검증 진행 중. 확정 전까지 참고용입니다."
    >
      <Feather name="alert-triangle" size={11} color={colors.warning} />
      <Text
        numberOfLines={1}
        maxFontSizeMultiplier={MAX_CHIP_FONT_SCALE}
        style={[
          typo.small,
          {
            color: colors.warning,
            marginLeft: spacing.xs,
            fontWeight: '600',
            flexShrink: 1,
            minWidth: 0,
          },
        ]}
        ellipsizeMode="tail"
      >
        매수 로직 재검증 진행 중 (참고)
      </Text>
    </View>
  );
}

/** ① 헤더 요약 — 기간·초기자본·총수익률(대형 색조)·승률(대형). */
function SummaryHeaderCard({ record }: { record: BacktestTrackRecord }) {
  const { colors, typography: typo } = useTheme();
  const m = record.metrics;
  const returnTone = pnlColor(m.totalReturn, colors, { digits: 2 });
  const arrow = m.totalReturn > 0 ? '▲' : m.totalReturn < 0 ? '▼' : '·';

  return (
    <Surface
      elevation={1}
      style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}
    >
      {/* CONF-02: 검증 상태 뱃지 — 헤더 1개소. */}
      <VerificationStatusBadge />

      <Text style={[typo.small, { color: colors.textSecondary }]}>
        {dotDate(record.startDate)} ~ {dotDate(record.endDate)} · 초기자본{' '}
        {record.initialCapital.toLocaleString('ko-KR')}원
      </Text>

      <View style={styles.headlineRow}>
        <View style={styles.headlineCol}>
          <Text style={[typo.small, { color: colors.textSecondary }]}>총수익률</Text>
          <Text
            style={[typo.amount, { color: returnTone }]}
            accessibilityLabel={`총수익률 ${formatReturnPct(m.totalReturn, { digits: 2 })}`}
          >
            {arrow} {formatReturnPct(m.totalReturn, { digits: 2 })}
          </Text>
        </View>
        <View style={styles.headlineCol}>
          <Text style={[typo.small, { color: colors.textSecondary }]}>승률</Text>
          {/* C10: 총수익률(typo.amount)을 1차 지표로, 승률은 h2로 강등해 위계 분리. */}
          <Text style={[typo.h2, { color: colors.text }]}>{formatPct(m.winRate)}</Text>
          <Text style={[typo.small, { color: colors.textTertiary }]}>
            {m.wonTrades}승 {m.lostTrades}패 · 총 {m.totalTrades}거래
          </Text>
        </View>
      </View>

      {/* E-1: 수수료 반영 기준 고지 — 단타만 명시하던 순수익 기준을 공용 문구로 통일. */}
      <Text style={[typo.small, { color: colors.textTertiary, marginTop: spacing.sm }]}>
        {FEE_BASIS_NOTICE}
      </Text>
    </Surface>
  );
}

interface MetricItem {
  label: string;
  value: string;
  tone?: string;
}

/** ③ 핵심지표 카드 — 승률·profitFactor·MDD·Sharpe·총거래·평균보유(2열 그리드). */
function CoreMetricsCard({ metrics }: { metrics: BacktestMetrics }) {
  const { colors, typography: typo } = useTheme();
  const items: MetricItem[] = [
    { label: '승률', value: formatPct(metrics.winRate) },
    // UXR-14 B-1: 내부 용어 원어 노출 금지 — 홈(DAR-446 '위험 대비 수익') 정본 어휘에
    // '최대낙폭(MDD)'과 동일한 한국어 우선·원어 병기 패턴으로 통일.
    { label: '손익비(Profit Factor)', value: formatNumber(metrics.profitFactor) },
    { label: '최대낙폭(MDD)', value: formatPct(metrics.mdd), tone: colors.error },
    { label: '위험 대비 수익(Sharpe)', value: formatNumber(metrics.sharpe) },
    { label: '총 거래', value: `${metrics.totalTrades}건` },
    { label: '평균 보유', value: `${formatNumber(metrics.avgHoldDays, 1)}일` },
    {
      label: '평균 수익(승)',
      value: formatReturnPct(metrics.avgWin, { digits: 2 }),
      tone: colors.success,
    },
    {
      label: '평균 손실(패)',
      value: formatReturnPct(metrics.avgLoss, { digits: 2 }),
      tone: colors.error,
    },
  ];

  return (
    <Surface
      elevation={1}
      style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}
    >
      <Text style={[typo.captionMedium, { color: colors.text, marginBottom: spacing.sm }]}>
        핵심 지표
      </Text>
      <View style={styles.metricGrid}>
        {items.map((it) => (
          <View key={it.label} style={styles.metricCell}>
            <Text style={[typo.small, { color: colors.textSecondary }]}>{it.label}</Text>
            <Text style={[typo.h3, { color: it.tone ?? colors.text }]}>{it.value}</Text>
          </View>
        ))}
      </View>
    </Surface>
  );
}

/** ④ 이벤트유형별 성과 — 어떤 공시유형이 먹혔는지(거래수·승률·평균수익). */
function EventTypeBreakdownCard({
  byEventType,
}: {
  byEventType: Record<string, BacktestGroupMetrics>;
}) {
  const { colors, typography: typo } = useTheme();
  // 거래수 많은 순 → 표본 두꺼운 유형이 위로. 동률은 평균수익 높은 순.
  const rows = useMemo(
    () =>
      Object.entries(byEventType)
        .map(([eventType, g]) => ({ eventType, ...g }))
        .sort((a, b) => b.trades - a.trades || b.avgReturn - a.avgReturn),
    [byEventType],
  );

  return (
    <Surface
      elevation={1}
      style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}
    >
      <Text style={[typo.captionMedium, { color: colors.text, marginBottom: spacing.xs }]}>
        이벤트유형별 성과
      </Text>
      <Text style={[typo.small, { color: colors.textTertiary, marginBottom: spacing.sm }]}>
        어떤 공시유형이 먹혔는지 — 거래수·승률·평균수익
      </Text>

      {rows.length === 0 ? (
        <Text style={[typo.caption, { color: colors.textSecondary }]}>
          청산 완료된 거래가 아직 없어요.
        </Text>
      ) : (
        <View style={styles.breakdownList}>
          {/* 헤더 행 */}
          <View style={styles.breakdownRow}>
            <Text style={[typo.small, styles.colType, { color: colors.textTertiary }]}>유형</Text>
            <Text style={[typo.small, styles.colNum, { color: colors.textTertiary }]}>거래</Text>
            <Text style={[typo.small, styles.colNum, { color: colors.textTertiary }]}>승률</Text>
            <Text style={[typo.small, styles.colNum, { color: colors.textTertiary }]}>
              평균수익
            </Text>
          </View>
          {rows.map((r) => (
            <View
              key={r.eventType}
              style={[styles.breakdownRow, { borderTopColor: colors.border, borderTopWidth: 1 }]}
              accessibilityLabel={`${getEventTypeLabel(r.eventType)} ${r.trades}거래, 승률 ${formatPct(
                r.winRate,
              )}, 평균수익 ${formatReturnPct(r.avgReturn, { digits: 2 })}`}
            >
              <Text
                style={[typo.caption, styles.colType, { color: colors.text, minWidth: 0 }]}
                numberOfLines={1}
                ellipsizeMode="tail"
              >
                {getEventTypeLabel(r.eventType)}
              </Text>
              <Text style={[typo.caption, styles.colNum, { color: colors.textSecondary }]}>
                {r.trades}
              </Text>
              <Text style={[typo.caption, styles.colNum, { color: colors.textSecondary }]}>
                {formatPct(r.winRate, 0)}
              </Text>
              <Text
                style={[
                  typo.captionMedium,
                  styles.colNum,
                  { color: pnlColor(r.avgReturn, colors) },
                ]}
              >
                {formatReturnPct(r.avgReturn, { digits: 2 })}
              </Text>
            </View>
          ))}
        </View>
      )}
    </Surface>
  );
}

function BacktestTrackRecordScreen() {
  const { colors, typography: typo } = useTheme();
  const query = useBacktestTrackRecord();
  const record = query.data;

  // C8: 수동 새로고침 어포던스 — 트랙레코드는 폴링하지 않으므로 사용자가 당겨서 최신 리플레이를 받는다(DAR-472 공통 훅).
  const { refreshing, onRefresh } = useManualRefresh(query.refetch);

  // 자산곡선 → EquityCurveChart 계약(snapshotDate/totalValue/returnPct)으로 매핑.
  const equityPoints: EquityCurvePoint[] = useMemo(
    () =>
      (record?.equityCurve ?? []).map((p) => ({
        snapshotDate: compactDate(p.date),
        totalValue: p.equity,
        returnPct: p.returnPct,
      })),
    [record?.equityCurve],
  );

  return (
    <SafeAreaView
      style={[styles.container, { backgroundColor: colors.background }]}
      edges={['top']}
    >
      <ScreenHeader title="백테스트 트랙레코드" onBack={() => router.back()} />

      {query.isLoading ? (
        // C7: 드릴다운 로딩을 탭 섹션·포지션 상세와 동일한 스켈레톤(DAR-147 패턴)으로 통일 —
        // 콘텐츠 골격(헤더 요약·자산곡선·핵심 지표)을 미리 그려 로딩→콘텐츠 점프 제거.
        <DetailSkeleton cards={[{ lines: 2 }, { gauge: true, lines: 1 }, { lines: 4 }]} />
      ) : query.isError ? (
        <ApiErrorState
          error={query.error}
          onRetry={query.refetch}
          title="트랙레코드를 불러오지 못했습니다"
          description="잠시 후 다시 시도해 주세요."
        />
      ) : !record || !record.metrics ? (
        <EmptyState
          icon="bar-chart-2"
          title="아직 집계된 트랙레코드가 없어요"
          description="1년 리플레이 백테스트가 완료되면 이곳에 성과가 표시됩니다."
        />
      ) : (
        <ScrollView
          contentContainerStyle={styles.content}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor={colors.primary}
              colors={[colors.primary]}
            />
          }
        >
          {/* ② 정직 라벨 — 최상단. 미래정보 미사용 + 커버리지 점진 채움 고지. */}
          <View style={[styles.notice, { backgroundColor: colors.surfaceSecondary }]}>
            <Feather name="info" size={14} color={colors.info} />
            <Text style={[typo.small, { color: colors.info, marginLeft: spacing.xs, flex: 1 }]}>
              point-in-time 백테스트(미래정보 미사용) · 신호{' '}
              {record.totalSignals.toLocaleString('ko-KR')}건 기준. 공시 추출이 진행될수록
              커버리지가 채워집니다. 손실도 그대로 표시해요.
            </Text>
          </View>

          {/* ① 헤더 요약 */}
          <SummaryHeaderCard record={record} />

          {/* 자산곡선 */}
          <Surface
            elevation={1}
            style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}
          >
            <Text style={[typo.captionMedium, { color: colors.text, marginBottom: spacing.sm }]}>
              자산곡선
            </Text>
            {equityPoints.length > 0 ? (
              <EquityCurveChart points={equityPoints} initialCapital={record.initialCapital} />
            ) : (
              <Text style={[typo.caption, { color: colors.textSecondary }]}>
                청산 완료된 거래가 없어 자산곡선을 그릴 수 없어요.
              </Text>
            )}
          </Surface>

          {/* ③ 핵심 지표 */}
          <CoreMetricsCard metrics={record.metrics} />

          {/* ④ 이벤트유형별 성과 */}
          <EventTypeBreakdownCard byEventType={record.metrics.byEventType ?? {}} />

          <Text
            style={[
              typo.small,
              { color: colors.textTertiary, textAlign: 'center', marginTop: spacing.sm },
            ]}
          >
            {record.completedAt ? `리플레이 완료 ${dotDate(record.completedAt.slice(0, 10))}` : ''}{' '}
            · 실주문 없는 격리 백테스트 포트폴리오
          </Text>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

// DAR-549: 첫 게시(Play) 빌드에서 트레이딩 라우트 진입 시 홈으로 리다이렉트(가드).
export default withTradingGuard(BacktestTrackRecordScreen);

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { padding: spacing.lg, gap: spacing.md },
  notice: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: radius.md,
    paddingHorizontal: spacing.base,
    paddingVertical: spacing.sm,
  },
  card: {
    borderRadius: radius.lg,
    borderWidth: 1,
    padding: spacing.base,
  },
  // CONF-02: DataLimitBadge 와 동일 마크업 톤(아이콘+평문 칩).
  verifyBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs / 2,
    borderRadius: radius.sm,
    borderWidth: 1,
    marginBottom: spacing.sm,
  },
  headlineRow: {
    flexDirection: 'row',
    marginTop: spacing.sm,
    gap: spacing.md,
  },
  headlineCol: {
    flex: 1,
    gap: 2,
  },
  metricGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  metricCell: {
    width: '50%',
    paddingVertical: spacing.sm,
    gap: 2,
  },
  breakdownList: {
    gap: 0,
  },
  breakdownRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.sm,
  },
  colType: {
    flex: 1,
  },
  colNum: {
    width: 64,
    textAlign: 'right',
  },
});
