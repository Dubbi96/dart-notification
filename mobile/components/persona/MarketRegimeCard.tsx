import React, { useMemo } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Surface } from 'react-native-paper';
import { Feather } from '@expo/vector-icons';
import { useTheme, MAX_CHIP_FONT_SCALE } from '@theme';
import { spacing, radius } from '@theme/spacing';
import { DataLimitBadge } from '@components/common/DataLimitBadge';

import type { MarketRegime, PersonaOverviewRow } from '@app-types/persona.types';

import { TREND_LABEL, VOLATILITY_LABEL, EVENT_SKEW_LABEL } from './personaDisplay';

// 현재 장(시장 레짐) + 현재 장 적합 persona 추천 카드 — DAR-131 (P-D).
// 추천우선→비교 패턴의 '추천' 헤드: 추세·변동성·이벤트분포를 칩으로, 추천 persona를 근거와 함께 노출.
// ★ 신뢰 원칙: '참고용' 라벨 상시·과신 카피 금지. 표본<30 미유의면 DataLimitBadge(테마 토큰만).

interface MarketRegimeCardProps {
  regime: MarketRegime;
  /** 복합점수 내림차순 persona 행(추천우선). 추천 대상만 상단 노출. */
  personas: PersonaOverviewRow[];
  dataLimited: boolean;
}

function RegimeChip({ label }: { label: string }) {
  const { colors, typography: typo } = useTheme();
  return (
    <View
      style={[
        styles.chip,
        { backgroundColor: colors.surfaceSecondary, borderColor: colors.border },
      ]}
    >
      <Text
        numberOfLines={1}
        maxFontSizeMultiplier={MAX_CHIP_FONT_SCALE}
        style={[typo.small, { color: colors.textSecondary, flexShrink: 1, minWidth: 0 }]}
        ellipsizeMode="tail"
      >
        {label}
      </Text>
    </View>
  );
}

export function MarketRegimeCard({ regime, personas, dataLimited }: MarketRegimeCardProps) {
  const { colors, typography: typo } = useTheme();

  const recommended = useMemo(() => personas.filter((p) => p.recommended), [personas]);

  return (
    <Surface
      elevation={1}
      style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}
    >
      <View style={styles.headRow}>
        <View style={styles.headTitle}>
          <Feather name="compass" size={16} color={colors.primary} />
          <Text style={[typo.bodyMedium, { color: colors.text, marginLeft: spacing.xs }]}>
            현재 장 적합 persona
          </Text>
        </View>
        {dataLimited ? <DataLimitBadge /> : null}
      </View>

      {/* 현재 시장 레짐 칩 — 추천 근거 */}
      <View
        style={styles.chipRow}
        accessibilityRole="text"
        accessibilityLabel={`현재 장: ${TREND_LABEL[regime.trend]}, ${VOLATILITY_LABEL[regime.volatility]}, ${EVENT_SKEW_LABEL[regime.eventSkew]}`}
      >
        <RegimeChip label={TREND_LABEL[regime.trend]} />
        <RegimeChip label={VOLATILITY_LABEL[regime.volatility]} />
        <RegimeChip label={EVENT_SKEW_LABEL[regime.eventSkew]} />
      </View>

      {/* 추천 persona(1~2) + 근거 */}
      {recommended.length > 0 ? (
        <View style={styles.recBox}>
          {recommended.map((p) => (
            <View key={p.performance.style} style={styles.recRow}>
              <View style={styles.recHead}>
                <Feather name="star" size={13} color={colors.success} />
                <Text style={[typo.captionMedium, { color: colors.text, marginLeft: spacing.xs }]}>
                  {p.performance.label}
                </Text>
                <Text style={[typo.small, { color: colors.textTertiary, marginLeft: spacing.xs }]}>
                  적합도 {Math.round(p.regimeFitScore)}점
                </Text>
              </View>
              <Text style={[typo.small, { color: colors.textSecondary }]}>{p.rationale}</Text>
            </View>
          ))}
        </View>
      ) : (
        <Text style={[typo.small, { color: colors.textTertiary, marginTop: spacing.xs }]}>
          현재 장에 뚜렷이 앞서는 persona가 없습니다 — 비교 후 강조 기준을 골라보세요.
        </Text>
      )}

      <Text style={[typo.small, { color: colors.textTertiary, marginTop: spacing.sm }]}>
        결정론적 Rule 추천 · 참고용입니다(투자 권유 아님).
      </Text>
    </Surface>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: radius.lg,
    borderWidth: 1,
    padding: spacing.base,
    gap: spacing.sm,
  },
  headRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: spacing.sm,
  },
  headTitle: {
    flexDirection: 'row',
    alignItems: 'center',
    flexShrink: 1,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
  },
  chip: {
    borderRadius: radius.sm,
    borderWidth: 1,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs / 2,
  },
  recBox: {
    gap: spacing.sm,
  },
  recRow: {
    gap: 2,
  },
  recHead: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
  },
});
