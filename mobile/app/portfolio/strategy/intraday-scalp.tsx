import React, { useCallback, useMemo } from 'react';
import { View, Text, FlatList, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Surface } from 'react-native-paper';
import { Feather } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useTheme } from '@theme';
import { spacing, radius } from '@theme/spacing';
import { ScreenHeader } from '@components/common/ScreenHeader';
import { LoadingState, ApiErrorState, EmptyState } from '@components/common/StateView';
import { useIntradayScalpTrades } from '@hooks/useIntradayScalpTrades';
import { formatReturnPct } from '@utils/numberFormat';

import type { ScalpExitReason, ScalpTrade } from '@app-types/intraday-scalp.types';

// 분봉 단타 드릴다운 — 오늘 거래 타임라인 — DAR-416 (BE: DAR-411).
// '오늘 이 분봉 신호(거래량 폭발+돌파+VWAP)로 이렇게 진입/청산했다'를 종목별 한 줄로 가독한다.
// 정직 원칙: 손익도 그대로 색조 표기(익절녹·손절적·EOD회색)·실주문 없는 모의 명시.
// 테마 토큰만(하드코딩 색상 0)·44pt·accessibilityLabel.

/** 청산 사유 한글 라벨 — BE ScalpExitReason 3종 1:1. OPEN(null)은 '보유 중'. */
const EXIT_REASON_LABEL: Record<ScalpExitReason, string> = {
  TAKE_PROFIT: '익절',
  STOP_LOSS: '손절',
  FORCE_CLOSE_EOD: '장마감 청산',
};

function exitReasonLabel(reason: ScalpExitReason | null): string {
  return reason ? EXIT_REASON_LABEL[reason] : '보유 중';
}

/** ISO 8601 → KST HH:MM(장중 시각). 파싱 실패 시 '—'. */
function hhmmKst(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleTimeString('ko-KR', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'Asia/Seoul',
  });
}

/** YYYYMMDD → M/D. */
function shortDate(yyyymmdd: string): string {
  if (yyyymmdd.length !== 8) return yyyymmdd;
  return `${Number(yyyymmdd.slice(4, 6))}/${Number(yyyymmdd.slice(6, 8))}`;
}

/** 가격(원) — null 은 '—'. */
function priceText(value: number | null): string {
  return value === null ? '—' : `${value.toLocaleString('ko-KR')}원`;
}

/** 원(KRW) 정수 표기 — null 은 '—'. */
function wonText(value: number | null): string {
  return value === null ? '—' : `${Math.round(value).toLocaleString('ko-KR')}원`;
}

/** gross 수익률(%) 표기 — null 은 '—'. */
function grossPctText(value: number | null): string {
  if (value === null) return '—';
  const sign = value > 0 ? '+' : '';
  return `${sign}${value.toFixed(2)}%`;
}

/**
 * 청산 사유별 색조 — 익절(success)·손절(error)·장마감(중립)·보유중(중립).
 * 색 단독 의미 금지 원칙은 라벨(평문)+태그로 병행하므로, 여기선 수익률 텍스트 색조로만 사용.
 */
function returnTone(
  trade: ScalpTrade,
  colors: ReturnType<typeof useTheme>['colors'],
): string {
  if (trade.status === 'OPEN') return colors.textSecondary;
  if (trade.exitReason === 'TAKE_PROFIT') return colors.success;
  if (trade.exitReason === 'STOP_LOSS') return colors.error;
  // FORCE_CLOSE_EOD — 손익에 따라 중립적으로(부호 그대로) 표기.
  if (trade.returnPct != null && trade.returnPct > 0) return colors.success;
  if (trade.returnPct != null && trade.returnPct < 0) return colors.error;
  return colors.textSecondary;
}

/** 타임라인 1행 — 종목·진입/청산 시각·사유·수익률 색조. */
function TradeRow({ trade }: { trade: ScalpTrade }) {
  const { colors, typography: typo } = useTheme();
  const isOpen = trade.status === 'OPEN';
  const tone = returnTone(trade, colors);
  // ★DAR-418 메인 수익률 = 순수익(수수료 후) net.
  const returnText = isOpen ? '보유 중' : formatReturnPct(trade.netReturnPct ?? trade.returnPct, { digits: 2 });

  return (
    <Surface
      elevation={1}
      style={[styles.tradeCard, { backgroundColor: colors.surface, borderColor: colors.border }]}
    >
      {/* 상단: 종목명 + 수익률(색조) */}
      <View style={styles.tradeTopRow}>
        <View style={styles.tradeTitleCol}>
          <Text style={[typo.bodyMedium, { color: colors.text }]} numberOfLines={1}>
            {trade.corpName}
          </Text>
          <Text style={[typo.small, { color: colors.textTertiary }]} numberOfLines={1}>
            {trade.stockCode} · {shortDate(trade.tradeDate)}
          </Text>
        </View>
        <View style={styles.returnCol}>
          <Text style={[typo.bodyMedium, { color: tone }]} accessibilityLabel={`순수익률 ${returnText}`}>
            {returnText}
          </Text>
          {!isOpen ? (
            <Text style={[typo.small, { color: colors.textTertiary }]}>순(수수료 후)</Text>
          ) : null}
        </View>
      </View>

      {/* 중단: 진입 → 청산 시각/가격 */}
      <View style={styles.tradeFlowRow}>
        <View style={styles.tradeFlowCol}>
          <Text style={[typo.small, { color: colors.textSecondary }]}>진입</Text>
          <Text style={[typo.captionMedium, { color: colors.text }]}>{priceText(trade.entryPrice)}</Text>
          <Text style={[typo.small, { color: colors.textTertiary }]}>{hhmmKst(trade.entryTs)}</Text>
        </View>
        <Feather name="arrow-right" size={16} color={colors.textTertiary} />
        <View style={styles.tradeFlowCol}>
          <Text style={[typo.small, { color: colors.textSecondary }]}>청산</Text>
          <Text style={[typo.captionMedium, { color: colors.text }]}>{priceText(trade.exitPrice)}</Text>
          <Text style={[typo.small, { color: colors.textTertiary }]}>{hhmmKst(trade.exitTs)}</Text>
        </View>
      </View>

      {/* 하단: 진입사유 + 청산사유 태그 */}
      <View style={styles.tradeMetaRow}>
        <View style={[styles.tag, { backgroundColor: colors.surfaceSecondary }]}>
          <Feather name="log-in" size={12} color={colors.textSecondary} />
          <Text style={[typo.small, { color: colors.textSecondary }]}>{trade.entryReason}</Text>
        </View>
        <View style={[styles.tag, { backgroundColor: colors.surfaceSecondary }]}>
          <Feather name="log-out" size={12} color={colors.textSecondary} />
          <Text style={[typo.small, { color: colors.textSecondary }]}>{exitReasonLabel(trade.exitReason)}</Text>
        </View>
      </View>

      {/* ★DAR-418 비용 투명화 — gross(비용 전) 대비 net·총수수료(CLOSED 만). */}
      {!isOpen ? (
        <View style={[styles.feeRow, { borderTopColor: colors.borderLight }]}>
          <Text style={[typo.small, { color: colors.textTertiary }]}>
            세전 {grossPctText(trade.grossReturnPct)}
          </Text>
          <Text style={[typo.small, { color: colors.textTertiary }]}>
            수수료 {wonText(trade.totalFees)}
          </Text>
          <Text style={[typo.small, { color: colors.textTertiary }]}>
            순손익 {wonText(trade.netPnl)}
          </Text>
        </View>
      ) : null}
    </Surface>
  );
}

export default function IntradayScalpTimelineScreen() {
  const { colors, typography: typo } = useTheme();
  const query = useIntradayScalpTrades();
  const history = query.data;

  const renderTrade = useCallback(({ item }: { item: ScalpTrade }) => <TradeRow trade={item} />, []);

  const listHeader = useMemo(
    () =>
      history ? (
        <View style={styles.listHeader}>
          {/* 정직 라벨 — 실주문 없는 forward 모의 + 손익 그대로. */}
          <View style={[styles.notice, { backgroundColor: colors.surfaceSecondary }]}>
            <Feather name="zap" size={14} color={colors.info} />
            <Text style={[typo.small, { color: colors.info, marginLeft: spacing.xs, flex: 1 }]}>
              분봉 단타 — 실시간 모의 · 당일청산(오버나잇 금지) · 실제 주문이 아닙니다. 손익도 그대로
              표시해요.
            </Text>
          </View>
          <Surface
            elevation={1}
            style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}
          >
            <Text style={[typo.small, { color: colors.textTertiary }]}>{history.tagline}</Text>
            {/* ★DAR-418 비용 인지 고지 — 수익률은 순(수수료 후), 왕복비용율 명시. */}
            <Text style={[typo.small, { color: colors.textTertiary, marginTop: spacing.xs }]}>
              수익률은 순수익(수수료 후) 기준 · 왕복 거래비용 약 {history.roundTripCostPct.toFixed(2)}%(수수료·세금·슬리피지)
            </Text>
          </Surface>
          <Text style={[typo.captionMedium, { color: colors.text, marginTop: spacing.xs }]}>
            거래 타임라인 · {history.trades.length}건
          </Text>
        </View>
      ) : null,
    [history, colors, typo],
  );

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={['top']}>
      <ScreenHeader title="단타 (분봉)" onBack={() => router.back()} />

      {query.isLoading ? (
        <LoadingState message="단타 거래 타임라인을 불러오는 중..." />
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
              icon="zap"
              title="아직 단타 거래가 없어요"
              description="장중 모의 누적 예정 — 분봉 신호(거래량 폭발+돌파+VWAP)가 충족되면 거래 타임라인이 표시됩니다."
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
  returnCol: {
    alignItems: 'flex-end',
    gap: 2,
  },
  feeRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: spacing.sm,
    borderTopWidth: 1,
    paddingTop: spacing.xs,
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
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
  },
});
