import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Surface, Chip } from 'react-native-paper';
import { Feather } from '@expo/vector-icons';
import { useTheme, MAX_CHIP_FONT_SCALE } from '@theme';
import { spacing, radius } from '@theme/spacing';
import { AiReferenceLabel } from '@components/common/AiReferenceLabel';
import { ProvenanceBar, relativeTime, type ProvenanceItem } from '@components/common/ProvenanceBar';
import { ApiErrorState } from '@components/common/StateView';
import { SkeletonBar, useSkeletonPulse } from '@components/common/SkeletonCard';
import { useDisclosureAnalysis } from '@hooks/useDisclosures';
import { getPolarityLabel } from '@utils/disclosureType';

import type {
  PersonaViewResult,
  PositionThesisResult,
  SummaryResult,
} from '@app-types/disclosure.types';

// 공시 상세 'AI 심층 분석' 섹션(Engine2 AI Analyst 실연동, DAR-102).
//  - useDisclosureAnalysis로 Summary·Persona 해석·Position Thesis를 노출(핵심 차별점 가시화).
//  - 3상태: 로딩(스켈레톤)·에러(ApiErrorState+재시도)·빈(분석 미생성 정직 안내).
//  - AI는 '참고 정보'(최종 판단은 사용자). 과신 방지 라벨·면책 상시. 읽기 전용.

const PERSONA_LABEL: Record<string, string> = {
  CONSERVATIVE: '보수적',
  BALANCED: '균형',
  AGGRESSIVE: '공격적',
  EVENT_DRIVEN: '이벤트 중심',
};

function personaLabel(persona: string): string {
  return PERSONA_LABEL[persona] ?? persona;
}

function polarityColor(
  polarity: string,
  colors: { success: string; error: string; textSecondary: string },
): string {
  if (polarity === 'POSITIVE') return colors.success;
  if (polarity === 'NEGATIVE') return colors.error;
  return colors.textSecondary;
}

function SectionFrame({ children }: { children: React.ReactNode }) {
  const { colors, typography: typo } = useTheme();
  return (
    <Surface
      elevation={0}
      style={[styles.section, { backgroundColor: colors.surface, borderColor: colors.border }]}
      accessibilityLabel="AI 심층 분석 섹션"
    >
      <View style={styles.header}>
        <View style={styles.titleRow}>
          <Feather name="cpu" size={16} color={colors.primary} />
          <Text
            style={[typo.captionMedium, { color: colors.text, marginLeft: spacing.xs }]}
            accessibilityRole="header"
          >
            AI 심층 분석
          </Text>
        </View>
        <AiReferenceLabel />
      </View>
      {children}
    </Surface>
  );
}

function LoadingSkeleton() {
  // 공용 펄스 훅(useSkeletonPulse)·외부 opacity 주입형 SkeletonBar 재사용 — 정본과 모션 일치(DAR-333).
  const opacity = useSkeletonPulse();
  const bar = (key: string, width: `${number}%`, mt: number = spacing.xs) => (
    <SkeletonBar key={key} width={width} height={12} opacity={opacity} style={{ marginTop: mt }} />
  );
  return (
    <View
      style={styles.skeleton}
      accessibilityRole="progressbar"
      accessibilityLabel="AI 분석 불러오는 중"
    >
      {bar('b1', '40%', spacing.sm)}
      {bar('b2', '100%')}
      {bar('b3', '90%')}
      {bar('b4', '60%')}
    </View>
  );
}

interface FactListProps {
  label: string;
  icon: keyof typeof Feather.glyphMap;
  color: string;
  items: string[];
}

function FactList({ label, icon, color, items }: FactListProps) {
  const { colors, typography: typo } = useTheme();
  if (!items.length) return null;
  return (
    <View style={styles.block}>
      <Text style={[typo.small, { color: colors.textSecondary, marginBottom: spacing.xs }]}>{label}</Text>
      {items.map((item, i) => (
        <View key={`${label}-${i}`} style={styles.factRow}>
          <Feather name={icon} size={13} color={color} style={styles.factIcon} />
          <Text style={[typo.caption, { color: colors.text, flex: 1 }]}>{item}</Text>
        </View>
      ))}
    </View>
  );
}

export function DisclosureAiAnalysisSection({ rcpNo }: { rcpNo: string }) {
  const { colors, typography: typo } = useTheme();
  const { data, isLoading, isError, error, refetch } = useDisclosureAnalysis(rcpNo);

  if (isLoading) {
    return (
      <SectionFrame>
        <LoadingSkeleton />
      </SectionFrame>
    );
  }

  if (isError) {
    return (
      <SectionFrame>
        <View style={styles.stateBox}>
          <ApiErrorState
            error={error}
            title="AI 분석을 불러오지 못했습니다"
            description="잠시 후 다시 시도해 주세요."
            onRetry={refetch}
          />
        </View>
      </SectionFrame>
    );
  }

  // 산출물 추출 — task 식별자는 Prisma enum(snake_case)로 내려온다.
  const summaryItem = data?.analyses.find((a) => a.task === 'summary');
  const personaItem = data?.analyses.find((a) => a.task === 'persona_interpretation');
  const thesisItem = data?.analyses.find((a) => a.task === 'position_thesis');

  const summary = summaryItem?.result as unknown as SummaryResult | undefined;

  // persona 해석은 analyses 항목(배열) 우선, 없으면 personaAnalysis(DAR-78 영속)로 폴백.
  const personaRaw = personaItem?.result ?? data?.personaAnalysis?.result;
  const personaViews: PersonaViewResult[] = Array.isArray(personaRaw)
    ? (personaRaw as unknown as PersonaViewResult[])
    : [];

  const thesis = thesisItem?.result as unknown as PositionThesisResult | undefined;

  const hasContent = !!summary || personaViews.length > 0 || !!thesis;

  // 빈 상태 — 분석 미생성 공시는 정직하게 안내(과신 방지).
  if (!hasContent) {
    return (
      <SectionFrame>
        <View style={styles.emptyBox}>
          <Feather name="cpu" size={36} color={colors.textTertiary} />
          <Text
            style={[typo.bodyMedium, { color: colors.text, marginTop: spacing.sm, textAlign: 'center' }]}
          >
            아직 AI 심층 분석이 없습니다
          </Text>
          <Text
            style={[
              typo.caption,
              { color: colors.textSecondary, marginTop: spacing.xs, textAlign: 'center' },
            ]}
          >
            AI 심층 분석은 비용 정책상 일부 공시(매수 후보 등)에만 생성됩니다.
          </Text>
        </View>
      </SectionFrame>
    );
  }

  const analyzedAt = summaryItem?.createdAt ?? personaItem?.createdAt ?? thesisItem?.createdAt;

  return (
    <SectionFrame>
      {analyzedAt ? (
        <ProvenanceBar
          items={[{ icon: 'clock', label: `분석 ${relativeTime(analyzedAt)}` }] as ProvenanceItem[]}
        />
      ) : null}

      {/* 요약(Summary) */}
      {summary ? (
        <View style={[styles.block, { marginTop: spacing.sm }]}>
          <View style={styles.blockHeader}>
            <Text style={[typo.captionMedium, { color: colors.text }]}>요약</Text>
            {summary.polarity ? (
              <View style={styles.polarityRow}>
                <Feather
                  name={
                    summary.polarity === 'POSITIVE'
                      ? 'trending-up'
                      : summary.polarity === 'NEGATIVE'
                        ? 'trending-down'
                        : 'minus'
                  }
                  size={13}
                  color={polarityColor(summary.polarity, colors)}
                />
                <Text
                  style={[
                    typo.small,
                    { color: polarityColor(summary.polarity, colors), marginLeft: spacing.xs },
                  ]}
                >
                  {getPolarityLabel(summary.polarity)}
                </Text>
              </View>
            ) : null}
          </View>
          {summary.summary ? (
            <Text style={[typo.caption, { color: colors.text, marginTop: spacing.xs, lineHeight: 20 }]}>
              {summary.summary}
            </Text>
          ) : null}
          <FactList
            label="긍정 요인 (참고)"
            icon="plus-circle"
            color={colors.success}
            items={Array.isArray(summary.positiveFactors) ? summary.positiveFactors : []}
          />
          <FactList
            label="부정 요인 (참고)"
            icon="alert-circle"
            color={colors.error}
            items={Array.isArray(summary.negativeFactors) ? summary.negativeFactors : []}
          />
        </View>
      ) : null}

      {/* Persona 해석(personaViews) */}
      {personaViews.length > 0 ? (
        <View style={[styles.block, { marginTop: spacing.md }]}>
          <Text style={[typo.captionMedium, { color: colors.text, marginBottom: spacing.xs }]}>
            투자 성향별 해석
          </Text>
          {personaViews.map((p, i) => (
            <View key={`${p.persona}-${i}`} style={styles.personaCard}>
              <View style={styles.personaHeader}>
                <Chip
                  compact
                  mode="flat"
                  // DAR-305: 고정 높이 칩 — OS 글꼴 확대 시 한글 받침 세로 클리핑 방지 배율 상한(DAR-174 정본).
                  maxFontSizeMultiplier={MAX_CHIP_FONT_SCALE}
                  style={[styles.personaChip, { backgroundColor: colors.surfaceSecondary }]}
                  textStyle={[typo.small, { color: colors.text }]}
                >
                  {personaLabel(p.persona)}
                </Chip>
                {typeof p.fitScore === 'number' ? (
                  <Text style={[typo.small, { color: colors.textSecondary }]}>
                    적합도 {Math.round(p.fitScore)} (참고)
                  </Text>
                ) : null}
              </View>
              {p.interpretation ? (
                <Text style={[typo.caption, { color: colors.text, marginTop: spacing.xs, lineHeight: 20 }]}>
                  {p.interpretation}
                </Text>
              ) : null}
            </View>
          ))}
        </View>
      ) : null}

      {/* Position Thesis (있으면) — L3 가설, 예시·참고 강조 */}
      {thesis ? (
        <View style={[styles.block, { marginTop: spacing.md }]}>
          <View style={styles.blockHeader}>
            <Text style={[typo.captionMedium, { color: colors.text }]}>포지션 논리</Text>
            <Chip
              compact
              mode="outlined"
              // DAR-305: 고정 높이 칩 — OS 글꼴 확대 시 한글 받침 세로 클리핑 방지 배율 상한(DAR-174 정본).
              maxFontSizeMultiplier={MAX_CHIP_FONT_SCALE}
              style={[styles.refChip, { borderColor: colors.border, backgroundColor: colors.surface }]}
              textStyle={[typo.small, { color: colors.textSecondary }]}
            >
              예시·참고
            </Chip>
          </View>
          {thesis.initialThesis ? (
            <Text style={[typo.caption, { color: colors.text, marginTop: spacing.xs, lineHeight: 20 }]}>
              {thesis.initialThesis}
            </Text>
          ) : null}
          <FactList
            label="훼손 조건 (참고)"
            icon="x-circle"
            color={colors.textSecondary}
            items={Array.isArray(thesis.invalidConditions) ? thesis.invalidConditions : []}
          />
          {thesis.riskNotes ? (
            <View style={styles.block}>
              <Text style={[typo.small, { color: colors.textSecondary, marginBottom: spacing.xs }]}>
                리스크 메모 (참고)
              </Text>
              <Text style={[typo.caption, { color: colors.text, lineHeight: 20 }]}>{thesis.riskNotes}</Text>
            </View>
          ) : null}
        </View>
      ) : null}

      {/* 면책 — AI는 참고 정보, 최종 판단은 사용자 */}
      <Text style={[typo.small, { color: colors.textTertiary, marginTop: spacing.md }]}>
        AI 심층 분석은 참고 정보이며, 최종 투자 판단과 책임은 투자자 본인에게 있습니다.
      </Text>
    </SectionFrame>
  );
}

const styles = StyleSheet.create({
  section: {
    marginTop: spacing.xl,
    borderRadius: radius.lg,
    borderWidth: 1,
    padding: spacing.base,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.xs,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  skeleton: {
    paddingVertical: spacing.sm,
  },
  stateBox: {
    minHeight: 220,
  },
  emptyBox: {
    alignItems: 'center',
    paddingVertical: spacing.xl,
  },
  block: {
    marginTop: spacing.sm,
  },
  blockHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  factRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginTop: spacing.xs,
  },
  factIcon: {
    marginTop: 2,
    marginRight: spacing.xs,
  },
  polarityRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  personaCard: {
    marginTop: spacing.sm,
  },
  personaHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  personaChip: {
    // DAR-305: 고정 height → minHeight. 캡된 큰 글꼴에서도 칩이 늘어나 받침이 잘리지 않는다(평시 동일).
    minHeight: 24,
  },
  refChip: {
    // DAR-305: 고정 height → minHeight. 캡된 큰 글꼴에서도 칩이 늘어나 받침이 잘리지 않는다(평시 동일).
    minHeight: 24,
  },
});
