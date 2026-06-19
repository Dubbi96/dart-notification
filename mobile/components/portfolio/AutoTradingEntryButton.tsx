import React, { useCallback } from 'react';
import { Text, StyleSheet, TouchableOpacity, View, StyleProp, ViewStyle } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useTheme, MAX_CHIP_FONT_SCALE } from '@theme';
import { spacing, radius } from '@theme/spacing';

// DAR-372: 자동매매 상태(읽기전용 투명성·DAR-361) 진입의 발견성 컴포넌트.
// 기존엔 모의 성과 푸터 링크(SimulationStatusSection)로만 도달 → '탭으로만 유도돼
// 들어가는 방법을 알 수 없다'는 지적. 포트폴리오 탭 헤더 상단에 아이콘+라벨 버튼으로
// 항상 노출해 1탭 진입을 보장한다(빈 아이콘 금지·터치영역 44pt·접근성 라벨 명시).

const AUTO_TRADING_ROUTE = '/portfolio/auto-trading' as const;

interface AutoTradingEntryButtonProps {
  /** 외부 레이아웃 보정용 스타일(여백 등). */
  style?: StyleProp<ViewStyle>;
}

export function AutoTradingEntryButton({ style }: AutoTradingEntryButtonProps) {
  const { colors, typography: typo } = useTheme();

  const handlePress = useCallback(() => {
    router.push(AUTO_TRADING_ROUTE);
  }, []);

  return (
    <TouchableOpacity
      style={[
        styles.button,
        { backgroundColor: colors.surface, borderColor: colors.borderLight },
        style,
      ]}
      onPress={handlePress}
      activeOpacity={0.7}
      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
      accessibilityRole="button"
      accessibilityLabel="자동매매 상태 — 킬스위치·리스크게이트·최근 실행 모니터링. 자동 실행은 준비중."
    >
      <Feather name="shield" size={16} color={colors.primary} />
      <View style={styles.labelWrap}>
        <Text
          style={[typo.captionMedium, { color: colors.text }]}
          numberOfLines={1}
          maxFontSizeMultiplier={MAX_CHIP_FONT_SCALE}
        >
          자동매매 상태
        </Text>
      </View>
      <Feather name="chevron-right" size={16} color={colors.textSecondary} />
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.base,
    paddingVertical: spacing.sm,
    borderRadius: radius.full,
    borderWidth: 1,
    // 터치영역 44pt 보장(접근성). 시각 높이는 패딩으로 결정, 최소 높이로 하한 고정.
    minHeight: 44,
  },
  labelWrap: {
    // 큰 글꼴서 라벨이 양쪽 아이콘을 밀어내지 않도록 가변폭 흡수.
    flexShrink: 1,
    minWidth: 0,
  },
});
