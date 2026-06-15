import React, { useCallback } from 'react';
import { View, Text, FlatList, StyleSheet, type ListRenderItem } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useTheme, MAX_CHIP_FONT_SCALE } from '@theme';
import { spacing, radius } from '@theme/spacing';
import { Card } from '@components/common/Card';
import { LoadingState, EmptyState, ErrorState } from '@components/common/StateView';
import { DisclaimerSection } from '@components/common/DisclaimerSection';
import { useCompanyInsiderHoldings } from '@hooks/useInsiderHoldings';

import type {
  InsiderHoldingChange,
  InsiderTradeType,
} from '@app-types/insider-holding.types';

// 종목 상세 '내부자/대량보유 동향' 섹션 — DAR-88.
// DAR-87 이 적재한 InsiderHoldingChange 를 조회 API(GET /insider-holdings)로 노출한다.
// 보고자·관계·취득/처분·보유비율 전후·보고일을 보여주며, 참고용(면책)이다.

interface InsiderHoldingsTabProps {
  corpCode: string;
}

const SOURCE_LABEL: Record<string, string> = {
  EXECUTIVE: '임원·주요주주',
  MAJOR_STOCK: '5% 대량보유',
};

interface TradeStyle {
  label: string;
  icon: 'arrow-up-right' | 'arrow-down-right' | 'minus';
  tone: 'buy' | 'sell' | 'neutral';
}

function tradeStyle(tradeType: InsiderTradeType): TradeStyle {
  if (tradeType === 'BUY') return { label: '취득', icon: 'arrow-up-right', tone: 'buy' };
  if (tradeType === 'SELL') return { label: '처분', icon: 'arrow-down-right', tone: 'sell' };
  return { label: '변동 없음', icon: 'minus', tone: 'neutral' };
}

function formatIsoDate(iso: string | null): string {
  if (!iso) return '-';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '-';
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}.${m}.${day}`;
}

function formatRatio(value: number | null): string {
  return value == null ? '-' : `${value.toFixed(2)}%`;
}

function formatRatioChange(value: number | null): string {
  if (value == null) return '-';
  const sign = value > 0 ? '+' : '';
  return `${sign}${value.toFixed(2)}%p`;
}

const InsiderRow = React.memo(function InsiderRow({ item }: { item: InsiderHoldingChange }) {
  const { colors, typography: typo } = useTheme();
  const ts = tradeStyle(item.tradeType);
  const toneColor =
    ts.tone === 'buy' ? colors.success : ts.tone === 'sell' ? colors.error : colors.textSecondary;

  const ratioBefore =
    item.ratioAfter != null && item.ratioChange != null
      ? item.ratioAfter - item.ratioChange
      : null;

  return (
    <Card variant="elevated" style={styles.card}>
      <View style={styles.headerRow}>
        <View
          style={[styles.sourceBadge, { backgroundColor: colors.surfaceSecondary }]}
          accessibilityLabel={`출처: ${SOURCE_LABEL[item.source] ?? item.source}`}
        >
          <Text
            style={[typo.small, { color: colors.textSecondary, fontWeight: '600' }]}
            numberOfLines={1}
            maxFontSizeMultiplier={MAX_CHIP_FONT_SCALE}
          >
            {SOURCE_LABEL[item.source] ?? item.source}
          </Text>
        </View>
        <Text style={[typo.small, { color: colors.textTertiary }]}>
          {formatIsoDate(item.reportedAt)}
        </Text>
      </View>

      <View style={styles.reporterRow}>
        <Text style={[typo.body, { color: colors.text, fontWeight: '600', flex: 1 }]} numberOfLines={1}>
          {item.reporter}
        </Text>
        <View style={styles.tradeTag} accessibilityLabel={`매매 방향: ${ts.label}`}>
          <Feather name={ts.icon} size={14} color={toneColor} />
          <Text
            style={[typo.captionMedium, { color: toneColor, marginLeft: spacing.xs }]}
            numberOfLines={1}
            maxFontSizeMultiplier={MAX_CHIP_FONT_SCALE}
          >
            {ts.label}
          </Text>
        </View>
      </View>

      {item.relation ? (
        <Text style={[typo.small, { color: colors.textSecondary, marginTop: spacing.xs }]} numberOfLines={1}>
          {item.relation}
        </Text>
      ) : null}

      {/* 보유 비율 전 → 후 */}
      <View style={[styles.ratioRow, { borderTopColor: colors.borderLight }]}>
        <Text style={[typo.small, { color: colors.textTertiary }]}>보유 비율</Text>
        <View style={styles.ratioValues}>
          <Text style={[typo.captionMedium, { color: colors.textSecondary }]}>
            {formatRatio(ratioBefore)}
          </Text>
          <Feather name="arrow-right" size={12} color={colors.textTertiary} style={styles.ratioArrow} />
          <Text style={[typo.captionMedium, { color: colors.text, fontWeight: '700' }]}>
            {formatRatio(item.ratioAfter)}
          </Text>
          {item.ratioChange != null && item.ratioChange !== 0 ? (
            <Text style={[typo.small, { color: toneColor, marginLeft: spacing.xs }]}>
              ({formatRatioChange(item.ratioChange)})
            </Text>
          ) : null}
        </View>
      </View>

      {item.reportReason ? (
        <Text style={[typo.small, { color: colors.textTertiary, marginTop: spacing.xs }]} numberOfLines={2}>
          사유: {item.reportReason}
        </Text>
      ) : null}
    </Card>
  );
});

export function InsiderHoldingsTab({ corpCode }: InsiderHoldingsTabProps) {
  const { colors, typography: typo } = useTheme();
  const { data, isLoading, isError, refetch } = useCompanyInsiderHoldings(corpCode);

  const renderItem = useCallback<ListRenderItem<InsiderHoldingChange>>(
    ({ item }) => <InsiderRow item={item} />,
    [],
  );

  if (isLoading) return <LoadingState message="내부자/대량보유 동향을 불러오는 중…" />;
  if (isError)
    return (
      <ErrorState
        title="내부자 동향을 불러오지 못했습니다"
        description="잠시 후 다시 시도해 주세요."
        onRetry={refetch}
      />
    );
  if (!data || data.length === 0)
    return (
      <EmptyState
        icon="users"
        title="최근 내부자/대량보유 변동이 없습니다."
        description="임원·주요주주·5% 대량보유자의 지분변동 공시가 접수되면 여기에 표시됩니다."
      />
    );

  return (
    <FlatList
      data={data}
      keyExtractor={(item) => item.id}
      renderItem={renderItem}
      contentContainerStyle={styles.listContent}
      showsVerticalScrollIndicator={false}
      ListHeaderComponent={
        <Text style={[typo.captionMedium, { color: colors.textSecondary, marginBottom: spacing.sm }]}>
          최근 지분변동 {data.length}건 · 보고일 최신순
        </Text>
      }
      ListFooterComponent={
        <View style={styles.footer}>
          <DisclaimerSection />
        </View>
      }
    />
  );
}

const styles = StyleSheet.create({
  listContent: {
    padding: spacing.lg,
  },
  card: {
    marginBottom: spacing.md,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  sourceBadge: {
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: radius.sm,
  },
  reporterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: spacing.sm,
  },
  tradeTag: {
    flexDirection: 'row',
    alignItems: 'center',
    marginLeft: spacing.sm,
  },
  ratioRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderTopWidth: StyleSheet.hairlineWidth,
    marginTop: spacing.md,
    paddingTop: spacing.sm,
  },
  ratioValues: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  ratioArrow: {
    marginHorizontal: spacing.xs,
  },
  footer: {
    marginTop: spacing.md,
  },
});
