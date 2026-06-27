import React, { useCallback, useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from 'react-native';
import { Chip } from 'react-native-paper';
import { Feather } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useTheme, MAX_CHIP_FONT_SCALE } from '@theme';
import { spacing, radius } from '@theme/spacing';
import { Card } from '@components/common/Card';
import { EmptyState, ErrorState } from '@components/common/StateView';
import { DetailSkeleton } from '@components/common/DetailSkeleton';
import { DisclaimerSection } from '@components/common/DisclaimerSection';
import { ScoreGauge } from '@components/common/ScoreGauge';
import { EvidenceMeta } from '@components/common/EvidenceMeta';
import { AiReferenceLabel } from '@components/common/AiReferenceLabel';
import { ProvenanceBar, relativeTime, type ProvenanceItem } from '@components/common/ProvenanceBar';
import { OfflineStaleLabel } from '@components/common/OfflineStaleLabel';
import { PhilosophyFitBreakdown } from '@components/philosophy/PhilosophyFitBreakdown';
import { PersonaPhilosophyFusionList } from '@components/company/PersonaPhilosophyFusionList';
import { useCompanyDetail } from '@hooks/useCompanyDetail';
import { useDisclosureEvent } from '@hooks/useDisclosures';
import { useCompanyBuySignal } from '@hooks/useSignals';
import { useCompanyPhilosophyFit, useCompanyPersonaPhilosophyFusion } from '@hooks/usePhilosophies';
import { getEventTypeLabel, getPolarityLabel, getTypeLabel } from '@utils/disclosureType';
import { gradeLabel, scoreOneLiner } from '@utils/signalDisplay';
import { extractKeyFigures } from '@utils/keyFigures';
import { formatYmdDots } from '@utils/datetime';

import type { BuyScoreComponent } from '@app-types/signal.types';

// DAR-59 종목 의사결정 허브 — company/[corpCode] '판단' 탭.
// 흩어진 데이터(공시·AI·BuyScore·거장 적합도)를 '한 종목=한 의사결정 캔버스'로 응집한다.
// 위→아래 누적: ①최신 핵심공시 ②AI 분석 ③BuyScore ④거장 적합도 ⑤모의매수 CTA.
// 신호/재무 결측 종목은 섹션별 graceful 부분노출 — 한 섹션이 비어도 캔버스는 렌더된다.
// collapsed 헤더 + 탭 펼침으로 밀도·가독성 양립. 하단 면책 고정. AI/점수는 모두 참고용.

function polarityColor(
  polarity: string,
  colors: { success: string; error: string; textSecondary: string },
): string {
  if (polarity === 'POSITIVE') return colors.success;
  if (polarity === 'NEGATIVE') return colors.error;
  return colors.textSecondary;
}

function polarityIcon(polarity: string): keyof typeof Feather.glyphMap {
  if (polarity === 'POSITIVE') return 'trending-up';
  if (polarity === 'NEGATIVE') return 'trending-down';
  return 'minus';
}

interface CollapsibleSectionProps {
  icon: keyof typeof Feather.glyphMap;
  title: string;
  /** 접힘 상태에서도 항상 보이는 한 줄 요약(밀도 + 한눈 파악). */
  summary?: string;
  defaultExpanded?: boolean;
  children: React.ReactNode;
}

function CollapsibleSection({
  icon,
  title,
  summary,
  defaultExpanded = false,
  children,
}: CollapsibleSectionProps) {
  const { colors, typography: typo } = useTheme();
  const [expanded, setExpanded] = useState(defaultExpanded);
  const toggle = useCallback(() => setExpanded((v) => !v), []);

  return (
    <Card variant="elevated" style={styles.sectionCard}>
      <TouchableOpacity
        activeOpacity={0.7}
        onPress={toggle}
        style={styles.sectionHeader}
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        accessibilityLabel={`${title}${summary ? `, ${summary}` : ''}, ${expanded ? '펼침' : '접힘'}`}
      >
        <Feather name={icon} size={16} color={colors.primary} />
        <View style={styles.sectionTitleWrap}>
          <Text style={[typo.bodyMedium, { color: colors.text }]} numberOfLines={1}>
            {title}
          </Text>
          {summary && !expanded ? (
            <Text style={[typo.small, { color: colors.textSecondary }]} numberOfLines={1}>
              {summary}
            </Text>
          ) : null}
        </View>
        <Feather
          name={expanded ? 'chevron-up' : 'chevron-down'}
          size={18}
          color={colors.textTertiary}
        />
      </TouchableOpacity>
      {expanded ? <View style={styles.sectionBody}>{children}</View> : null}
    </Card>
  );
}

/** 결측 섹션 안내 — 데이터 없을 때 접힘 헤더 아래 평문 1줄(과장 없는 중립 표기). */
function MissingNote({ text }: { text: string }) {
  const { colors, typography: typo } = useTheme();
  return (
    <View style={styles.missingRow} accessibilityLabel={text}>
      <Feather name="minus-circle" size={13} color={colors.textTertiary} />
      <Text style={[typo.small, { color: colors.textTertiary, flex: 1 }]}>{text}</Text>
    </View>
  );
}

interface DecisionHubTabProps {
  corpCode: string;
}

export function DecisionHubTab({ corpCode }: DecisionHubTabProps) {
  const { colors, typography: typo } = useTheme();

  const { data: company, isLoading, isError, refetch } = useCompanyDetail(corpCode);
  const latestDisclosure = company?.recentDisclosures?.[0];
  const latestRcpNo = latestDisclosure?.rcpNo ?? '';

  const { data: disclosureEvent } = useDisclosureEvent(latestRcpNo);
  const { data: buySignal, dataUpdatedAt: buyUpdatedAt } = useCompanyBuySignal(corpCode);
  const { data: philosophyFit } = useCompanyPhilosophyFit(corpCode);
  const { data: fusion } = useCompanyPersonaPhilosophyFusion(corpCode);

  const keyFigures = useMemo(
    () => extractKeyFigures(disclosureEvent?.extractedData),
    [disclosureEvent],
  );

  const topBreakdown = useMemo<BuyScoreComponent[]>(() => {
    if (!buySignal?.scoreBreakdown) return [];
    return [...buySignal.scoreBreakdown].sort((a, b) => b.score - a.score).slice(0, 3);
  }, [buySignal]);

  // 로딩도 화면 진입 스켈레톤(DetailSkeleton)으로 통일 — 탭 전환 시 중앙 스피너 →
  // 콘텐츠 점프를 제거(E17·DAR-467). 카드 골격은 판단 캔버스의 누적 섹션
  // (공시 칩·AI 분석·BuyScore 게이지·거장 적합도·결합)을 위→아래로 흉내 낸다.
  if (isLoading)
    return (
      <DetailSkeleton
        cards={[
          { chip: true, lines: 2 },
          { lines: 2 },
          { gauge: true, lines: 3 },
          { lines: 2 },
          { lines: 2 },
        ]}
      />
    );
  if (isError)
    return (
      <ErrorState
        title="판단 데이터를 불러오지 못했습니다"
        description="잠시 후 다시 시도해 주세요."
        onRetry={refetch}
      />
    );
  if (!company)
    return (
      <EmptyState
        icon="compass"
        title="종목 정보를 찾을 수 없습니다."
        description="기업 정보가 수집되면 판단 캔버스를 표시합니다."
      />
    );

  const fits = philosophyFit?.fits ?? [];
  const philosophyBasis = philosophyFit?.financialBasis;
  const buySampleN = topBreakdown.find((c) => c.sampleN != null)?.sampleN;

  const fusions = fusion?.fusions ?? [];
  const computableFusions = fusions.filter((f) => f.computable);
  const topFusion = computableFusions[0];

  return (
    <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
      {/* ① 최신 핵심공시 — 이벤트 분류 · 극성(DisclosureEvent) */}
      <CollapsibleSection
        icon="file-text"
        title="최신 핵심공시"
        summary={
          latestDisclosure
            ? disclosureEvent
              ? `${getEventTypeLabel(disclosureEvent.eventType)} · ${getPolarityLabel(disclosureEvent.polarity)}`
              : getTypeLabel(latestDisclosure.disclosureType)
            : '최근 공시 없음'
        }
        defaultExpanded
      >
        {latestDisclosure ? (
          <TouchableOpacity
            activeOpacity={0.7}
            onPress={() => router.push(`/disclosure/${latestDisclosure.rcpNo}`)}
            accessibilityRole="button"
            accessibilityLabel={`공시 상세 보기: ${latestDisclosure.reportName}`}
          >
            <View style={styles.rowBetween}>
              <Chip
                compact
                mode="flat"
                style={[styles.chip, { backgroundColor: colors.surfaceSecondary }]}
                textStyle={[typo.small, { color: colors.textSecondary }]}
                maxFontSizeMultiplier={MAX_CHIP_FONT_SCALE}
              >
                {getTypeLabel(latestDisclosure.disclosureType)}
              </Chip>
              <Text style={[typo.small, { color: colors.textTertiary }]}>
                {formatYmdDots(latestDisclosure.rcpDt)}
              </Text>
            </View>
            <Text style={[typo.body, { color: colors.text, marginTop: spacing.sm }]} numberOfLines={2}>
              {latestDisclosure.reportName}
            </Text>

            {disclosureEvent ? (
              <View style={styles.eventMeta}>
                <View style={styles.metaItem}>
                  <Text style={[typo.small, { color: colors.textSecondary }]}>이벤트 분류</Text>
                  <Text style={[typo.captionMedium, { color: colors.text }]}>
                    {getEventTypeLabel(disclosureEvent.eventType)}
                  </Text>
                </View>
                <View style={styles.metaItem}>
                  <Text style={[typo.small, { color: colors.textSecondary }]}>극성</Text>
                  <View style={styles.polarityRow}>
                    <Feather
                      name={polarityIcon(disclosureEvent.polarity)}
                      size={14}
                      color={polarityColor(disclosureEvent.polarity, colors)}
                    />
                    <Text
                      style={[
                        typo.captionMedium,
                        { color: polarityColor(disclosureEvent.polarity, colors), marginLeft: spacing.xs },
                      ]}
                    >
                      {getPolarityLabel(disclosureEvent.polarity)}
                    </Text>
                  </View>
                </View>
              </View>
            ) : (
              <MissingNote text="이 공시의 AI 이벤트 분류가 아직 없습니다." />
            )}
          </TouchableOpacity>
        ) : (
          <MissingNote text="최근 공시가 없습니다." />
        )}
      </CollapsibleSection>

      {/* ② AI 분석 요약 — 있으면(ProvenanceBar + DAR-56 신뢰도) */}
      <CollapsibleSection
        icon="cpu"
        title="AI 분석 요약"
        summary={disclosureEvent ? '최신 공시 AI 분석' : '분석 없음'}
        defaultExpanded={!!disclosureEvent}
      >
        {disclosureEvent ? (
          <>
            <View style={styles.rowBetween}>
              <AiReferenceLabel />
              {disclosureEvent.extractedAt ? (
                <ProvenanceBar
                  items={
                    [{ icon: 'clock', label: `분석 ${relativeTime(disclosureEvent.extractedAt)}` }] as ProvenanceItem[]
                  }
                />
              ) : null}
            </View>

            {keyFigures.length > 0 ? (
              <View style={styles.keyFigures}>
                {keyFigures.map((fig) => (
                  <View key={fig.key} style={styles.rowBetween}>
                    <Text style={[typo.small, { color: colors.textSecondary }]}>{fig.label}</Text>
                    <Text style={[typo.captionMedium, { color: colors.text }]}>{fig.display}</Text>
                  </View>
                ))}
              </View>
            ) : (
              <MissingNote text="추출된 핵심 수치가 없습니다." />
            )}

            {/* DAR-56 신뢰도 — 맨퍼센트 금지: 3단계 평문 + 'AI 자기보고 한계' 주석 */}
            <EvidenceMeta
              style={styles.evidence}
              ai={{ confidence: disclosureEvent.confidence, isAiAssisted: disclosureEvent.isAiAssisted }}
            />
          </>
        ) : (
          <MissingNote text="이 종목의 AI 분석 결과가 아직 없습니다." />
        )}
      </CollapsibleSection>

      {/* ③ BuyScore 게이지 + ScoreBreakdown 상위3 + 표본(EvidenceMeta) */}
      <CollapsibleSection
        icon="activity"
        title="Buy Score"
        summary={buySignal ? `${buySignal.buyScore}점 · ${gradeLabel(buySignal.grade)}` : '신호 없음'}
        defaultExpanded={!!buySignal}
      >
        {buySignal ? (
          <>
            <ScoreGauge
              score={buySignal.buyScore}
              kind="buy"
              statusText={gradeLabel(buySignal.grade)}
              oneLiner={scoreOneLiner(buySignal.buyScore, buySignal.grade)}
            />

            {/* DAR-173: 오프라인 시 점수의 마지막 갱신 경과 표식(stale 옛값 오인 방지). */}
            <OfflineStaleLabel updatedAt={buyUpdatedAt} style={styles.staleLabel} />

            {topBreakdown.length > 0 ? (
              <View style={styles.breakdown}>
                <Text style={[typo.small, { color: colors.textSecondary, marginBottom: spacing.xs }]}>
                  점수 기여 상위 {topBreakdown.length}
                </Text>
                {topBreakdown.map((c) => (
                  <View key={c.key} style={styles.rowBetween}>
                    <Text style={[typo.small, { color: colors.textSecondary, flex: 1 }]} numberOfLines={1}>
                      {c.label}
                    </Text>
                    <Text style={[typo.captionMedium, { color: colors.text }]}>
                      {c.score}/{c.max}
                    </Text>
                  </View>
                ))}
              </View>
            ) : null}

            {buySampleN != null ? (
              <EvidenceMeta style={styles.evidence} sample={{ n: buySampleN }} />
            ) : null}

            <View style={styles.aiFooter}>
              <AiReferenceLabel />
            </View>
          </>
        ) : (
          <MissingNote text="이 종목의 매수 신호가 아직 없습니다." />
        )}
      </CollapsibleSection>

      {/* ④ 거장별 철학 적합도(DAR-54/57 재사용) + 체크리스트 진입 */}
      <CollapsibleSection
        icon="award"
        title="거장 적합도"
        summary={
          philosophyFit?.noFinancials || fits.length === 0
            ? '재무 결측'
            : `${fits[0].investorName} 등 ${fits.length}인`
        }
        defaultExpanded={fits.length > 0}
      >
        {philosophyFit?.noFinancials || fits.length === 0 ? (
          <MissingNote text="재무 데이터가 아직 없어 거장 적합도를 평가할 수 없습니다." />
        ) : (
          <>
            {philosophyBasis ? (
              <Text style={[typo.small, { color: colors.textSecondary, marginBottom: spacing.sm }]}>
                {philosophyBasis.bsnsYear}년 {philosophyBasis.fsDiv} 재무 기준 · 점수 높은 순
              </Text>
            ) : null}
            {fits.slice(0, 3).map((fit) => (
              <TouchableOpacity
                key={fit.philosophyId}
                activeOpacity={0.8}
                onPress={() =>
                  router.push({
                    pathname: '/philosophy/checklist',
                    params: { id: fit.philosophyId, corpCode, corpName: company.corpName },
                  })
                }
                accessibilityRole="button"
                accessibilityLabel={`${fit.investorName} 항목별 체크리스트 분해 보기`}
                style={styles.fitRow}
              >
                <View style={styles.rowBetween}>
                  <Text style={[typo.bodyMedium, { color: colors.text }]}>{fit.investorName}</Text>
                  <Feather name="chevron-right" size={16} color={colors.textTertiary} />
                </View>
                <View style={{ marginTop: spacing.sm }}>
                  <PhilosophyFitBreakdown fit={fit} showBreakdown={false} />
                </View>
              </TouchableOpacity>
            ))}
          </>
        )}
      </CollapsibleSection>

      {/* ⑤ P-C 결합 — 거장 철학(Rule) × AI 관점 결합점수·근거·표본·신뢰도(DAR-72/82) */}
      <CollapsibleSection
        icon="git-merge"
        title="거장철학 × AI 결합"
        summary={
          topFusion
            ? `${topFusion.investorName} ${Math.round(topFusion.fusionScore ?? 0)}점 등 ${computableFusions.length}건`
            : '결합 결과 없음'
        }
        defaultExpanded={computableFusions.length > 0}
      >
        {computableFusions.length > 0 ? (
          <>
            {fusion?.aiBasis || fusion?.financialBasis ? (
              <Text style={[typo.small, { color: colors.textSecondary, marginBottom: spacing.xs }]}>
                거장 철학(Rule) × 저장된 AI 관점 결합 · 결합점수 높은 순
              </Text>
            ) : null}
            <PersonaPhilosophyFusionList fusions={computableFusions} />
            <View style={styles.aiFooter}>
              <AiReferenceLabel />
            </View>
          </>
        ) : (
          <MissingNote
            text={
              fusion?.noFinancials
                ? '재무 데이터가 아직 없어 거장철학×AI 결합을 산출할 수 없습니다.'
                : 'AI 관점 또는 철학 적합도가 아직 없어 결합 결과가 없습니다.'
            }
          />
        )}
      </CollapsibleSection>

      {/* ⑥ CTA "모의 매수 검토" — 현 모의운용 연계(실주문 아님) */}
      <TouchableOpacity
        activeOpacity={0.85}
        onPress={() => router.push('/(tabs)/portfolio')}
        style={[styles.cta, { backgroundColor: colors.primary }]}
        accessibilityRole="button"
        accessibilityLabel="모의 매수 검토 — 모의운용으로 이동(실제 주문 아님)"
      >
        <Feather name="clipboard" size={18} color={colors.textInverse} />
        <Text style={[typo.bodyMedium, { color: colors.textInverse, marginLeft: spacing.sm }]}>
          모의 매수 검토
        </Text>
      </TouchableOpacity>
      <Text style={[typo.small, { color: colors.textTertiary, textAlign: 'center', marginTop: spacing.xs }]}>
        모의운용으로 이동합니다 — 실제 주문이 아닙니다.
      </Text>

      {/* 하단 면책 고정 */}
      <DisclaimerSection style={styles.disclaimer} />
      <View style={{ height: spacing['2xl'] }} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.base,
  },
  sectionCard: {
    marginBottom: spacing.base,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    minHeight: 44,
  },
  sectionTitleWrap: {
    flex: 1,
  },
  sectionBody: {
    marginTop: spacing.md,
  },
  rowBetween: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    paddingVertical: spacing.xs,
  },
  chip: {
    alignSelf: 'flex-start',
  },
  eventMeta: {
    marginTop: spacing.md,
    gap: spacing.xs,
  },
  metaItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  polarityRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  keyFigures: {
    marginTop: spacing.md,
  },
  evidence: {
    marginTop: spacing.md,
  },
  staleLabel: {
    marginTop: spacing.sm,
  },
  breakdown: {
    marginTop: spacing.md,
  },
  aiFooter: {
    marginTop: spacing.md,
    flexDirection: 'row',
  },
  fitRow: {
    paddingVertical: spacing.sm,
  },
  missingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  cta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.md,
    borderRadius: radius.md,
    marginTop: spacing.sm,
    minHeight: 48,
  },
  disclaimer: {
    marginTop: spacing.lg,
  },
});
