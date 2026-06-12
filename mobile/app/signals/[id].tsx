import React, { useCallback } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Surface, Chip, Banner } from 'react-native-paper';
import { Feather } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { useTheme } from '@theme';
import { spacing, radius } from '@theme/spacing';
import { DisclaimerSection } from '@components/common/DisclaimerSection';
import { AiReferenceLabel } from '@components/common/AiReferenceLabel';
import { ProvenanceBar, relativeTime, type ProvenanceItem } from '@components/common/ProvenanceBar';
import { ScoreGauge } from '@components/common/ScoreGauge';
import { ScoreBreakdownSection } from '@components/signals/ScoreBreakdownSection';
import { EvidenceMeta } from '@components/common/EvidenceMeta';
import { isDataLimited } from '@utils/dataLimit';
import { LoadingState, ErrorState } from '@components/common/StateView';
import { useSignalDetail } from '@hooks/useSignals';
import {
  gradeColor,
  gradeLabel,
  buyScoreColor,
  scoreOneLiner,
} from '@utils/signalDisplay';
import { RISK_CONTEXT_NOTE } from '@utils/copy';

import type { EntryCondition, RiskFlag } from '@app-types/signal.types';

// 매수 후보 상세(기획 §3 SCR-SIGNAL-DETAIL). API 미존재 시 graceful null 처리.

function EntryConditionRow({ condition }: { condition: EntryCondition }) {
  const { colors, typography: typo } = useTheme();
  const metColor = condition.met
    ? colors.success
    : condition.required
      ? colors.error
      : colors.textTertiary;
  return (
    <View style={styles.conditionRow}>
      <Feather
        name={condition.met ? 'check-circle' : 'circle'}
        size={15}
        color={metColor}
      />
      <Text style={[typo.small, { color: colors.textSecondary, flex: 1 }]}>
        {condition.required ? '[필수] ' : '[선택] '}
        {condition.label}
      </Text>
    </View>
  );
}

function RiskFlagRow({ flag }: { flag: RiskFlag }) {
  const { colors, typography: typo } = useTheme();
  const color =
    flag.severity === 'high'
      ? colors.error
      : flag.severity === 'medium'
        ? colors.warning
        : colors.textSecondary;
  return (
    <View style={styles.riskRow}>
      <Feather name="alert-triangle" size={14} color={color} />
      <Text style={[typo.small, { color, flex: 1 }]}>{flag.label}</Text>
    </View>
  );
}

export default function SignalDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { colors, typography: typo } = useTheme();
  const { data: signal, isLoading, isError, refetch, isRefetching } = useSignalDetail(id!);
  const relatedRcpNo = signal?.relatedDisclosureRcpNo;

  const handleRelatedDisclosure = useCallback(() => {
    if (relatedRcpNo) {
      router.push(`/disclosure/${relatedRcpNo}`);
    }
  }, [relatedRcpNo]);

  if (isLoading) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={['top']}>
        <LoadingState message="신호를 불러오는 중…" />
      </SafeAreaView>
    );
  }

  if (isError) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={['top']}>
        <ErrorState title="신호를 불러오지 못했습니다." onRetry={refetch} />
      </SafeAreaView>
    );
  }

  if (!signal) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={['top']}>
        <View style={styles.header}>
          <TouchableOpacity
            onPress={() => router.back()}
            accessibilityRole="button"
            accessibilityLabel="뒤로 가기"
          >
            <Feather name="arrow-left" size={22} color={colors.text} />
          </TouchableOpacity>
          <Text style={[typo.h3, { color: colors.text, flex: 1, marginLeft: spacing.md }]}>
            매수 후보 상세
          </Text>
        </View>
        <View style={styles.emptyState}>
          <Feather name="zap-off" size={48} color={colors.textTertiary} />
          <Text style={[typo.bodyMedium, { color: colors.text, marginTop: spacing.md }]}>
            신호 정보를 찾을 수 없습니다.
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  const isExpired =
    signal.expiresAt ? new Date(signal.expiresAt) < new Date() : false;
  const scoreColor = buyScoreColor(signal.buyScore, colors);
  // 게이지 옆 표본 동반(DAR-56) — 통계 근거 항목 중 최대 표본수를 대표값으로 노출(과신 방지).
  const evidenceSampleN = (signal.scoreBreakdown ?? [])
    .map((c) => c.sampleN)
    .filter((n): n is number => typeof n === 'number' && n > 0)
    .reduce<number | undefined>((max, n) => (max === undefined ? n : Math.max(max, n)), undefined);

  // 위험 맥락 고지(§6) — riskFlags의 매핑 키 + 만료 임박을 면책 contextNotes로 승격(약화 아님, 추가만)
  const expiresSoon =
    signal.expiresAt && !isExpired
      ? new Date(signal.expiresAt).getTime() - new Date().getTime() < 1000 * 60 * 60 * 24
      : false;
  const contextNotes = [
    ...signal.riskFlags
      .map((f) => (f.key ? RISK_CONTEXT_NOTE[f.key] : undefined))
      .filter((n): n is string => Boolean(n)),
    ...(expiresSoon ? [RISK_CONTEXT_NOTE.EXPIRY_SOON] : []),
  ];

  // 출처·시점 바(§7) — 신호 생성 시점을 상시 노출. 백엔드 미존재 필드는 조건부 생략
  const provenanceItems: ProvenanceItem[] = signal.createdAt
    ? [{ icon: 'clock', label: `분석 ${relativeTime(signal.createdAt)}` }]
    : [];

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={['top']}>
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <TouchableOpacity
          onPress={() => router.back()}
          accessibilityRole="button"
          accessibilityLabel="뒤로 가기"
        >
          <Feather name="arrow-left" size={22} color={colors.text} />
        </TouchableOpacity>
        <Text style={[typo.h3, { color: colors.text, flex: 1, marginLeft: spacing.md }]}>
          매수 후보 상세
        </Text>
      </View>

      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={isRefetching}
            onRefresh={refetch}
            colors={[colors.primary]}
            tintColor={colors.primary}
          />
        }
      >
        {isExpired ? (
          <Banner
            visible
            actions={[]}
            icon={({ size }) => <Feather name="clock" size={size} color={colors.warning} />}
            style={[styles.banner, { backgroundColor: colors.surfaceSecondary }]}
          >
            <Text style={[typo.small, { color: colors.textSecondary }]}>
              유효 기간이 지난 신호입니다.
            </Text>
          </Banner>
        ) : null}

        {/* HeaderSection */}
        <View style={[styles.section, { opacity: isExpired ? 0.5 : 1 }]}>
          <View style={styles.titleRow}>
            <Text style={[typo.h2, { color: colors.text, flex: 1 }]}>
              {signal.corpName}
            </Text>
            <Chip
              compact
              mode="flat"
              style={[styles.gradeChip, { backgroundColor: colors.surfaceSecondary }]}
              textStyle={[typo.small, { color: gradeColor(signal.grade, colors), fontWeight: '700' }]}
            >
              {gradeLabel(signal.grade)}
            </Chip>
          </View>
          <View style={styles.scoreRow}>
            <Text style={[typo.h3, { color: scoreColor }]}>
              Buy Score: {signal.buyScore}
            </Text>
            {signal.expiresAt && !isExpired ? (
              <Text style={[typo.small, { color: colors.textTertiary }]}>
                유효: {new Date(signal.expiresAt).toLocaleDateString('ko-KR')} 까지
              </Text>
            ) : null}
          </View>
          <ScoreGauge
            score={signal.buyScore}
            kind="buy"
            statusText={gradeLabel(signal.grade)}
            oneLiner={scoreOneLiner(signal.buyScore, signal.grade)}
          />
          {evidenceSampleN !== undefined ? (
            <EvidenceMeta
              sample={{ n: evidenceSampleN, unit: '건' }}
              dataLimit={isDataLimited({ sampleCount: evidenceSampleN })}
              style={styles.gaugeEvidence}
            />
          ) : null}
        </View>

        {/* Score 근거 분해(P0-C) — HeaderSection 직후. scoreBreakdown 미연동 시 graceful null */}
        {signal.scoreBreakdown && signal.scoreBreakdown.length > 0 ? (
          <ScoreBreakdownSection
            totalScore={signal.buyScore}
            items={signal.scoreBreakdown.map((c) => ({
              id: c.key,
              label: c.label,
              score: c.score,
              maxContribution: c.max,
              sampleN: c.sampleN,
            }))}
          />
        ) : null}

        {/* 진입 조건 */}
        {signal.entryConditions.length > 0 ? (
          <Surface elevation={0} style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <Text style={[typo.captionMedium, { color: colors.textSecondary, marginBottom: spacing.sm }]}>
              ── 진입 조건 ──
            </Text>
            {signal.entryConditions.map((c) => (
              <EntryConditionRow key={c.id} condition={c} />
            ))}
          </Surface>
        ) : null}

        {/* 리스크 */}
        {signal.riskFlags.length > 0 ? (
          <Surface elevation={0} style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <Text style={[typo.captionMedium, { color: colors.textSecondary, marginBottom: spacing.sm }]}>
              ── 리스크 ──
            </Text>
            {signal.riskFlags.map((f) => (
              <RiskFlagRow key={f.id} flag={f} />
            ))}
          </Surface>
        ) : null}

        {/* AI 매수 근거 */}
        {signal.summary ? (
          <Surface elevation={0} style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <View style={styles.sectionTitleRow}>
              <Text style={[typo.captionMedium, { color: colors.textSecondary }]}>
                ── AI 매수 근거 ──
              </Text>
              <AiReferenceLabel />
            </View>
            {provenanceItems.length > 0 ? (
              <ProvenanceBar items={provenanceItems} style={{ marginTop: spacing.sm }} />
            ) : null}
            <Text style={[typo.body, { color: colors.text, marginTop: spacing.sm }]}>
              {signal.summary}
            </Text>
          </Surface>
        ) : null}

        {/* 관련 공시 */}
        {signal.relatedDisclosureRcpNo ? (
          <Surface elevation={0} style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <Text style={[typo.captionMedium, { color: colors.textSecondary, marginBottom: spacing.sm }]}>
              ── 관련 공시 ──
            </Text>
            <TouchableOpacity
              onPress={handleRelatedDisclosure}
              style={[styles.disclosureLink, { borderColor: colors.border }]}
              accessibilityRole="button"
              accessibilityLabel="관련 공시 보기"
            >
              <Feather name="file-text" size={18} color={colors.primary} />
              <Text style={[typo.captionMedium, { color: colors.primary, flex: 1 }]}>
                공시 상세 보기
              </Text>
              <Feather name="chevron-right" size={16} color={colors.textTertiary} />
            </TouchableOpacity>
          </Surface>
        ) : null}

        {/* 유효 기간 */}
        {signal.expiresAt ? (
          <View style={styles.expiryRow}>
            <Feather name="clock" size={13} color={colors.textTertiary} />
            <Text style={[typo.small, { color: colors.textTertiary }]}>
              {isExpired ? '만료됨' : `${new Date(signal.expiresAt).toLocaleString('ko-KR')} 만료`}
            </Text>
          </View>
        ) : null}
      </ScrollView>

      {/* DisclaimerSection — 화면 최하단 고정(§10-2). contextNotes는 면책 위에 추가만(§6) */}
      <DisclaimerSection style={styles.disclaimer} contextNotes={contextNotes} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
  },
  scroll: {
    padding: spacing.lg,
    gap: spacing.md,
    paddingBottom: spacing['2xl'],
  },
  section: {
    gap: spacing.sm,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  gradeChip: { height: 26 },
  scoreRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  gaugeEvidence: {
    marginTop: spacing.sm,
  },
  card: {
    borderRadius: radius.lg,
    borderWidth: 1,
    padding: spacing.base,
    gap: spacing.xs,
  },
  sectionTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  conditionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.xs,
  },
  riskRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.xs,
  },
  disclosureLink: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    padding: spacing.sm,
    borderRadius: radius.md,
    borderWidth: 1,
  },
  expiryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    justifyContent: 'flex-end',
  },
  disclaimer: { margin: spacing.lg },
  emptyState: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  banner: { borderRadius: radius.md },
});
