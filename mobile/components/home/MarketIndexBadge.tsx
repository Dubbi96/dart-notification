import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useTheme, MAX_CHIP_FONT_SCALE } from '@theme';
import { spacing, radius } from '@theme/spacing';
import { pnlColor } from '@utils/signalDisplay';
import { useMarketIndices } from '@hooks/useMarketIndices';

import type { MarketIndexQuote } from '@app-types/market.types';

// DAR-160: 홈 헤더 '시장 한눈에' 배지. KOSPI·KOSDAQ 최신 종가 + 전일대비 등락률.
// 색 단독 의미 금지 — 색 + 부호 + 방향 아이콘 병행(접근성). 테마 토큰만 사용, 정적 표시.
// 데이터가 없을 때(로딩·에러·미적재)는 깨지지 않도록 null 을 렌더한다.
// DAR-300: 컴팩트 배지 — 인접 홈 카드와 높이 위계를 맞추기 위해 세로 패딩/행 간격을 압축한다.
// 큰 시스템 폰트(OS 배율)가 RN 타이포 배율 위에 이중으로 곱해져 카드가 과대해지는 것을 막기 위해
// 고정·압축 배지 규칙(§9/DAR-174)에 따라 maxFontSizeMultiplier 로 OS 추가 배율을 상한한다.

function formatIndex(value: number): string {
  return value.toLocaleString('ko-KR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function MarketIndexColumn({ quote }: { quote: MarketIndexQuote }) {
  const { colors, typography: typo } = useTheme();
  const pct = quote.changePercent;
  // 등락 결측: 아이콘 없이 옅은 색의 '—' 만 — 정상 등락값과 같은 높이를 예약하지 않도록 컴팩트 처리.
  const isMissing = pct === null;
  const changeColor = isMissing ? colors.textTertiary : pnlColor(pct, colors);
  const iconName = pct === null ? 'minus' : pct > 0 ? 'trending-up' : pct < 0 ? 'trending-down' : 'minus';
  const sign = pct !== null && pct > 0 ? '+' : '';
  const pctText = isMissing ? '—' : `${sign}${pct.toFixed(2)}%`;
  const direction = isMissing ? '데이터 없음' : pct > 0 ? '상승' : pct < 0 ? '하락' : '보합';

  return (
    <View
      style={styles.column}
      accessibilityRole="text"
      accessibilityLabel={`${quote.market} ${formatIndex(quote.closeIndex)} 전일대비 ${pctText} ${direction}`}
    >
      <Text style={[typo.small, { color: colors.textSecondary }]} maxFontSizeMultiplier={MAX_CHIP_FONT_SCALE}>
        {quote.market}
      </Text>
      <Text
        style={[typo.caption, styles.indexValue, { color: colors.text }]}
        maxFontSizeMultiplier={MAX_CHIP_FONT_SCALE}
      >
        {formatIndex(quote.closeIndex)}
      </Text>
      <View style={styles.changeRow}>
        {!isMissing && <Feather name={iconName} size={12} color={changeColor} />}
        <Text
          style={[
            typo.small,
            isMissing ? styles.changeTextMissing : styles.changeText,
            { color: changeColor },
          ]}
          maxFontSizeMultiplier={MAX_CHIP_FONT_SCALE}
        >
          {pctText}
        </Text>
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
        <Text
          style={[typo.captionMedium, { color: colors.text, marginLeft: spacing.xs }]}
          maxFontSizeMultiplier={MAX_CHIP_FONT_SCALE}
        >
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
    // DAR-300: 세로 패딩을 base(16)→md(12)로 축소해 콘텐츠가 적은 배지의 과대 높이를 인접 카드와 균형.
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.base,
    marginBottom: spacing.md,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    // DAR-300: 제목과 지수 사이 간격 sm(8)→xs(4)로 축소.
    marginBottom: spacing.xs,
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
  // DAR-300: 결측 '—' 은 아이콘 없이 좌측 정렬 — 정상 등락값보다 옅고 컴팩트하게.
  changeTextMissing: {
    fontWeight: '400',
    marginLeft: 0,
  },
  divider: {
    width: StyleSheet.hairlineWidth,
    alignSelf: 'stretch',
    marginHorizontal: spacing.base,
  },
});
