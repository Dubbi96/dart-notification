import React, { useCallback } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Surface, Chip, Banner } from 'react-native-paper';
import { Feather } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';

import { useTheme } from '@theme';
import { spacing, radius } from '@theme/spacing';
import { DisclaimerSection } from '@components/common/DisclaimerSection';
import { AiReferenceLabel } from '@components/common/AiReferenceLabel';
import { ScoreGauge } from '@components/common/ScoreGauge';
import { LoadingState, ErrorState } from '@components/common/StateView';
import { useSignalDetail } from '@hooks/useSignals';
import {
  gradeColor,
  gradeLabel,
  buyScoreColor,
} from '@utils/signalDisplay';

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
  const { data: signal, isLoading, isError, refetch } = useSignalDetail(id!);
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

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
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
          <ScoreGauge score={signal.buyScore} kind="buy" statusText={gradeLabel(signal.grade)} />
        </View>

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

      {/* DisclaimerSection — 화면 최하단 고정(§10-2: 스크롤 콘텐츠 아래 항상 표시) */}
      <DisclaimerSection style={styles.disclaimer} />
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
