import React from 'react';
import { View, Text, StyleSheet, type ViewStyle } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '@theme';
import { spacing, radius } from '@theme/spacing';
import type { Philosophy } from '@app-types/philosophy.types';

// 철학 한눈 통계 스트립(DAR-123) — 긴 서술 대신 핵심 수치를 아이콘+숫자 칩으로 시각화.
// 진입 화면 텍스트량을 줄이고 '핵심원칙 N · 체크리스트 N · 정량지표 N'을 한 줄로 노출한다.
// 색 단독 의미 금지 — 각 칩은 Feather 아이콘(형태) + 평문 라벨 병행. 테마 토큰만.

interface PhilosophyStatStripProps {
  philosophy: Philosophy;
  style?: ViewStyle;
}

interface StatItem {
  icon: keyof typeof Feather.glyphMap;
  label: string;
  count: number;
}

function PhilosophyStatStripBase({ philosophy, style }: PhilosophyStatStripProps) {
  const { colors, typography: typo } = useTheme();

  const stats: StatItem[] = [
    { icon: 'target', label: '핵심원칙', count: philosophy.corePrinciples.length },
    { icon: 'check-square', label: '체크리스트', count: philosophy.checklistItems.length },
    { icon: 'sliders', label: '정량지표', count: philosophy.metrics.length },
  ];

  const a11y = stats.map((s) => `${s.label} ${s.count}개`).join(', ');

  return (
    <View style={[styles.strip, style]} accessibilityLabel={a11y}>
      {stats.map((s) => (
        <View
          key={s.label}
          style={[styles.stat, { backgroundColor: colors.surfaceSecondary }]}
          importantForAccessibility="no-hide-descendants"
        >
          <Feather name={s.icon} size={14} color={colors.primary} />
          <Text style={[typo.captionMedium, { color: colors.text }, styles.count]}>{s.count}</Text>
          <Text style={[typo.small, { color: colors.textSecondary }]}>{s.label}</Text>
        </View>
      ))}
    </View>
  );
}

export const PhilosophyStatStrip = React.memo(PhilosophyStatStripBase);

const styles = StyleSheet.create({
  strip: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  stat: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    flexWrap: 'wrap',
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.xs,
    borderRadius: radius.md,
    gap: spacing.xs / 2,
  },
  count: {
    marginLeft: spacing.xs / 2,
  },
});
