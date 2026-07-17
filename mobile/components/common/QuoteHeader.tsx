import React from 'react';
import { View, Text, StyleSheet, type ViewStyle } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useTheme, MAX_CHIP_FONT_SCALE } from '@theme';
import { spacing, radius } from '@theme/spacing';
import { pnlColor } from '@utils/signalDisplay';
import { quoteUpdatedAgo, quoteSourceMeta } from '@utils/marketQuoteDisplay';

import type { StockQuote } from '@app-types/market-quote.types';

// DAR-353: 종목 상세 상단 대형 현재가 헤더 — 일반 주식앱 현재가 느낌.
// 현재가(큼) + 등락(색+부호+금액·%) + 출처 배지('실시간'/'종가') + 갱신시각('방금'/'N초 전').
// 정직 계약: 색 단독 의미 금지(부호·아이콘 병행). REALTIME 은 '환경 시계 괴리' 고지 동반.
// 데이터 없으면 null(헤더 미표시·빈상태 흡수). OHLC/거래량은 quote 타입에 없어 생략한다.

interface QuoteHeaderProps {
  /** 시세. null/undefined/가격≤0 이면 헤더를 그리지 않는다. */
  quote: StockQuote | null | undefined;
  /** 마지막 성공 갱신 시각(ms, React Query dataUpdatedAt). 갱신시각 표기용. */
  updatedAt?: number | null;
  style?: ViewStyle;
}

export function QuoteHeader({ quote, updatedAt, style }: QuoteHeaderProps) {
  const { colors, typography: typo } = useTheme();

  if (!quote || !(quote.price > 0)) return null;

  const pct = quote.changePercent;
  const change = quote.change;
  // %표기 2자리에 맞춰 부호색 산정(반올림 후 0 은 보합색, DAR-312).
  const changeColor = pct !== null ? pnlColor(pct, colors, { digits: 2 }) : colors.textSecondary;
  const arrow = pct === null ? '' : pct > 0 ? '▲' : pct < 0 ? '▼' : '–';
  const pctSign = pct !== null && pct > 0 ? '+' : '';
  const pctText = pct !== null ? `${arrow} ${pctSign}${pct.toFixed(2)}%` : '';
  const changeText =
    change !== null ? `${change > 0 ? '+' : ''}${change.toLocaleString('ko-KR')}원` : '';
  const direction = pct === null ? '' : pct > 0 ? '상승' : pct < 0 ? '하락' : '보합';

  const src = quoteSourceMeta(quote.source);
  const ago = quoteUpdatedAgo(updatedAt ?? null);

  const a11y =
    `현재가 ${quote.price.toLocaleString('ko-KR')}원` +
    (pct !== null
      ? `, 전일대비 ${change !== null ? `${Math.abs(change).toLocaleString('ko-KR')}원 ` : ''}${Math.abs(pct).toFixed(2)}퍼센트 ${direction}`
      : '') +
    `, 출처 ${src.label}` +
    (ago ? `, ${ago} 갱신` : '') +
    (src.disclosure ? `, ${src.disclosure}` : '');

  return (
    <View style={[styles.container, style]} accessible accessibilityLabel={a11y}>
      <View style={styles.priceRow}>
        <Text style={[typo.amount, { color: colors.text }]}>
          {quote.price.toLocaleString('ko-KR')}
          <Text style={[typo.h3, { color: colors.textSecondary }]}> 원</Text>
        </Text>
        <View
          style={[
            styles.sourceBadge,
            {
              backgroundColor: src.isRealtime ? colors.successSurface : colors.surface,
              borderColor: src.isRealtime ? colors.success : colors.borderLight,
            },
          ]}
        >
          <Feather
            name={src.isRealtime ? 'activity' : 'clock'}
            size={11}
            color={src.isRealtime ? colors.success : colors.textSecondary}
          />
          <Text
            style={[
              typo.small,
              styles.sourceText,
              {
                color: src.isRealtime ? colors.success : colors.textSecondary,
                flexShrink: 1,
                minWidth: 0,
              },
            ]}
            numberOfLines={1}
            maxFontSizeMultiplier={MAX_CHIP_FONT_SCALE}
            ellipsizeMode="tail"
          >
            {src.label}
          </Text>
        </View>
      </View>

      {pctText ? (
        <View style={styles.changeRow}>
          <Text style={[typo.bodyMedium, styles.pctText, { color: changeColor }]}>{pctText}</Text>
          {changeText ? (
            <Text style={[typo.body, { color: changeColor, marginLeft: spacing.sm }]}>
              {changeText}
            </Text>
          ) : null}
        </View>
      ) : null}

      {ago || src.disclosure ? (
        <Text style={[typo.small, { color: colors.textTertiary, marginTop: spacing.xs }]}>
          {[ago ? `${ago} 갱신` : '', src.disclosure ?? ''].filter(Boolean).join(' · ')}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {},
  priceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  sourceBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: radius.sm,
    borderWidth: 1,
  },
  sourceText: {
    fontWeight: '600',
    marginLeft: 4,
  },
  changeRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    marginTop: spacing.xs,
  },
  pctText: {
    fontWeight: '700',
  },
});
