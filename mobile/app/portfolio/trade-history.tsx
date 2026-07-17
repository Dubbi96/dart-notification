import React, { useCallback, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { View, Text, FlatList, StyleSheet, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Surface, Banner } from 'react-native-paper';
import { Feather } from '@expo/vector-icons';
import { router } from 'expo-router';
import { withTradingGuard } from '@components/common/withTradingGuard';
import { useTheme } from '@theme';
import { useTheme, MAX_CHIP_FONT_SCALE } from '@theme';
import { spacing, radius, sizing } from '@theme/spacing';
import { ApiErrorState, EmptyState } from '@components/common/StateView';
import { SkeletonList } from '@components/common/SkeletonCard';
import { FEE_BASIS_NOTICE } from '@components/common/feeBasisCopy';
import { DataLimitBadge } from '@components/common/DataLimitBadge';
import { PriceChangeChip } from '@components/common/PriceChangeChip';
import { ScreenHeader } from '@components/common/ScreenHeader';
import { SignalAccuracySection } from '@components/portfolio/SignalAccuracySection';
import { CalibrationSection } from '@components/portfolio/CalibrationSection';
import { PerformanceSparkline } from '@components/portfolio/PerformanceSparkline';
import { useTradeHistory } from '@hooks/useTradeHistory';
import { useSimulationEquityCurve } from '@hooks/useSimulationStatus';
import { useSignalAccuracy } from '@hooks/useSignalAccuracy';
import { useCalibration } from '@hooks/useCalibration';
import { getEventTypeLabel } from '@utils/disclosureType';
import { formatReturnPct, formatWinRate, returnColor } from '@utils/numberFormat';
import { refreshKeysForReportTab } from '@utils/reportRefresh';

import type { ReportTab } from '@utils/reportRefresh';
import type { TradeRationale, TradeScorecard } from '@app-types/trade-rationale.types';

// 포트폴리오 성과 리포트(L3) — DAR-120.
// 한 화면 지표 난무를 위계+탭으로 해소: 진입 즉시엔 "지금 행동할 것"(요약 1행 + 가장
// 시급한 보정권고 1건 배너)만, 매매성적표·신호정밀도·보정권고 전체는 성과/신호정밀도/
// 보정권고 3탭으로 미룬다(progressive disclosure). 표본<30·미유의는 '데이터 한계' 배지로
// 정직 노출(과신방지). 테마토큰만(하드코딩 색상 0)·면책·접근성·빈/로딩/에러 처리.

// ReportTab(탭 키) 타입은 @utils/reportRefresh 단일 소스(탭별 refetch 매핑과 동일 출처).

// 신호 정밀도 '데이터 한계' 표본 임계 — 스펙 6장(표본<30 OR 미유의).
const DATA_LIMIT_SAMPLE = 30;

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
      <Text
        style={[typo.small, { color, fontWeight: '600' }]}
        maxFontSizeMultiplier={MAX_CHIP_FONT_SCALE}
      >
        {isOpen ? '보유 중' : '청산 완료'}
      </Text>
    </View>
  );
}

function Chip({ label }: { label: string }) {
  const { colors, typography: typo } = useTheme();
  return (
    <View
      style={[
        styles.chip,
        { backgroundColor: colors.surfaceSecondary, borderColor: colors.borderLight },
      ]}
    >
      <Text
        style={[typo.small, { color: colors.textSecondary, flexShrink: 1, minWidth: 0 }]}
        numberOfLines={1}
        ellipsizeMode="tail"
        maxFontSizeMultiplier={MAX_CHIP_FONT_SCALE}
      >
        {label}
      </Text>
    </View>
  );
}

/**
 * 신뢰지표 히어로 카드 — 진입 즉시 무스크롤 가독(DAR-360). 2행 위계로 가중치 차등화:
 *  1행=승률(대형 볼드 h1, 최고 신뢰지표 8승2패=80%)+누적수익률(h2 세컨더리, 손익색)
 *  2행=평균손익·평균보유(터셔리). 표본 부족 시 과신방지 '데이터 한계' 배지.
 * 기존 4지표 width:50% 균등 가중을 위계로 대체해 핵심 신뢰지표를 시각적으로 승격한다.
 */
function HeroScorecard({ scorecard }: { scorecard: TradeScorecard }) {
  const { colors, typography: typo } = useTheme();
  const winRateText = formatWinRate(scorecard.winRate, { fallback: '표본 부족' });
  const avgHoldText = scorecard.avgHoldDays === null ? '—' : `${scorecard.avgHoldDays}일`;
  const cumColor = returnColor(scorecard.cumulativeReturnPct, colors);

  return (
    <Surface
      elevation={1}
      style={[styles.hero, { backgroundColor: colors.surface, borderColor: colors.border }]}
    >
      <View style={styles.heroHeader}>
        <Text style={[typo.captionMedium, { color: colors.text }]}>매매 성적표</Text>
        {scorecard.lowSample ? (
          <View style={[styles.warnBadge, { backgroundColor: colors.surfaceSecondary }]}>
            <Feather name="alert-triangle" size={11} color={colors.warning} />
            <Text
              style={[
                typo.small,
                { color: colors.warning, marginLeft: spacing.xs, fontWeight: '600' },
              ]}
              maxFontSizeMultiplier={MAX_CHIP_FONT_SCALE}
            >
              데이터 한계 (표본 {scorecard.sampleSize})
            </Text>
          </View>
        ) : null}
      </View>

      {/* 1행: 승률(대형 볼드) + 누적수익률(세컨더리) — 최고 신뢰지표 우선 */}
      <View style={styles.heroPrimaryRow}>
        <View
          style={styles.heroPrimaryItem}
          accessibilityRole="text"
          accessibilityLabel={`승률 ${winRateText}, ${scorecard.winCount}승 ${scorecard.lossCount}패`}
        >
          <Text style={[typo.small, { color: colors.textSecondary }]}>승률</Text>
          <Text style={[typo.h1, { color: colors.text }]}>{winRateText}</Text>
          <Text style={[typo.small, { color: colors.textTertiary }]}>
            {scorecard.winCount}승 {scorecard.lossCount}패
          </Text>
        </View>
        <View style={[styles.heroDivider, { backgroundColor: colors.borderLight }]} />
        <View
          style={styles.heroPrimaryItem}
          accessibilityRole="text"
          accessibilityLabel={`누적 수익률 ${formatReturnPct(scorecard.cumulativeReturnPct)}`}
        >
          <Text style={[typo.small, { color: colors.textSecondary }]}>누적 수익률</Text>
          <Text style={[typo.h2, { color: cumColor }]}>
            {formatReturnPct(scorecard.cumulativeReturnPct)}
          </Text>
          <Text style={[typo.small, { color: colors.textTertiary }]}>
            실현 기준 · 청산 손익만 반영
          </Text>
        </View>
      </View>

      {/* 2행: 평균손익 + 평균보유 (터셔리 보조지표) */}
      <View style={[styles.heroSecondaryRow, { borderTopColor: colors.borderLight }]}>
        <Metric label="평균 손익" value={formatPnl(scorecard.avgPnl)} />
        <Metric label="평균 보유" value={avgHoldText} />
      </View>

      {/* E-1: 수수료 반영 기준 고지 — 단타만 명시하던 순수익 기준을 공용 문구로 통일. */}
      <Text style={[typo.small, { color: colors.textTertiary }]}>{FEE_BASIS_NOTICE}</Text>
    </Surface>
  );
}

/** 추이 보조맥락(세컨더리) — 기간 수익률 스파크라인. 히어로 카드 아래 보조로. */
function SummaryRow({ returnSeries, onPress }: { returnSeries: number[]; onPress: () => void }) {
  const { colors, typography: typo } = useTheme();
  const hasTrend = returnSeries.length >= 2;

  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.7}
      accessibilityRole="button"
      accessibilityLabel="수익률 추이. 성과 탭에서 매매 내역 전체 보기"
    >
      <Surface
        elevation={1}
        style={[styles.summaryRow, { backgroundColor: colors.surface, borderColor: colors.border }]}
      >
        <View style={styles.summaryLeft}>
          <Text style={[typo.small, { color: colors.textSecondary }]}>수익률 추이</Text>
        </View>
        <View style={styles.summaryTrend}>
          {hasTrend ? (
            <PerformanceSparkline values={returnSeries} />
          ) : (
            <Text style={[typo.small, { color: colors.textTertiary }]}>추이 데이터 대기</Text>
          )}
        </View>
        <Feather name="chevron-right" size={sizing.icon.md} color={colors.textTertiary} />
      </Surface>
    </TouchableOpacity>
  );
}

/** 가장 시급한 보정권고 1건만 L1 배너로. 나머지는 '보정 권고' 탭. 탭하면 보정 탭으로 이동. */
function UrgentCalibrationBanner({ onPress }: { onPress: () => void }) {
  const { colors, typography: typo } = useTheme();
  const query = useCalibration();
  const data = query.data;

  // 시급도 = CALIBRATE 상태 중 |권장 조정량| 최대(D+20 기준). 없으면 배너 미노출(정직).
  const top = useMemo(() => {
    if (!data) return null;
    const candidates = data.eventScoreCalibrationsD20.filter(
      (e) => e.status === 'CALIBRATE' && !e.lowSample,
    );
    if (candidates.length === 0) return null;
    return candidates.reduce((a, b) =>
      Math.abs(b.suggestedDelta) > Math.abs(a.suggestedDelta) ? b : a,
    );
  }, [data]);

  if (!top) return null;

  const label = getEventTypeLabel(top.eventType);
  const deltaText = `${top.suggestedDelta >= 0 ? '+' : ''}${top.suggestedDelta}`;

  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.7}
      accessibilityRole="button"
      accessibilityLabel={`가장 시급한 보정 권고: ${label} 기준점수 ${deltaText} 조정 검토. 보정 권고 탭에서 전체 보기. 자동 반영 없음.`}
    >
      <Surface
        elevation={1}
        style={[
          styles.urgentBanner,
          { backgroundColor: colors.surfaceSecondary, borderColor: colors.warning },
        ]}
      >
        <Feather name="alert-circle" size={sizing.icon.sm} color={colors.warning} />
        <View style={styles.urgentBody}>
          <Text style={[typo.small, { color: colors.textSecondary }]}>
            가장 시급한 보정 권고 · 사람 검토용
          </Text>
          <Text style={[typo.caption, { color: colors.text, marginTop: 2 }]} numberOfLines={2}>
            {label} 기준점수 {deltaText} 조정 검토 (자동 반영 없음)
          </Text>
        </View>
        <Feather name="chevron-right" size={sizing.icon.sm} color={colors.textTertiary} />
      </Surface>
    </TouchableOpacity>
  );
}

/**
 * 신호 정밀도 '데이터 한계' 배지 — 표본<30 또는 통계 미유의 시(스펙 6장, 과신방지).
 * DAR-461 C11: 노출 판정(데이터 의존)만 여기서 하고, 시각 표현은 공통 DataLimitBadge로
 * 일원화(동일 이름 중복 컴포넌트 제거). 표본 부족이면 표본수를 함께 노출하고, 통계 미유의만
 * 이면 사유 없이 '데이터 한계'(공통 컴포넌트 a11y가 '표본 부족 또는 통계 미유의'를 포괄).
 */
function PrecisionDataLimitBadge() {
  const query = useSignalAccuracy();
  const data = query.data;
  if (!data) return null;

  const d20 = data.overall.d20;
  const sampleLimited = d20.sampleCount < DATA_LIMIT_SAMPLE;
  const limited = sampleLimited || !d20.isSignificant;
  if (!limited) return null;

  return <DataLimitBadge sampleCount={sampleLimited ? d20.sampleCount : undefined} />;
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
    <View
      style={styles.metric}
      accessibilityRole="text"
      accessibilityLabel={`${label} ${value}${sub ? ` ${sub}` : ''}`}
    >
      <Text style={[typo.small, { color: colors.textSecondary }]}>{label}</Text>
      <Text
        style={[typo.captionMedium, { color: valueColor ?? colors.text, marginTop: spacing.xs }]}
      >
        {value}
      </Text>
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
            <Text
              style={[typo.bodyMedium, { color: colors.text, flexShrink: 1, minWidth: 0 }]}
              numberOfLines={1}
              ellipsizeMode="tail"
            >
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
        <PriceChangeChip value={item.pnlPct} amount={item.pnl} context="pnl" />
      </View>

      {/* 진입 사유 */}
      <View style={[styles.section, { borderTopColor: colors.borderLight }]}>
        <Text style={[typo.small, { color: colors.textSecondary, marginBottom: spacing.xs }]}>
          진입 사유
        </Text>
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
          <Text style={[typo.small, { color: colors.textSecondary, marginBottom: spacing.xs }]}>
            청산 사유
          </Text>
          <Text style={[typo.caption, { color: colors.text }]}>
            {item.exitAction ? (ACTION_LABEL[item.exitAction] ?? item.exitAction) : '청산 완료'}
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

/**
 * L3 탭 바 — 성과 / 신호 정밀도 / 보정 권고. 3탭 유지(2탭 통합은 ReportTab 타입·refetch
 * 매핑이 @utils/reportRefresh에 있어 파일 스코프를 벗어남 → 택1: 긴급 액션 프리뷰 배지).
 * badges[탭]>0 일 때만 해당 탭에 긴급 건수 배지를 붙인다(있을 때만, 정직 노출).
 */
function TabBar({
  active,
  onChange,
  badges,
}: {
  active: ReportTab;
  onChange: (t: ReportTab) => void;
  badges?: Partial<Record<ReportTab, number>>;
}) {
  const { colors, typography: typo } = useTheme();
  const tabs: { key: ReportTab; label: string }[] = [
    { key: 'performance', label: '성과' },
    { key: 'precision', label: '신호 정밀도' },
    { key: 'calibration', label: '보정 권고' },
  ];
  return (
    <View style={[styles.tabBar, { backgroundColor: colors.surfaceSecondary }]}>
      {tabs.map((t) => {
        const selected = active === t.key;
        const badge = badges?.[t.key] ?? 0;
        return (
          <TouchableOpacity
            key={t.key}
            onPress={() => onChange(t.key)}
            style={[styles.tab, selected ? { backgroundColor: colors.surface } : null]}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            accessibilityLabel={`${t.label} 탭${badge > 0 ? `, 긴급 ${badge}건` : ''}`}
          >
            <View style={styles.tabContent}>
              <Text
                style={[
                  typo.small,
                  {
                    color: selected ? colors.text : colors.textSecondary,
                    fontWeight: selected ? '600' : '400',
                    flexShrink: 1,
                    minWidth: 0,
                  },
                ]}
                numberOfLines={1}
                ellipsizeMode="tail"
              >
                {t.label}
              </Text>
              {badge > 0 ? (
                // DAR-461 C3: 흰 텍스트를 warning(노랑) 위에 쓰면 대비 ~1.7:1로 긴급 건수가
                // 안 보임 → 솔리드 error 배경 + onColor(흰) 텍스트(PortfolioRiskBadge 경보와
                // 동일한 정본 onColor 패턴)로 대비를 끌어올린다.
                <View style={[styles.tabBadge, { backgroundColor: colors.error }]}>
                  <Text
                    style={[typo.small, { color: colors.onColor, fontWeight: '700' }]}
                    maxFontSizeMultiplier={MAX_CHIP_FONT_SCALE}
                  >
                    {badge}
                  </Text>
                </View>
              ) : null}
            </View>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

function TradeHistoryScreen() {
  const { colors, typography: typo } = useTheme();
  const queryClient = useQueryClient();
  const query = useTradeHistory();
  const equityQuery = useSimulationEquityCurve();
  const calibrationQuery = useCalibration();
  const [activeTab, setActiveTab] = useState<ReportTab>('performance');
  const [isRefreshing, setIsRefreshing] = useState(false);

  // 당겨 새로고침: 활성 탭이 실제로 그리는 쿼리들을 함께 refetch(DAR-210).
  // 정밀도·보정 탭은 독립 useQuery라 trade-history.refetch 만으로는 stale → 탭별 키 매핑으로 일괄 갱신.
  const handleRefresh = useCallback(async () => {
    setIsRefreshing(true);
    try {
      await Promise.all(
        refreshKeysForReportTab(activeTab).map((queryKey) =>
          queryClient.refetchQueries({ queryKey, exact: true }),
        ),
      );
    } finally {
      setIsRefreshing(false);
    }
  }, [activeTab, queryClient]);

  const renderTrade = useCallback(
    ({ item }: { item: TradeRationale }) => <TradeCard item={item} />,
    [],
  );

  const data = query.data;
  const returnSeries = useMemo(
    () => (equityQuery.data?.points ?? []).map((p) => p.returnPct),
    [equityQuery.data],
  );

  // 보정 권고 탭 긴급 액션 프리뷰 배지 건수 — CALIBRATE 상태(표본 충분)만(있을 때만 노출).
  // UrgentCalibrationBanner와 동일 쿼리(['calibration'])를 공유하므로 추가 네트워크 없음.
  const urgentCalibrationCount = useMemo(() => {
    const cal = calibrationQuery.data;
    if (!cal) return 0;
    return cal.eventScoreCalibrationsD20.filter((e) => e.status === 'CALIBRATE' && !e.lowSample)
      .length;
  }, [calibrationQuery.data]);

  // 탭별 FlatList data — 성과 탭만 매매내역 리스트, 나머지는 헤더 섹션만.
  const listData = activeTab === 'performance' ? (data?.trades ?? []) : [];

  const header = (
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

      {/* 신뢰지표 승격(DAR-360): 진입 즉시 승률+누적수익률 히어로 → 추이 보조 → 시급 보정 */}
      {data ? <HeroScorecard scorecard={data.scorecard} /> : null}
      <SummaryRow returnSeries={returnSeries} onPress={() => setActiveTab('performance')} />
      <UrgentCalibrationBanner onPress={() => setActiveTab('calibration')} />

      <TabBar
        active={activeTab}
        onChange={setActiveTab}
        badges={{ calibration: urgentCalibrationCount }}
      />

      {/* 탭 본문 상단(헤더에 실어 단일 FlatList 유지 — 중첩 가상리스트 경고 회피) */}
      {activeTab === 'performance' ? (
        <View style={styles.tabBody}>
          <Text style={[typo.captionMedium, { color: colors.text, marginTop: spacing.sm }]}>
            매매 내역
          </Text>
        </View>
      ) : activeTab === 'precision' ? (
        <View style={styles.tabBody}>
          <PrecisionDataLimitBadge />
          <SignalAccuracySection />
        </View>
      ) : (
        <View style={styles.tabBody}>
          <CalibrationSection />
        </View>
      )}
    </View>
  );

  return (
    <SafeAreaView
      style={[styles.container, { backgroundColor: colors.background }]}
      edges={['top']}
    >
      <ScreenHeader title="성과 리포트" onBack={() => router.back()} />

      {query.isLoading ? (
        // C7: 리스트형 드릴다운 로딩을 포트폴리오 탭 섹션과 동일한 스켈레톤으로 통일(점프 제거).
        <SkeletonList variant="buyScore" />
      ) : query.isError ? (
        <ApiErrorState
          error={query.error}
          onRetry={query.refetch}
          title="매매 기록을 불러오지 못했습니다"
          description="잠시 후 다시 시도해 주세요."
        />
      ) : (
        <FlatList
          data={listData}
          renderItem={renderTrade}
          keyExtractor={(item) => item.positionId}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          refreshing={isRefreshing}
          onRefresh={handleRefresh}
          ListHeaderComponent={header}
          ListEmptyComponent={
            activeTab === 'performance' ? (
              <EmptyState
                icon="clipboard"
                title="아직 매매 기록이 없습니다"
                description="모의운용에서 매수가 발생하면 진입/청산 근거가 여기에 기록됩니다."
              />
            ) : null
          }
        />
      )}
    </SafeAreaView>
  );
}

// DAR-549: 첫 게시(Play) 빌드에서 트레이딩 라우트 진입 시 홈으로 리다이렉트(가드).
export default withTradingGuard(TradeHistoryScreen);

const styles = StyleSheet.create({
  container: { flex: 1 },
  listContent: { padding: spacing.lg, gap: spacing.md, flexGrow: 1 },
  headerBox: { gap: spacing.md },
  banner: { borderRadius: radius.md },
  summaryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    borderRadius: radius.lg,
    borderWidth: 1,
    padding: spacing.base,
  },
  summaryLeft: { minWidth: 96 },
  summaryTrend: { flex: 1, height: 36, justifyContent: 'center' },
  urgentBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    borderRadius: radius.md,
    borderWidth: 1,
    paddingHorizontal: spacing.base,
    paddingVertical: spacing.sm,
  },
  urgentBody: { flex: 1 },
  tabBar: {
    flexDirection: 'row',
    borderRadius: radius.md,
    padding: 3,
  },
  tab: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    // UXR-14 C-4: typo.small(16)+padding(8×2)≈32pt로 44pt 미달 — 유효 터치영역 보장.
    minHeight: sizing.minTouchTarget,
    paddingVertical: spacing.sm,
    borderRadius: radius.sm,
  },
  tabContent: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
  },
  tabBadge: {
    minWidth: 16,
    minHeight: 16,
    borderRadius: radius.full,
    paddingHorizontal: spacing.xs,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tabBody: { gap: spacing.md },
  hero: { borderRadius: radius.lg, borderWidth: 1, padding: spacing.base, gap: spacing.md },
  heroHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  heroPrimaryRow: { flexDirection: 'row', alignItems: 'stretch' },
  heroPrimaryItem: { flex: 1, gap: spacing.xs },
  heroDivider: { width: 1, marginHorizontal: spacing.base },
  heroSecondaryRow: { flexDirection: 'row', borderTopWidth: 1, paddingTop: spacing.md },
  warnBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: radius.full,
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
