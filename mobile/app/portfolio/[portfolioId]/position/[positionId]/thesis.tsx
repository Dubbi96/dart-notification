import React, { useCallback } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Surface, Chip } from 'react-native-paper';
import { Feather } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';

import { useTheme } from '@theme';
import { spacing, radius } from '@theme/spacing';
import { DisclaimerSection } from '@components/common/DisclaimerSection';
import { LoadingState, ErrorState } from '@components/common/StateView';
import { usePositionThesis } from '@hooks/usePortfolio';
import { thesisStatusColor, thesisStatusLabel } from '@utils/signalDisplay';

import type { ThesisCondition } from '@app-types/portfolio.types';

// Thesis 상세(기획 §3 SCR-THESIS). 청산 룰은 읽기 전용 — 탭 시 설명 Alert.
// ACTIVE=teal 보더 / WATCHING=yellow / VIOLATED=red / EXPIRED=gray

function ConditionRow({ item, isViolation }: { item: ThesisCondition; isViolation: boolean }) {
  const { colors, typography: typo } = useTheme();
  const isViolated = isViolation && item.violated;

  const iconColor = isViolated ? colors.error : colors.success;
  const rowColor = isViolated ? colors.error : colors.text;
  return (
    <View style={styles.conditionRow}>
      <Feather
        name={item.violated ? (isViolation ? 'x-circle' : 'check-circle') : 'circle'}
        size={15}
        color={isViolated ? iconColor : colors.textTertiary}
        accessibilityLabel={
          isViolation
            ? `훼손 조건 ${item.violated ? '위반' : '미위반'}: ${item.label}`
            : `진입 논리 충족: ${item.label}`
        }
      />
      <Text style={[typo.small, { color: isViolated ? rowColor : colors.textSecondary, flex: 1 }]}>
        {item.label}
        {isViolated ? ' ← 위반' : ''}
      </Text>
    </View>
  );
}

export default function ThesisScreen() {
  const { positionId } = useLocalSearchParams<{
    positionId: string;
  }>();
  const { colors, typography: typo } = useTheme();
  const thesisQuery = usePositionThesis(positionId!);

  const handleReadonlyPress = useCallback(() => {
    Alert.alert(
      '편집 불가',
      '이 값은 시스템이 관리하는 안전 한도로 변경할 수 없습니다.',
      [{ text: '확인', style: 'cancel' }],
    );
  }, []);

  if (thesisQuery.isLoading) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={['top']}>
        <LoadingState message="Thesis를 불러오는 중…" />
      </SafeAreaView>
    );
  }

  if (thesisQuery.isError) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={['top']}>
        <ErrorState title="Thesis를 불러오지 못했습니다." onRetry={thesisQuery.refetch} />
      </SafeAreaView>
    );
  }

  const thesis = thesisQuery.data;
  const statusColor = thesis ? thesisStatusColor(thesis.status, colors) : colors.textTertiary;
  const borderColor = thesis ? thesisStatusColor(thesis.status, colors) : colors.border;

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
          Thesis
        </Text>
      </View>

      {!thesis ? (
        <View style={styles.emptyState}>
          <Feather name="file-text" size={48} color={colors.textTertiary} />
          <Text style={[typo.bodyMedium, { color: colors.text, marginTop: spacing.md }]}>
            Thesis 정보를 찾을 수 없습니다.
          </Text>
        </View>
      ) : (
        <>
        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
          {/* 상태 배지 + 헤더 */}
          <Surface
            elevation={0}
            style={[styles.card, { backgroundColor: colors.surface, borderColor, borderWidth: 2 }]}
          >
            <Chip
              compact
              mode="flat"
              style={{ backgroundColor: colors.surfaceSecondary, alignSelf: 'flex-start' }}
              textStyle={[typo.small, { color: statusColor, fontWeight: '700' }]}
              accessibilityLabel={`Thesis 상태: ${thesisStatusLabel(thesis.status)}`}
            >
              {thesisStatusLabel(thesis.status)}
            </Chip>
            <Text style={[typo.h3, { color: colors.text, marginTop: spacing.sm }]}>
              {thesis.corpName}
              {thesis.personaType ? `  ·  ${thesis.personaType}` : ''}
            </Text>
          </Surface>

          {/* 진입 논리 */}
          {thesis.entryLogic.length > 0 ? (
            <Surface elevation={0} style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              <Text style={[typo.captionMedium, { color: colors.textSecondary, marginBottom: spacing.sm }]}>
                ▌ 진입 논리
              </Text>
              {thesis.entryLogic.map((item) => (
                <ConditionRow key={item.id} item={item} isViolation={false} />
              ))}
            </Surface>
          ) : null}

          {/* 훼손 조건 */}
          {thesis.violationConditions.length > 0 ? (
            <Surface elevation={0} style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              <Text style={[typo.captionMedium, { color: colors.textSecondary, marginBottom: spacing.sm }]}>
                ▌ 훼손 조건
              </Text>
              {thesis.violationConditions.map((item) => (
                <ConditionRow key={item.id} item={item} isViolation />
              ))}
            </Surface>
          ) : null}

          {/* 청산 룰 (읽기 전용) */}
          <TouchableOpacity onPress={handleReadonlyPress} activeOpacity={0.85}
            accessibilityRole="button" accessibilityLabel="청산 룰 읽기 전용 — 탭하면 설명"
          >
            <Surface elevation={0} style={[styles.card, { backgroundColor: colors.surfaceSecondary, borderColor: colors.border }]}>
              <View style={styles.rowBetween}>
                <Text style={[typo.captionMedium, { color: colors.textSecondary }]}>
                  ▌ 청산 룰
                </Text>
                <View style={styles.readonlyTag}>
                  <Feather name="lock" size={11} color={colors.textTertiary} />
                  <Text style={[typo.small, { color: colors.textTertiary }]}>편집 불가</Text>
                </View>
              </View>
              <View style={[styles.ruleGrid, { marginTop: spacing.sm }]}>
                <View style={styles.ruleItem}>
                  <Text style={[typo.small, { color: colors.textSecondary }]}>손절</Text>
                  <Text style={[typo.bodyMedium, { color: colors.error }]}>
                    -{thesis.exitRules.stopLossPercent}%
                  </Text>
                </View>
                <View style={styles.ruleItem}>
                  <Text style={[typo.small, { color: colors.textSecondary }]}>분할익절</Text>
                  <Text style={[typo.bodyMedium, { color: colors.success }]}>
                    +{thesis.exitRules.takeProfitPercent}%
                  </Text>
                </View>
                <View style={styles.ruleItem}>
                  <Text style={[typo.small, { color: colors.textSecondary }]}>트레일링</Text>
                  <Text style={[typo.bodyMedium, { color: colors.text }]}>
                    고점 -{thesis.exitRules.trailingStopPercent}%
                  </Text>
                </View>
                <View style={styles.ruleItem}>
                  <Text style={[typo.small, { color: colors.textSecondary }]}>최대 보유</Text>
                  <Text style={[typo.bodyMedium, { color: colors.text }]}>
                    {thesis.exitRules.maxHoldingDays}거래일
                  </Text>
                </View>
              </View>
            </Surface>
          </TouchableOpacity>

          {/* 공시 트리거 */}
          {thesis.triggerDisclosureRcpNo ? (
            <TouchableOpacity
              onPress={() => router.push(`/disclosure/${thesis.triggerDisclosureRcpNo}`)}
              activeOpacity={0.8}
              accessibilityRole="button"
              accessibilityLabel="공시 트리거 보기"
            >
              <Surface elevation={0} style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                <View style={styles.rowBetween}>
                  <View style={{ gap: spacing.xs }}>
                    <Text style={[typo.captionMedium, { color: colors.textSecondary }]}>▌ 공시 트리거</Text>
                    <Text style={[typo.captionMedium, { color: colors.primary }]}>공시 상세 보기</Text>
                  </View>
                  <Feather name="chevron-right" size={18} color={colors.textTertiary} />
                </View>
              </Surface>
            </TouchableOpacity>
          ) : null}
        </ScrollView>
        {/* DisclaimerSection — 화면 최하단 고정(§10-2) */}
        <DisclaimerSection style={styles.disclaimer} />
        </>
      )}
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
  card: {
    borderRadius: radius.lg,
    borderWidth: 1,
    padding: spacing.base,
  },
  conditionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.xs,
  },
  rowBetween: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  readonlyTag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  ruleGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
  },
  ruleItem: {
    gap: spacing.xs,
    minWidth: 110,
  },
  emptyState: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  disclaimer: { margin: spacing.lg },
});
