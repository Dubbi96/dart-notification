import React, { useCallback } from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { Surface } from 'react-native-paper';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '@theme';
import { spacing, radius } from '@theme/spacing';
import { DataLimitBadge } from '@components/common/DataLimitBadge';

import type { PhilosophyStyle } from '@app-types/style-comparison.types';
import type { PersonaOverviewRow } from '@app-types/persona.types';

import { ARCHETYPE_DESC, formatSignedPct } from './personaDisplay';

// 자동매매 persona 선택 카드 — DAR-131 (P-D).
// 거장 철학 1종: 스타일·아키타입 설명·성과 수치·현재 장 적합도·추천/선택 배지를 한 카드로.
// 탭하면 선택(영속). ★ 신뢰: 과신 카피 금지·표본<30 DataLimitBadge·'참고' 전제. 색 단독 의미 금지(아이콘+평문).

interface PersonaSelectCardProps {
  row: PersonaOverviewRow;
  selected: boolean;
  onSelect: (style: PhilosophyStyle) => void;
}

/** 성과 수치 1쌍 — 라벨 위, 값 아래. */
function Metric({ label, value }: { label: string; value: string }) {
  const { colors, typography: typo } = useTheme();
  return (
    <View style={styles.metric}>
      <Text style={[typo.small, { color: colors.textSecondary }]}>{label}</Text>
      <Text style={[typo.captionMedium, { color: colors.text }]}>{value}</Text>
    </View>
  );
}

function RecommendedBadge() {
  const { colors, typography: typo } = useTheme();
  return (
    <View
      style={[styles.badge, { backgroundColor: colors.successSurface }]}
      accessibilityRole="text"
      accessibilityLabel="현재 장 추천 persona"
    >
      <Feather name="star" size={11} color={colors.success} />
      <Text style={[typo.small, { color: colors.success, marginLeft: spacing.xs / 2, fontWeight: '600' }]}>
        현재 장 추천
      </Text>
    </View>
  );
}

function PersonaSelectCardBase({ row, selected, onSelect }: PersonaSelectCardProps) {
  const { colors, typography: typo } = useTheme();
  const perf = row.performance;
  const sc = perf.scorecard;
  const g = perf.graduation;

  const handlePress = useCallback(() => onSelect(perf.style), [onSelect, perf.style]);

  const archetypeDesc = ARCHETYPE_DESC[row.archetype] ?? row.archetype;

  return (
    <Pressable
      onPress={handlePress}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      accessibilityLabel={`${perf.label} persona 선택. ${row.archetype}. 현재 장 적합도 ${Math.round(row.regimeFitScore)}점. 누적수익 ${formatSignedPct(sc.cumulativeReturnPct)}.${row.recommended ? ' 현재 장 추천.' : ''}${selected ? ' 선택됨.' : ''}`}
    >
      <Surface
        elevation={selected ? 2 : 1}
        style={[
          styles.card,
          {
            backgroundColor: colors.surface,
            borderColor: selected ? colors.primary : colors.border,
            borderWidth: selected ? 2 : 1,
          },
        ]}
      >
        <View style={styles.headRow}>
          <View style={styles.titleCol}>
            <View style={styles.titleRow}>
              <Text style={[typo.bodyMedium, { color: colors.text }]}>{perf.label}</Text>
              <View style={[styles.archChip, { backgroundColor: colors.surfaceSecondary, borderColor: colors.border }]}>
                <Text style={[typo.small, { color: colors.textSecondary }]}>{row.archetype}</Text>
              </View>
            </View>
            <Text style={[typo.small, { color: colors.textTertiary, marginTop: 2 }]}>{archetypeDesc}</Text>
          </View>
          {selected ? (
            <Feather name="check-circle" size={20} color={colors.primary} />
          ) : (
            <Feather name="circle" size={20} color={colors.textTertiary} />
          )}
        </View>

        <View style={styles.badgeRow}>
          {row.recommended ? <RecommendedBadge /> : null}
          {perf.lowSample ? <DataLimitBadge sampleCount={sc.sampleSize} /> : null}
        </View>

        <View style={styles.metricGrid}>
          <Metric label="현재 장 적합도" value={`${Math.round(row.regimeFitScore)}점`} />
          <Metric label="누적수익" value={formatSignedPct(sc.cumulativeReturnPct)} />
          <Metric
            label="신호 적중률"
            value={`${Math.round(g.hitRatePct)}% (n=${g.hitRateSampleSize})`}
          />
          <Metric
            label="MDD"
            value={g.mddPct === null ? '측정 불가' : formatSignedPct(g.mddPct)}
          />
        </View>

        {selected ? (
          <View style={[styles.selectedBar, { backgroundColor: colors.primaryLight }]}>
            <Feather name="bookmark" size={12} color={colors.primary} />
            <Text style={[typo.small, { color: colors.primary, marginLeft: spacing.xs, fontWeight: '600' }]}>
              선택한 모의운용 persona
            </Text>
          </View>
        ) : null}
      </Surface>
    </Pressable>
  );
}

export const PersonaSelectCard = React.memo(PersonaSelectCardBase);

const styles = StyleSheet.create({
  card: {
    borderRadius: radius.lg,
    padding: spacing.base,
    gap: spacing.sm,
  },
  headRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: spacing.sm,
  },
  titleCol: {
    flexShrink: 1,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    flexWrap: 'wrap',
  },
  archChip: {
    borderRadius: radius.sm,
    borderWidth: 1,
    paddingHorizontal: spacing.sm,
    paddingVertical: 1,
  },
  badgeRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
  },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    borderRadius: radius.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs / 2,
  },
  metricGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    rowGap: spacing.xs,
  },
  metric: {
    width: '50%',
    paddingVertical: spacing.xs / 2,
    gap: 2,
  },
  selectedBar: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: radius.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
});
