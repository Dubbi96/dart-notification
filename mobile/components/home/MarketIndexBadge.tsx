import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useTheme, MAX_CHIP_FONT_SCALE } from '@theme';
import { spacing, radius } from '@theme/spacing';
import { pnlColor } from '@utils/signalDisplay';
import { indexBasisLabel } from '@utils/marketIndexDisplay';
import { useMarketIndices } from '@hooks/useMarketIndices';
import { useSkeletonPulse, SkeletonBar } from '@components/common/SkeletonCard';

import type { MarketIndexQuote } from '@app-types/market.types';

// DAR-160: 홈 헤더 '시장 한눈에' 배지. KOSPI·KOSDAQ 최신 종가 + 전일대비 등락률.
// 색 단독 의미 금지 — 색 + 부호 + 방향 아이콘 병행(접근성). 테마 토큰만 사용, 정적 표시.
// DAR-446(A-MKT-1): 로딩 중에는 null 대신 동일 카드 높이의 스켈레톤 자리표시를 렌더한다.
//   기존엔 로딩 시 null → 데이터 도착 후 배지가 삽입되며 홈 헤더가 아래로 밀리는 레이아웃 점프가
//   있었다. 로딩 자리표시가 같은 골격(제목행 + 2열 × 4줄)을 미리 차지해 점프를 제거한다.
//   로딩이 끝났는데도 데이터가 없으면(에러·미적재) 기존처럼 null(미표시)로 접는다.
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
  // DAR-367: 전일 종가가 오염돼 등락률이 물리적으로 불가능(>±20%)한 경우 BE 가 suspect=true 로
  // 등락을 숨긴다. 사용자에게 -63% 같은 값 대신 '점검중' 으로 정직하게 표기한다.
  const isSuspect = quote.suspect === true && isMissing;
  const changeColor = isMissing ? colors.textTertiary : pnlColor(pct, colors);
  const iconName = pct === null ? 'minus' : pct > 0 ? 'trending-up' : pct < 0 ? 'trending-down' : 'minus';
  const sign = pct !== null && pct > 0 ? '+' : '';
  const pctText = isSuspect ? '점검중' : isMissing ? '—' : `${sign}${pct.toFixed(2)}%`;
  const direction = isSuspect
    ? '데이터 점검중'
    : isMissing
      ? '데이터 없음'
      : pct > 0
        ? '상승'
        : pct < 0
          ? '하락'
          : '보합';

  // DAR-371: 신선도 정직 — 실시간이면 '실시간', EOD/구버전이면 'YYYY.MM.DD 종가' 기준 라벨.
  // stale 종가를 '현재'로 오인하지 않도록 출처를 명시한다.
  const basis = indexBasisLabel(quote);
  const basisColor = basis.isRealtime ? colors.success : colors.textTertiary;

  return (
    <View
      style={styles.column}
      accessibilityRole="text"
      accessibilityLabel={`${quote.market} ${formatIndex(quote.closeIndex)} 전일대비 ${pctText} ${direction}, ${basis.a11y}`}
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
      <View style={styles.basisRow}>
        {basis.isRealtime && (
          <View style={[styles.liveDot, { backgroundColor: colors.success }]} />
        )}
        <Text
          style={[typo.small, styles.basisText, { color: basisColor }]}
          maxFontSizeMultiplier={MAX_CHIP_FONT_SCALE}
          numberOfLines={1}
        >
          {basis.label}
        </Text>
      </View>
    </View>
  );
}

// 로딩 자리표시(A-MKT-1) — 실제 배지와 동일한 카드 골격·타이포 lineHeight 높이로 자리를 예약해
// 데이터 도착 시 레이아웃 점프를 막는다. SkeletonBar/펄스는 공통 스켈레톤 인프라 재사용.
function MarketIndexBadgeSkeleton() {
  const { colors, typography: typo } = useTheme();
  const opacity = useSkeletonPulse();
  return (
    <View
      style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.borderLight }]}
      accessibilityRole="progressbar"
      accessibilityLabel="시장 지수 불러오는 중"
    >
      <View style={styles.titleRow}>
        <SkeletonBar width={80} height={typo.captionMedium.lineHeight} opacity={opacity} />
      </View>
      <View style={styles.columns}>
        {[0, 1].map((i) => (
          <View key={i} style={styles.column}>
            <SkeletonBar width={44} height={typo.small.lineHeight} opacity={opacity} />
            <SkeletonBar width={64} height={typo.caption.lineHeight} opacity={opacity} style={styles.skeletonGap} />
            <SkeletonBar width={48} height={typo.small.lineHeight} opacity={opacity} style={styles.skeletonGap} />
            <SkeletonBar width={56} height={typo.small.lineHeight} opacity={opacity} style={styles.skeletonGap} />
          </View>
        ))}
      </View>
    </View>
  );
}

export function MarketIndexBadge() {
  const { colors, typography: typo } = useTheme();
  const { data, isLoading } = useMarketIndices();

  // 첫 로딩(isLoading=pending&&fetching, 아직 데이터 없음) → 점프 방지용 고정 높이 스켈레톤(A-MKT-1).
  if (isLoading) return <MarketIndexBadgeSkeleton />;
  // 로딩이 끝났는데 데이터 없음(에러·미적재) → 홈 레이아웃을 흔들지 않도록 미표시.
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
  // A-MKT-1: 스켈레톤 막대 간 간격 — 실제 열의 행 간격(marginTop: 2)과 동일하게 맞춰 높이 정합.
  skeletonGap: {
    marginTop: 2,
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
  // DAR-371: 신선도 기준 라벨 행('실시간' / 'YYYY.MM.DD 종가').
  basisRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 2,
  },
  basisText: {
    fontWeight: '400',
  },
  liveDot: {
    width: 5,
    height: 5,
    borderRadius: 2.5,
    marginRight: 4,
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
