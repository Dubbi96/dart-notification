import React, { useCallback } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '@theme';
import { spacing, radius } from '@theme/spacing';
import { Card } from '@components/common/Card';
import { ProvenanceBar, type ProvenanceItem } from '@components/common/ProvenanceBar';
import type { Philosophy } from '@app-types/philosophy.types';
import { sourceTypeLabel } from './metricFormat';

// 투자거장 카드(DAR-54) — 핵심원칙·체크리스트 미리보기·출처(ProvenanceBar). 탭 시 상세로.
// 색 단독 의미 금지 — 스타일 태그는 텍스트, 출처는 ProvenanceBar(아이콘+라벨).

interface PhilosophyMasterCardProps {
  philosophy: Philosophy;
  onPress: (philosophyId: string) => void;
}

function PhilosophyMasterCardBase({ philosophy, onPress }: PhilosophyMasterCardProps) {
  const { colors, typography: typo } = useTheme();

  const handlePress = useCallback(() => onPress(philosophy.philosophyId), [onPress, philosophy.philosophyId]);

  // 출처를 ProvenanceBar 항목으로(유형·연도) — 상시 노출로 "무엇 기준" 데이터인지 표시.
  const provenance: ProvenanceItem[] = philosophy.sources.slice(0, 2).map((s) => ({
    icon: 'database',
    label: `${sourceTypeLabel(s.type)} · ${s.year}`,
  }));

  const principles = philosophy.corePrinciples.slice(0, 3);

  return (
    <TouchableOpacity
      activeOpacity={0.8}
      onPress={handlePress}
      accessibilityRole="button"
      accessibilityLabel={`${philosophy.investorName} 철학 상세 보기`}
    >
      <Card variant="elevated" style={styles.card}>
        {/* 헤더: 이름 + 스타일 태그 */}
        <View style={styles.header}>
          <Text style={[typo.h3, { color: colors.text, flex: 1 }]} numberOfLines={1}>
            {philosophy.investorName}
          </Text>
          <Feather name="chevron-right" size={18} color={colors.textTertiary} />
        </View>

        <View style={styles.tagRow}>
          {philosophy.styleTags.map((tag) => (
            <View key={tag} style={[styles.tag, { backgroundColor: colors.primaryLight }]}>
              <Text style={[typo.small, { color: colors.primaryDark, fontWeight: '600' }]}>{tag}</Text>
            </View>
          ))}
        </View>

        {/* 핵심 원칙(상위 3) */}
        <View style={styles.principles}>
          {principles.map((p, idx) => (
            <View key={idx} style={styles.principleRow}>
              <Feather name="check" size={13} color={colors.primary} style={styles.principleIcon} />
              <Text style={[typo.caption, { color: colors.textSecondary, flex: 1 }]} numberOfLines={2}>
                {p}
              </Text>
            </View>
          ))}
        </View>

        {/* 체크리스트 개수 안내 */}
        <Text style={[typo.small, { color: colors.textTertiary, marginTop: spacing.sm }]}>
          체크리스트 {philosophy.checklistItems.length}항목 · 정량지표 {philosophy.metrics.length}종
        </Text>

        {provenance.length > 0 ? (
          <ProvenanceBar items={provenance} style={styles.provenance} />
        ) : null}
      </Card>
    </TouchableOpacity>
  );
}

export const PhilosophyMasterCard = React.memo(PhilosophyMasterCardBase);

const styles = StyleSheet.create({
  card: {
    marginBottom: 0,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  tagRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
    marginTop: spacing.sm,
  },
  tag: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: radius.sm,
  },
  principles: {
    marginTop: spacing.md,
    gap: spacing.xs,
  },
  principleRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  principleIcon: {
    marginTop: 2,
    marginRight: spacing.xs,
  },
  provenance: {
    marginTop: spacing.md,
  },
});
