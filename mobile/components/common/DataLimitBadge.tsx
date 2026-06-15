import React from 'react';
import { View, Text, StyleSheet, type ViewStyle } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useTheme, MAX_CHIP_FONT_SCALE } from '@theme';
import { spacing, radius } from '@theme/spacing';

// 데이터 한계 배지 통일 컴포넌트(DAR-121, 신뢰 원칙 §6).
// 표본<30·통계 미유의 등 신뢰도 제한을 신호 상세·이벤트 통계·포트폴리오 정밀도 탭에
// 동일한 형태(alert-triangle + '데이터 한계' 평문 + 선택적 표본수)로 노출한다.
// 그동안 화면별로 'LOW_SAMPLE'·'표본 부족 N'·'데이터 한계' 라벨과 마크업이 제각각이던 것을 단일화.
// ★ 색 단독 의미 금지: 아이콘(형태) + 평문 텍스트 병기. 테마 토큰만(하드코딩 색상 0).

interface DataLimitBadgeProps {
  /** 표본수. 제공되면 '데이터 한계 · 표본 N' 으로 함께 노출. */
  sampleCount?: number;
  style?: ViewStyle;
}

/**
 * 데이터 한계 배지. 노출 여부 판정은 호출부 책임(isDataLimited).
 * 이 컴포넌트는 '한계 있음'이 확정된 자리에만 렌더한다.
 */
export function DataLimitBadge({ sampleCount, style }: DataLimitBadgeProps) {
  const { colors, typography: typo } = useTheme();
  const hasSample = typeof sampleCount === 'number' && Number.isFinite(sampleCount);
  const label = hasSample ? `데이터 한계 · 표본 ${sampleCount}` : '데이터 한계';
  const a11y = hasSample
    ? `데이터 한계: 표본 ${sampleCount}건으로 신뢰도가 제한됩니다. 참고용입니다.`
    : '데이터 한계: 표본 부족 또는 통계 미유의로 신뢰도가 제한됩니다. 참고용입니다.';

  return (
    <View
      style={[styles.badge, { backgroundColor: colors.surfaceSecondary, borderColor: colors.warning }, style]}
      accessibilityRole="text"
      accessibilityLabel={a11y}
    >
      <Feather name="alert-triangle" size={11} color={colors.warning} />
      <Text
        numberOfLines={1}
        maxFontSizeMultiplier={MAX_CHIP_FONT_SCALE}
        style={[typo.small, { color: colors.warning, marginLeft: spacing.xs, fontWeight: '600' }]}
      >
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs / 2,
    borderRadius: radius.sm,
    borderWidth: 1,
  },
});
