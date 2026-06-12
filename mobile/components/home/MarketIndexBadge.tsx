import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '@theme';
import { spacing, radius } from '@theme/spacing';
import { pnlColor } from '@utils/signalDisplay';
import { useMarketIndices } from '@hooks/useMarketIndices';

import type { MarketIndexQuote } from '@app-types/market.types';

// DAR-160: 홈 헤더 '시장 한눈에' 배지. KOSPI·KOSDAQ 최신 종가 + 전일대비 등락률.
// 색 단독 의미 금지 — 색 + 부호 + 방향 아이콘 병행(접근성). 테마 토큰만 사용, 정적 표시.
// 데이터가 없을 때(로딩·에러·미적재)는 깨지지 않도록 null 을 렌더한다.

function formatIndex(value: number): string {
  return value.toLocaleString('ko-KR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function MarketIndexColumn({ quote }: { quote: MarketIndexQuote }) {
  const { colors, typography: typo } = useTheme();
  const pct = quote.changePercent;
  const changeColor = pct === null ? colors.textSecondary : pnlColor(pct, colors);
  const iconName = pct === null ? 'minus' : pct > 0 ? 'trending-up' : pct < 0 ? 'trending-down' : 'minus';
  const sign = pct !== null && pct > 0 ? '+' : '';
  const pctText = pct === null ? '—' : `${sign}${pct.toFixed(2)}%`;
  const direction = pct === null ? '데이터 없음' : pct > 0 ? '상승' : pct < 0 ? '하락' : '보합';

  return (
    <View
      style={styles.column}
      accessibilityRole="text"
      accessibilityLabel={`${quote.market} ${formatIndex(quote.closeIndex)} 전일대비 ${pctText} ${direction}`}
    >
      <Text style={[typo.small, { color: colors.textSecondary }]}>{quote.market}</Text>
      <Text style={[typo.caption, styles.indexValue, { color: colors.text }]}>
        {formatIndex(quote.closeIndex)}
      </Text>
      <View style={styles.changeRow}>
        <Feather name={iconName} size={12} color={changeColor} />
        <Text style={[typo.small, styles.changeText, { color: changeColor }]}>{pctText}</Text>
      </View>
    </View>
  );
}

export function MarketIndexBadge() {
  const { colors, typography: typo } = useTheme();
  const { data } = useMarketIndices();

  // 데이터 없음(로딩·에러·미적재) → 홈 레이아웃을 흔들지 않도록 미표시.
  if (!data || data.length === 0) return null;

  return (
    <View
      style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.borderLight }]}
    >
      <View style={styles.titleRow}>
        <Feather name="bar-chart-2" size={14} color={colors.primary} />
        <Text style={[typo.captionMedium, { color: colors.text, marginLeft: spacing.xs }]}>
          시장 한눈에
        </Text>
      </View>
      <View style={styles.columns}>
        {data.map((quote, idx) => (
          <React.Fragment key={quote.indexCode}>
            {idx > 0 && <View style={[styles.divider, { backgroundColor: colors.borderLight }]} />}
            <MarketIndexColumn quote={quote} />
          </React.Fragment>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: radius.lg,
    borderWidth: 1,
    padding: spacing.base,
    marginBottom: spacing.md,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  columns: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  column: {
    flex: 1,
  },
  indexValue: {
    fontWeight: '700',
    marginTop: 2,
  },
  changeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 2,
  },
  changeText: {
    fontWeight: '600',
    marginLeft: 2,
  },
  divider: {
    width: StyleSheet.hairlineWidth,
    alignSelf: 'stretch',
    marginHorizontal: spacing.base,
  },
});
