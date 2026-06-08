import React, { useCallback } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '@theme';
import { spacing, radius } from '@theme/spacing';
import { Card } from '@components/common/Card';
import { ProvenanceBar, type ProvenanceItem } from '@components/common/ProvenanceBar';
import { PhilosophyStatStrip } from '@components/philosophy/PhilosophyStatStrip';
import type { Philosophy } from '@app-types/philosophy.types';
import { sourceTypeLabel } from './metricFormat';

// 투자거장 카드(DAR-54·DAR-123) — 텍스트 최소화·수치 우선.
// 긴 핵심원칙 3줄 나열을 1줄 헤드라인 요약 + 통계 스트립(핵심원칙·체크리스트·정량지표 N)으로 대체.
// 상세 근거는 탭하여 드릴다운. 색 단독 의미 금지 — 스타일 태그/출처는 텍스트·아이콘 병행.

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

  // 1줄 헤드라인: 대표 원칙 한 줄(없으면 리스크 성향). 나머지 근거는 상세에서.
  const headline = philosophy.corePrinciples[0] ?? philosophy.riskProfile;

  return (
    <TouchableOpacity
      activeOpacity={0.8}
      onPress={handlePress}
      accessibilityRole="button"
      accessibilityLabel={`${philosophy.investorName} 철학 상세 보기. 핵심원칙 ${philosophy.corePrinciples.length}개, 체크리스트 ${philosophy.checklistItems.length}개, 정량지표 ${philosophy.metrics.length}종`}
    >
      <Card variant="elevated" style={styles.card}>
        {/* 헤더: 이름 + 스타일 태그 */}
        <View style={styles.header}>
          <Text style={[typo.h3, { color: colors.text }, styles.flex1]} numberOfLines={1}>
            {philosophy.investorName}
          </Text>
          <Feather name="chevron-right" size={18} color={colors.textTertiary} />
        </View>

        <View style={styles.tagRow}>
          {philosophy.styleTags.map((tag) => (
            <View key={tag} style={[styles.tag, { backgroundColor: colors.primaryLight }]}>
              <Text style={[typo.small, { color: colors.primaryDark }, styles.tagText]}>{tag}</Text>
            </View>
          ))}
        </View>

        {/* 1줄 헤드라인 요약(상세는 드릴다운) */}
        {headline ? (
          <View style={styles.headlineRow}>
            <Feather name="bookmark" size={13} color={colors.primary} style={styles.headlineIcon} />
            <Text style={[typo.caption, { color: colors.textSecondary }, styles.flex1]} numberOfLines={1}>
              {headline}
            </Text>
          </View>
        ) : null}

        {/* 한눈 통계 스트립 — 핵심원칙·체크리스트·정량지표 N */}
        <PhilosophyStatStrip philosophy={philosophy} style={styles.stats} />

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
  flex1: {
    flex: 1,
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
  tagText: {
    fontWeight: '600',
  },
  headlineRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: spacing.md,
  },
  headlineIcon: {
    marginRight: spacing.xs,
  },
  stats: {
    marginTop: spacing.md,
  },
  provenance: {
    marginTop: spacing.md,
  },
});
