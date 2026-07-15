import React from 'react';
import { View, Text, StyleSheet, Pressable, type ViewStyle } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useTheme } from '@theme';
import { spacing, sizing } from '@theme/spacing';

// W2 컴플라이언스(M0 정책 §4): 차트·시세 표면 출처 귀속(attribution) 한 줄.
// '출처: 한국거래소' 형태의 기관명 명시 — 화면당 1회만 사용해 과도한 중복을 피한다.
// 탭하면 법적 고지 '데이터 출처' 화면(/legal/data-sources)으로 이동(지연 고지·면책 상세).
// 기존 정직 라벨(DailyCandleChart 'KRX 일봉(장 마감 종가)' 등)은 시점·신선도 고지,
// 이 컴포넌트는 기관 귀속 표기 — 역할이 다르므로 공존한다.

export type DataSourceKey = 'KRX' | 'KIS' | 'DART';

const SOURCE_NAMES: Record<DataSourceKey, string> = {
  KRX: '한국거래소',
  KIS: '한국투자증권',
  DART: '금융감독원 DART',
};

const ICON_SIZE = 11; // 보조 라벨용 소형 아이콘(ProvenanceBar 12와 동급 one-off)

// 시각 높이(typo.small 한 줄 ≈ 16pt)를 최소 터치 영역(44pt)으로 보정하는 hitSlop.
const HIT_SLOP = {
  top: (sizing.minTouchTarget - 16) / 2,
  bottom: (sizing.minTouchTarget - 16) / 2,
  left: spacing.sm,
  right: spacing.sm,
};

interface SourceAttributionProps {
  /** 화면에 실제 사용된 데이터 출처만 나열. 예: ['KRX', 'KIS'] */
  sources: DataSourceKey[];
  /** true(기본)면 탭 시 데이터 출처 상세(/legal/data-sources)로 이동. */
  linkToDetail?: boolean;
  style?: ViewStyle;
}

export function SourceAttribution({
  sources,
  linkToDetail = true,
  style,
}: SourceAttributionProps) {
  const { colors, typography: typo } = useTheme();
  if (sources.length === 0) return null;

  const label = `출처: ${sources.map((s) => SOURCE_NAMES[s]).join(' · ')}`;

  if (!linkToDetail) {
    return (
      <View style={[styles.row, style]} accessibilityRole="text" accessibilityLabel={label}>
        <Feather name="info" size={ICON_SIZE} color={colors.textTertiary} />
        <Text style={[typo.small, styles.label, { color: colors.textTertiary }]}>{label}</Text>
      </View>
    );
  }

  return (
    <Pressable
      onPress={() => router.push('/legal/data-sources')}
      hitSlop={HIT_SLOP}
      accessibilityRole="button"
      accessibilityLabel={`${label}. 데이터 출처와 지연 고지 자세히 보기`}
      style={[styles.row, style]}
    >
      <Feather name="info" size={ICON_SIZE} color={colors.textTertiary} />
      <Text style={[typo.small, styles.label, { color: colors.textTertiary }]}>{label}</Text>
      <Feather name="chevron-right" size={ICON_SIZE} color={colors.textTertiary} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
  },
  label: {
    marginHorizontal: spacing.xs,
  },
});
