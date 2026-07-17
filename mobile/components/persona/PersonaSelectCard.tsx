import React, { useCallback, useState } from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { Surface } from 'react-native-paper';
import { Feather } from '@expo/vector-icons';
import { useTheme, MAX_CHIP_FONT_SCALE } from '@theme';
import { spacing, radius } from '@theme/spacing';
import { DataLimitBadge } from '@components/common/DataLimitBadge';

import type { PhilosophyStyle } from '@app-types/style-comparison.types';
import type { PersonaOverviewRow } from '@app-types/persona.types';

import { ARCHETYPE_DESC, formatSignedPct, PERSONA_EMPHASIS } from './personaDisplay';

// persona 비교 강조 카드 — DAR-131 / DAR-205 어휘 약화.
// 거장 철학 1종: 스타일·아키타입 설명·성과 수치·현재 장 적합도·추천/강조 배지를 한 카드로.
// 탭하면 비교 화면에서 강조(영속). ★ DAR-205: '선택→결과 반영'은 오약속(소비처가 전부 표시용
// 하이라이트) → '비교 강조' 어휘로 약화. ★ 신뢰: 과신 카피 금지·표본<30 DataLimitBadge·'참고' 전제.
//
// DAR-195 정보위계: '현재 장 적합도'가 결정 동인 → hero(크게/굵게)로 승격.
// 누적수익·신호 적중률·MDD는 '성과 자세히' 접기(progressive disclosure, DecisionHubTab
// summary-first/detail-on-tap 패턴 일관성)로 demote. 적중률 표본수는 가시 셀에서 빼고
// tertiary 접미·a11y 라벨로만 노출(셀 과밀 제거). 카드 본체 선택 Pressable과 접기 토글은
// 중첩 Pressable로 분리(토글이 responder를 선점 → 토글 탭이 선택을 트리거하지 않음).

interface PersonaSelectCardProps {
  row: PersonaOverviewRow;
  selected: boolean;
  onSelect: (style: PhilosophyStyle) => void;
}

/** 성과 수치 1쌍 — 라벨 위, 값 아래(보조). hint는 tertiary 접미(표본수 등). */
function Metric({ label, value, hint }: { label: string; value: string; hint?: string }) {
  const { colors, typography: typo } = useTheme();
  return (
    <View style={styles.metric}>
      <Text style={[typo.small, { color: colors.textSecondary }]}>{label}</Text>
      <Text style={[typo.captionMedium, { color: colors.text }]}>{value}</Text>
      {hint ? <Text style={[typo.small, { color: colors.textTertiary }]}>{hint}</Text> : null}
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
      <Text
        numberOfLines={1}
        maxFontSizeMultiplier={MAX_CHIP_FONT_SCALE}
        style={[
          typo.small,
          {
            color: colors.success,
            marginLeft: spacing.xs / 2,
            fontWeight: '600',
            flexShrink: 1,
            minWidth: 0,
          },
        ]}
        ellipsizeMode="tail"
      >
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

  const [detailExpanded, setDetailExpanded] = useState(false);
  const toggleDetail = useCallback(() => setDetailExpanded((v) => !v), []);

  const handlePress = useCallback(() => onSelect(perf.style), [onSelect, perf.style]);

  const archetypeDesc = ARCHETYPE_DESC[row.archetype] ?? row.archetype;
  const fitScore = Math.round(row.regimeFitScore);

  return (
    <Pressable
      onPress={handlePress}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      accessibilityLabel={`${perf.label} persona ${PERSONA_EMPHASIS.a11yAction}. ${row.archetype}. 현재 장 적합도 ${fitScore}점. 누적수익 ${formatSignedPct(sc.cumulativeReturnPct)}. 신호 적중률 ${Math.round(g.hitRatePct)}퍼센트 표본 ${g.hitRateSampleSize}건.${row.recommended ? ' 현재 장 추천.' : ''}${selected ? ` ${PERSONA_EMPHASIS.a11yEmphasized}.` : ''}`}
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
              <View
                style={[
                  styles.archChip,
                  { backgroundColor: colors.surfaceSecondary, borderColor: colors.border },
                ]}
              >
                <Text
                  numberOfLines={1}
                  maxFontSizeMultiplier={MAX_CHIP_FONT_SCALE}
                  style={[typo.small, { color: colors.textSecondary, flexShrink: 1, minWidth: 0 }]}
                  ellipsizeMode="tail"
                >
                  {row.archetype}
                </Text>
              </View>
            </View>
            <Text style={[typo.small, { color: colors.textTertiary, marginTop: 2 }]}>
              {archetypeDesc}
            </Text>
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

        {/* HERO: 결정 동인 — 현재 장 적합도 단일 prominent 값 */}
        <View style={[styles.hero, { backgroundColor: colors.primaryLight }]}>
          <Text style={[typo.captionMedium, { color: colors.textSecondary }]}>현재 장 적합도</Text>
          <Text style={[typo.h1, { color: colors.primary }]} maxFontSizeMultiplier={1.3}>
            {fitScore}점
          </Text>
        </View>

        {/* 성과 상세 — demote: 기본 접힘(progressive disclosure). 중첩 Pressable로 선택과 분리 */}
        <Pressable
          onPress={toggleDetail}
          style={styles.detailToggle}
          accessibilityRole="button"
          accessibilityState={{ expanded: detailExpanded }}
          accessibilityLabel={`성과 상세 ${detailExpanded ? '접기' : '펼치기'}`}
        >
          <Feather name="bar-chart-2" size={13} color={colors.textSecondary} />
          <Text style={[typo.small, styles.toggleLabel, { color: colors.textSecondary }]}>
            성과 자세히
          </Text>
          <Feather
            name={detailExpanded ? 'chevron-up' : 'chevron-down'}
            size={16}
            color={colors.textTertiary}
          />
        </Pressable>

        {detailExpanded ? (
          <View style={styles.metricGrid}>
            <Metric label="누적수익" value={formatSignedPct(sc.cumulativeReturnPct)} />
            <Metric
              label="신호 적중률"
              value={`${Math.round(g.hitRatePct)}%`}
              hint={`표본 ${g.hitRateSampleSize}건`}
            />
            <Metric
              label="MDD"
              value={g.mddPct === null ? '측정 불가' : formatSignedPct(g.mddPct)}
            />
          </View>
        ) : null}

        {selected ? (
          <View style={[styles.selectedBar, { backgroundColor: colors.primaryLight }]}>
            <Feather name="bookmark" size={12} color={colors.primary} />
            <Text
              style={[
                typo.small,
                { color: colors.primary, marginLeft: spacing.xs, fontWeight: '600' },
              ]}
            >
              {PERSONA_EMPHASIS.emphasizedBar}
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
  hero: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  detailToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 44,
  },
  toggleLabel: {
    flex: 1,
    marginLeft: spacing.xs,
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
