import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Chip } from 'react-native-paper';
import { Feather } from '@expo/vector-icons';
import { useTheme, MAX_CHIP_FONT_SCALE } from '@theme';
import { spacing, radius } from '@theme/spacing';
import { EvidenceMeta } from '@components/common/EvidenceMeta';

import type {
  PersonaPhilosophyFusion,
  FusionConfidence,
  AiPersonaKey,
  PersonaViewLabel,
} from '@app-types/philosophy.types';

// P-C 결합(거장 철학 × AI 관점) 결과 리스트 — DAR-82.
// DAR-72 백엔드(persona-philosophy-fusion)의 결합점수·근거·표본·신뢰도를 노출한다.
// 결합점수는 순수 Rule(신규 AI 호출 0). 신뢰도는 AI 자기보고가 아니라 두 축 커버리지 Rule이므로
// EvidenceMeta의 'AI 신뢰도'를 쓰지 않고 별도 '결합 신뢰도' 평문 3단계로 표기한다(과신 방지, DAR-56).

const PERSONA_LABEL: Record<AiPersonaKey, string> = {
  CONSERVATIVE: '보수적',
  BALANCED: '균형',
  AGGRESSIVE: '공격적',
  EVENT_DRIVEN: '이벤트 중심',
};

const VIEW_LABEL: Record<PersonaViewLabel, string> = {
  POSITIVE: '긍정',
  WATCH: '관망',
  NEUTRAL: '중립',
  NEGATIVE: '부정',
};

interface ConfidenceStyle {
  label: string;
  icon: 'check-circle' | 'circle' | 'alert-circle';
  tone: 'high' | 'medium' | 'low';
}

function confidenceStyle(level: FusionConfidence['level']): ConfidenceStyle {
  if (level === 'HIGH') return { label: '높음', icon: 'check-circle', tone: 'high' };
  if (level === 'MEDIUM') return { label: '보통', icon: 'circle', tone: 'medium' };
  return { label: '낮음', icon: 'alert-circle', tone: 'low' };
}

interface FusionRowProps {
  fusion: PersonaPhilosophyFusion;
}

function FusionRow({ fusion }: FusionRowProps) {
  const { colors, typography: typo } = useTheme();
  const conf = confidenceStyle(fusion.confidence.level);
  const confColor =
    conf.tone === 'high'
      ? colors.success
      : conf.tone === 'low'
        ? colors.warning
        : colors.textSecondary;

  const scoreText = fusion.fusionScore != null ? `${Math.round(fusion.fusionScore)}` : '—';
  const barRatio = fusion.fusionScore != null ? Math.max(0, Math.min(1, fusion.fusionScore / 100)) : 0;
  const viewLabel = fusion.personaView.view ? VIEW_LABEL[fusion.personaView.view] : null;

  return (
    <View
      style={[styles.row, { borderTopColor: colors.borderLight }]}
      accessibilityLabel={
        `${fusion.investorName} 결합점수 ${fusion.computable ? scoreText + '점' : '산출 불가'}, ` +
        `대응 관점 ${PERSONA_LABEL[fusion.mappedPersona]}, 결합 신뢰도 ${conf.label}`
      }
    >
      <View style={styles.rowHeader}>
        <View style={styles.nameWrap}>
          <Text style={[typo.bodyMedium, { color: colors.text }]} numberOfLines={1}>
            {fusion.investorName}
          </Text>
          <Chip
            compact
            mode="flat"
            style={[styles.personaChip, { backgroundColor: colors.surfaceSecondary }]}
            textStyle={[typo.small, { color: colors.textSecondary }]}
            maxFontSizeMultiplier={MAX_CHIP_FONT_SCALE}
          >
            {`AI ${PERSONA_LABEL[fusion.mappedPersona]}`}
          </Chip>
        </View>
        <Text style={[typo.h3, { color: fusion.computable ? colors.primary : colors.textTertiary }]}>
          {fusion.computable ? scoreText : '산출 불가'}
        </Text>
      </View>

      {fusion.computable ? (
        <View style={[styles.barTrack, { backgroundColor: colors.surfaceSecondary }]}>
          <View
            style={[styles.barFill, { backgroundColor: colors.primary, width: `${barRatio * 100}%` }]}
          />
        </View>
      ) : null}

      {/* 축별 점수(철학 / AI 관점) */}
      <View style={styles.axisRow}>
        <Text style={[typo.small, { color: colors.textSecondary }]}>
          철학 적합도 {fusion.philosophyScore != null ? `${Math.round(fusion.philosophyScore)}점` : '결측'}
        </Text>
        <Text style={[typo.small, { color: colors.textSecondary }]}>
          AI 관점{viewLabel ? ` ${viewLabel}` : ''}{' '}
          {fusion.personaFitScore != null ? `${Math.round(fusion.personaFitScore)}점` : '결측'}
        </Text>
      </View>

      {/* 근거 평문(설명용) */}
      {fusion.basis.length > 0 ? (
        <View style={styles.basisWrap}>
          {fusion.basis.map((line, i) => (
            <View key={i} style={styles.basisRow}>
              <Feather name="corner-down-right" size={11} color={colors.textTertiary} />
              <Text style={[typo.small, styles.basisText, { color: colors.textSecondary }]}>{line}</Text>
            </View>
          ))}
        </View>
      ) : null}

      {/* AI 해석 스니펫(있으면) */}
      {fusion.personaView.available && fusion.personaView.interpretation ? (
        <Text style={[typo.small, { color: colors.textTertiary, marginTop: spacing.xs }]} numberOfLines={3}>
          {`"${fusion.personaView.interpretation}"`}
        </Text>
      ) : null}

      {/* 표본 + 결합 신뢰도(Rule, AI 자기보고 아님) */}
      <View style={styles.metaRow}>
        <EvidenceMeta compact sample={{ n: fusion.confidence.sampleCount }} />
        <View style={styles.confRow} accessibilityLabel={`결합 신뢰도 ${conf.label}`}>
          <Feather name={conf.icon} size={12} color={confColor} />
          <Text style={[typo.small, { color: confColor }]}>결합 신뢰도 {conf.label}</Text>
        </View>
      </View>
    </View>
  );
}

interface PersonaPhilosophyFusionListProps {
  fusions: PersonaPhilosophyFusion[];
  /** 상위 N건만 노출(기본 3). */
  limit?: number;
}

export function PersonaPhilosophyFusionList({ fusions, limit = 3 }: PersonaPhilosophyFusionListProps) {
  const visible = fusions.slice(0, limit);
  return (
    <View>
      {visible.map((f) => (
        <FusionRow key={f.philosophyId} fusion={f} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    paddingTop: spacing.md,
    marginTop: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  rowHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  nameWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    flex: 1,
  },
  personaChip: {
    alignSelf: 'flex-start',
  },
  barTrack: {
    height: 6,
    borderRadius: radius.full,
    marginTop: spacing.sm,
    overflow: 'hidden',
  },
  barFill: {
    height: 6,
    borderRadius: radius.full,
  },
  axisRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  basisWrap: {
    marginTop: spacing.sm,
    gap: spacing.xs,
  },
  basisRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.xs,
  },
  basisText: {
    flex: 1,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  confRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
});
