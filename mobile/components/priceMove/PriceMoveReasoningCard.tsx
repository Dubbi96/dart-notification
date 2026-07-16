import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Surface } from 'react-native-paper';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '@theme';
import { spacing, radius } from '@theme/spacing';
import { DisclosureReactionSection } from '@components/disclosure/DisclosureReactionSection';
import { getEventTypeLabel } from '@utils/disclosureType';
import { formatReturnPct, returnColor } from '@utils/numberFormat';

import type {
  PriceMoveEventLinkage,
  PriceMoveReasoning,
  PriceMoveReasoningAnalyzed,
} from '@app-types/priceMove.types';

// '왜 움직였나' 카드 본문 (DAR-524, Wave C/C2). status 판별 유니온으로 3상태 분기(수용기준 1):
//  - ANALYZED    → 리즈닝 카드: 원인 해석 + 등락 방향/폭 + 근거 + 연관강도 + 한계고지 +
//                  유사공시 통계 섹션(DisclosureReactionSection 재사용, rcpNo 키).
//  - NO_DISCLOSURE → 무공시: '최근 48시간 관련 공시 없음' 정직 카피(분석 위장 금지).
//  - CAP_SKIPPED  → 오늘 원인 분석 한도 도달 정직 고지(분석 위장 금지).
// ★AI 금지영역 무접점: 출력은 설명(원인 해석·근거)뿐 — 매수/매도/보유·목표가·점수·주문 없음.
// 하드코딩 색 0(테마 토큰만) · 면책은 상위 화면 DisclaimerSection 이 고정.

/** 공시-등락 연관 강도 라벨(설명용 — 권고 아님). 아는 척 금지(WEAK/UNCLEAR 절제 표기). */
const LINKAGE_LABEL: Record<PriceMoveEventLinkage, string> = {
  STRONG: '연관성 강함',
  MODERATE: '연관성 보통',
  WEAK: '연관성 약함',
  UNCLEAR: '연관성 불명확',
};

/** 표시용 종목명 — 조인 corpName 우선, 없으면 종목코드. */
function displayName(reasoning: PriceMoveReasoning): string {
  return reasoning.corpName?.trim() || reasoning.stockCode;
}

/** 등락 방향/폭 헤드라인 — 부호·색·화살표로 방향을 명시(수용기준 1: 등락 방향). */
function MoveHeadline({ name, changePct }: { name: string; changePct: number }) {
  const { colors, typography: typo } = useTheme();
  const pctText = formatReturnPct(changePct);
  const pctColor = returnColor(changePct, colors);
  const up = changePct >= 0;
  return (
    <View
      style={styles.headline}
      accessible
      accessibilityRole="header"
      accessibilityLabel={`${name} ${pctText}`}
    >
      <Text style={[typo.bodyMedium, { color: colors.text }]} numberOfLines={1}>
        {name}
      </Text>
      <View style={styles.headlinePct}>
        <Feather
          name={up ? 'arrow-up-right' : 'arrow-down-right'}
          size={16}
          color={pctColor}
        />
        <Text style={[typo.h3, { color: pctColor, marginLeft: spacing.xs }]}>{pctText}</Text>
      </View>
    </View>
  );
}

/** 섹션 소제목(아이콘 + 라벨) — FiledFacts/AI/유사공시 섹션과 동일 규약. */
function SectionLabel({
  icon,
  label,
}: {
  icon: keyof typeof Feather.glyphMap;
  label: string;
}) {
  const { colors, typography: typo } = useTheme();
  return (
    <View style={styles.sectionLabel}>
      <Feather name={icon} size={14} color={colors.primary} />
      <Text
        style={[typo.captionMedium, { color: colors.text, marginLeft: spacing.xs }]}
        accessibilityRole="header"
      >
        {label}
      </Text>
    </View>
  );
}

/** ANALYZED — 원인 해석 카드 본문. */
function AnalyzedBody({
  reasoning,
  result,
}: {
  reasoning: PriceMoveReasoning;
  result: PriceMoveReasoningAnalyzed;
}) {
  const { colors, typography: typo } = useTheme();
  const linkageLabel = LINKAGE_LABEL[result.eventLinkage];
  const eventTypeLabel = getEventTypeLabel(result.eventType);

  return (
    <View>
      <Surface
        elevation={0}
        style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}
        accessibilityLabel="왜 움직였나 원인 해석"
      >
        <MoveHeadline name={displayName(reasoning)} changePct={reasoning.changePct} />

        {/* 이벤트 유형 + 연관 강도(설명용 칩) — 어떤 공시가 원인 후보인지·연관 절제 표기. */}
        <View style={styles.metaRow}>
          <View style={[styles.chip, { backgroundColor: colors.primaryLight }]}>
            <Text style={[typo.small, { color: colors.primary }]}>{eventTypeLabel}</Text>
          </View>
          <View style={[styles.chip, { backgroundColor: colors.surfaceSecondary }]}>
            <Text style={[typo.small, { color: colors.textSecondary }]}>{linkageLabel}</Text>
          </View>
        </View>

        {/* 원인 해석(설명층 한정). */}
        <SectionLabel icon="help-circle" label="원인 해석" />
        <Text style={[typo.body, styles.cause, { color: colors.text }]}>{result.cause}</Text>

        {/* 근거 목록 — 공시 이벤트·유사사례 통계 인용. */}
        {result.evidence.length > 0 ? (
          <View style={styles.block}>
            <SectionLabel icon="list" label="근거" />
            {result.evidence.map((ev, idx) => (
              <View key={`${idx}-${ev}`} style={styles.evidenceRow}>
                <Feather
                  name="chevron-right"
                  size={13}
                  color={colors.textTertiary}
                  style={styles.evidenceBullet}
                />
                <Text style={[typo.small, styles.evidenceText, { color: colors.textSecondary }]}>
                  {ev}
                </Text>
              </View>
            ))}
          </View>
        ) : null}

        {/* 한계 고지(정직) — 상관≠인과·시장/수급 요인 가능성. */}
        {result.caveat.trim().length > 0 ? (
          <View style={[styles.caveatRow, { borderTopColor: colors.borderLight }]}>
            <Feather name="alert-triangle" size={13} color={colors.textTertiary} />
            <Text style={[typo.small, styles.caveatText, { color: colors.textTertiary }]}>
              {result.caveat}
            </Text>
          </View>
        ) : null}
      </Surface>

      {/* 유사공시 통계 섹션 재사용(수용기준 1) — 원인 공시의 rcpNo 로 과거 반응·표본수(n) 노출.
          자체 3상태(정상/표본부족/API실패)·면책을 내장한다. */}
      {reasoning.rcpNo ? <DisclosureReactionSection rcpNo={reasoning.rcpNo} /> : null}
    </View>
  );
}

/** 무공시/스킵 정직 카드 — 분석 위장 금지(아이콘 + 제목 + 사유 1줄). */
function HonestNotice({
  icon,
  title,
  description,
}: {
  icon: keyof typeof Feather.glyphMap;
  title: string;
  description: string;
}) {
  const { colors, typography: typo } = useTheme();
  return (
    <Surface
      elevation={0}
      style={[styles.card, styles.noticeCard, { backgroundColor: colors.surface, borderColor: colors.border }]}
      accessible
      accessibilityLabel={`${title}. ${description}`}
    >
      <Feather name={icon} size={28} color={colors.textTertiary} />
      <Text style={[typo.bodyMedium, styles.noticeTitle, { color: colors.text }]}>{title}</Text>
      <Text style={[typo.small, styles.noticeDesc, { color: colors.textSecondary }]}>
        {description}
      </Text>
    </Surface>
  );
}

export function PriceMoveReasoningCard({ reasoning }: { reasoning: PriceMoveReasoning }) {
  const result = reasoning.resultJson;

  switch (result.status) {
    case 'ANALYZED':
      return <AnalyzedBody reasoning={reasoning} result={result} />;
    case 'NO_DISCLOSURE':
      return (
        <HonestNotice
          icon="file-minus"
          title="최근 48시간 관련 공시 없음"
          description="이 급변동을 설명할 공시가 최근 48시간 내 확인되지 않았습니다. 시장·수급 등 다른 요인일 수 있어, 없는 원인을 지어내지 않습니다."
        />
      );
    case 'CAP_SKIPPED':
      return (
        <HonestNotice
          icon="clock"
          title="오늘 원인 분석 한도에 도달했습니다"
          description="오늘 원인 분석 예산을 모두 사용해 이 급변동은 분석하지 못했습니다. 추정으로 지어내지 않고 있는 그대로 알려드립니다."
        />
      );
    default:
      return null;
  }
}

const styles = StyleSheet.create({
  card: {
    borderRadius: radius.lg,
    borderWidth: 1,
    padding: spacing.base,
  },
  noticeCard: {
    alignItems: 'center',
    paddingVertical: spacing.xl,
  },
  headline: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  headlinePct: {
    flexDirection: 'row',
    alignItems: 'center',
    marginLeft: spacing.sm,
  },
  metaRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
    marginTop: spacing.sm,
    marginBottom: spacing.md,
  },
  chip: {
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs / 2,
    borderRadius: radius.sm,
  },
  sectionLabel: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacing.xs,
  },
  cause: {
    lineHeight: 22,
  },
  block: {
    marginTop: spacing.md,
  },
  evidenceRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginTop: spacing.xs,
  },
  evidenceBullet: {
    marginTop: 2,
    marginRight: spacing.xs,
  },
  evidenceText: {
    flex: 1,
  },
  caveatRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.xs,
    marginTop: spacing.md,
    paddingTop: spacing.md,
    borderTopWidth: 1,
  },
  caveatText: {
    flex: 1,
  },
  noticeTitle: {
    marginTop: spacing.md,
    textAlign: 'center',
  },
  noticeDesc: {
    marginTop: spacing.xs,
    textAlign: 'center',
    lineHeight: 20,
  },
});
