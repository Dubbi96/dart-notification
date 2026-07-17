import React, { useCallback, useMemo } from 'react';
import { View, Text, FlatList, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Surface } from 'react-native-paper';
import { Feather } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { useTheme, MAX_CHIP_FONT_SCALE } from '@theme';
import { spacing, radius } from '@theme/spacing';
import { ScreenHeader } from '@components/common/ScreenHeader';
import { ApiErrorState, EmptyState } from '@components/common/StateView';
import { SkeletonList } from '@components/common/SkeletonCard';
import { useStrategyTradeHistory } from '@hooks/useStrategyTradeHistory';
import { pnlColor } from '@utils/signalDisplay';
import { formatReturnPct } from '@utils/numberFormat';
import { getEventTypeLabel } from '@utils/disclosureType';

import type {
  StrategyExitReason,
  StrategyKey,
  StrategyTrade,
  StrategyTradeHistory,
} from '@app-types/strategy-comparison.types';

// 전략 드릴다운 — 과거 매수/매도 타임라인 — DAR-405 (BE: DAR-404).
// '과거에 이 논리(진입/청산/사이징 룰)로 이렇게 사고팔았다'를 한 줄씩 가독한다.
// 정직 원칙: 손실도 그대로 색조 표기(체리피킹 아님)·실주문 없는 격리 백테스트 명시.
// 테마 토큰만(하드코딩 색상 0)·44pt·accessibilityLabel.

const VALID_KEYS: readonly StrategyKey[] = [
  'event-edge',
  'short-momentum',
  'conservative-value',
  'aggressive-diversified',
];

function isStrategyKey(value: string | undefined): value is StrategyKey {
  return !!value && (VALID_KEYS as readonly string[]).includes(value);
}

/** 청산 사유 한글 라벨 — BE ExitReasonType 9종 1:1. OPEN(null)은 '보유 중'. */
const EXIT_REASON_LABEL: Record<StrategyExitReason, string> = {
  TAKE_PROFIT: '익절',
  STOP_LOSS: '손절',
  TRAILING_STOP: '트레일링 스탑',
  THESIS_BREAK: '논리 훼손',
  MAX_HOLD_DAYS: '보유기간 만료',
  CHART_BREAK: '차트 이탈',
  LIQUIDITY_EXIT: '유동성 청산',
  FORCE_EXIT: '강제 청산',
  DELISTED: '상폐 감액', // DAR-486
};

function exitReasonLabel(reason: StrategyExitReason | null): string {
  return reason ? EXIT_REASON_LABEL[reason] : '보유 중';
}

/** YYYY-MM-DD → YYYY.MM.DD. */
function dotDate(isoDate: string | null): string {
  return isoDate ? isoDate.replace(/-/g, '.') : '—';
}

/** 가격(원) — null 은 '—'. */
function priceText(value: number | null): string {
  return value === null ? '—' : `${value.toLocaleString('ko-KR')}원`;
}

/** ① 전략 요약(룰) 헤더 카드. */
function StrategyRuleHeader({ history }: { history: StrategyTradeHistory }) {
  const { colors, typography: typo } = useTheme();
  return (
    <Surface
      elevation={1}
      style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}
    >
      <Text style={[typo.h3, { color: colors.text }]}>{history.label}</Text>
      <Text style={[typo.small, { color: colors.textTertiary, marginTop: spacing.xs }]}>
        {history.tagline}
      </Text>
      <View style={[styles.ruleRow, { marginTop: spacing.sm }]}>
        <Feather name="log-in" size={14} color={colors.textSecondary} />
        <Text style={[typo.small, { color: colors.textSecondary, flex: 1 }]}>
          진입 룰 · <Text style={{ color: colors.text }}>{history.rules.entry}</Text>
        </Text>
      </View>
      <View style={styles.ruleRow}>
        <Feather name="log-out" size={14} color={colors.textSecondary} />
        <Text style={[typo.small, { color: colors.textSecondary, flex: 1 }]}>
          청산 룰 · <Text style={{ color: colors.text }}>{history.rules.exit}</Text>
        </Text>
      </View>
    </Surface>
  );
}

/** ② 타임라인 1행 — 일자·종목·매수가/매도가·수익률 색조·청산사유·보유일. */
function TradeRow({ trade }: { trade: StrategyTrade }) {
  const { colors, typography: typo } = useTheme();
  const isOpen = trade.status === 'OPEN';
  const returnTone = isOpen ? colors.textSecondary : pnlColor(trade.returnPct ?? 0, colors);
  const returnText = isOpen ? '보유 중' : formatReturnPct(trade.returnPct, { digits: 2 });

  return (
    <Surface
      elevation={1}
      style={[styles.tradeCard, { backgroundColor: colors.surface, borderColor: colors.border }]}
    >
      {/* 상단: 종목명 + 수익률(색조) */}
      <View style={styles.tradeTopRow}>
        <View style={styles.tradeTitleCol}>
          <Text
            style={[typo.bodyMedium, { color: colors.text, minWidth: 0 }]}
            numberOfLines={1}
            ellipsizeMode="tail"
          >
            {trade.stockName}
          </Text>
          <Text
            style={[typo.small, { color: colors.textTertiary, minWidth: 0 }]}
            numberOfLines={1}
            ellipsizeMode="tail"
          >
            {getEventTypeLabel(trade.eventType)}
          </Text>
        </View>
        <Text
          style={[typo.bodyMedium, { color: returnTone }]}
          accessibilityLabel={`수익률 ${returnText}`}
        >
          {returnText}
        </Text>
      </View>

      {/* 중단: 매수 → 매도 가격/일자 */}
      <View style={styles.tradeFlowRow}>
        <View style={styles.tradeFlowCol}>
          <Text style={[typo.small, { color: colors.textSecondary }]}>매수</Text>
          <Text style={[typo.captionMedium, { color: colors.text }]}>
            {priceText(trade.entryPrice)}
          </Text>
          <Text style={[typo.small, { color: colors.textTertiary }]}>
            {dotDate(trade.entryDate)}
          </Text>
        </View>
        <Feather name="arrow-right" size={16} color={colors.textTertiary} />
        <View style={styles.tradeFlowCol}>
          <Text style={[typo.small, { color: colors.textSecondary }]}>매도</Text>
          <Text style={[typo.captionMedium, { color: colors.text }]}>
            {priceText(trade.exitPrice)}
          </Text>
          <Text style={[typo.small, { color: colors.textTertiary }]}>
            {dotDate(trade.exitDate)}
          </Text>
        </View>
      </View>

      {/* 하단: 청산사유 + 보유일 */}
      <View style={styles.tradeMetaRow}>
        <View style={[styles.tag, { backgroundColor: colors.surfaceSecondary }]}>
          <Text
            style={[typo.small, { color: colors.textSecondary }]}
            maxFontSizeMultiplier={MAX_CHIP_FONT_SCALE}
          >
            {exitReasonLabel(trade.exitReason)}
          </Text>
        </View>
        <Text style={[typo.small, { color: colors.textTertiary }]}>
          {trade.holdDays !== null ? `보유 ${trade.holdDays}일` : `보유 중`}
        </Text>
      </View>
    </Surface>
  );
}

export default function StrategyTradeTimelineScreen() {
  const { colors, typography: typo } = useTheme();
  const params = useLocalSearchParams<{ key: string }>();
  const key = isStrategyKey(params.key) ? params.key : undefined;
  const query = useStrategyTradeHistory(key);
  const history = query.data;

  const renderTrade = useCallback(
    ({ item }: { item: StrategyTrade }) => <TradeRow trade={item} />,
    [],
  );

  const headerTitle = history?.label ?? '전략 타임라인';

  // 잘못된 딥링크 — 유효하지 않은 전략 key.
  const invalidKey = !key;

  const listHeader = useMemo(
    () =>
      history ? (
        <View style={styles.listHeader}>
          {/* 정직 라벨 — 실주문 없는 격리 백테스트 + 손실도 그대로. */}
          <View style={[styles.notice, { backgroundColor: colors.surfaceSecondary }]}>
            <Feather name="info" size={14} color={colors.info} />
            <Text style={[typo.small, { color: colors.info, marginLeft: spacing.xs, flex: 1 }]}>
              과거 매수/매도 타임라인(point-in-time 백테스트) · 실제 주문이 아닙니다. 손실도 그대로
              표시해요.
            </Text>
          </View>
          <StrategyRuleHeader history={history} />
          <Text style={[typo.captionMedium, { color: colors.text, marginTop: spacing.xs }]}>
            매수/매도 타임라인 · {history.trades.length}건
          </Text>
        </View>
      ) : null,
    [history, colors, typo],
  );

  return (
    <SafeAreaView
      style={[styles.container, { backgroundColor: colors.background }]}
      edges={['top']}
    >
      <ScreenHeader title={headerTitle} onBack={() => router.back()} />

      {invalidKey ? (
        <EmptyState
          icon="alert-triangle"
          title="알 수 없는 전략이에요"
          description="전략 비교 화면에서 다시 선택해 주세요."
          actionLabel="전략 비교로"
          // C10: 라벨('전략 비교로')=동작 일치 — back()은 직전 화면 복귀라 푸시·딥링크 직진입
          // (콜드스타트)에선 약속한 목적지 보장이 없다. DAR-431 탭 파라미터로 명시 이동하고
          // replace 로 깨진 딥링크 화면의 back 스택 오염도 방지한다.
          onAction={() => router.replace('/(tabs)/portfolio?tab=strategy')}
        />
      ) : query.isLoading ? (
        // C7: 리스트형 드릴다운 로딩을 포트폴리오 탭 섹션과 동일한 스켈레톤으로 통일(점프 제거).
        <SkeletonList variant="buyScore" />
      ) : query.isError ? (
        <ApiErrorState
          error={query.error}
          onRetry={query.refetch}
          title="타임라인을 불러오지 못했습니다"
          description="잠시 후 다시 시도해 주세요."
        />
      ) : (
        <FlatList
          data={history?.trades ?? []}
          renderItem={renderTrade}
          keyExtractor={(item) => item.id}
          initialNumToRender={10}
          maxToRenderPerBatch={10}
          windowSize={9}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          refreshing={query.isRefetching}
          onRefresh={query.refetch}
          ListHeaderComponent={listHeader}
          ListEmptyComponent={
            <EmptyState
              icon="list"
              title="아직 거래 기록이 없어요"
              description="이 전략의 백테스트 트랙이 누적되면 매수/매도 타임라인이 표시됩니다."
            />
          }
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  listContent: { padding: spacing.lg, gap: spacing.md, flexGrow: 1 },
  listHeader: { gap: spacing.md, marginBottom: spacing.xs },
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
  ruleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    marginTop: spacing.xs,
  },
  tradeCard: {
    borderRadius: radius.lg,
    borderWidth: 1,
    padding: spacing.base,
    gap: spacing.sm,
  },
  tradeTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: spacing.sm,
  },
  tradeTitleCol: {
    flexShrink: 1,
    gap: 2,
  },
  tradeFlowRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  tradeFlowCol: {
    flex: 1,
    gap: 2,
  },
  tradeMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  tag: {
    borderRadius: radius.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
  },
});
