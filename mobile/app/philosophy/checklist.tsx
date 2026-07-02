import React, { useMemo } from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { useTheme } from '@theme';
import { spacing } from '@theme/spacing';
import { Card } from '@components/common/Card';
import { DisclaimerSection } from '@components/common/DisclaimerSection';
import { ScreenHeader } from '@components/common/ScreenHeader';
import { LoadingState, EmptyState, ApiErrorState } from '@components/common/StateView';
import { PhilosophyChecklist } from '@components/philosophy/PhilosophyChecklist';
import { usePhilosophies, usePhilosophyFit } from '@hooks/usePhilosophies';
import type { Philosophy } from '@app-types/philosophy.types';

// "버핏이라면" 항목별 통과/미달 체크리스트 분해 화면 (DAR-57, 상용 패널 #4).
// 진입: 투자거장 화면(DAR-54) 종목 행 · 종목 상세 거장별 적합도 카드 → 탭.
// 쿼리 파라미터: id(철학) · corpCode(종목) · corpName(표시용). 게스트 열람 가능 · 참고용(면책).

export default function PhilosophyChecklistScreen() {
  const { id, corpCode, corpName } = useLocalSearchParams<{
    id: string;
    corpCode: string;
    corpName?: string;
  }>();
  const { colors, typography: typo } = useTheme();

  const { data: philosophies, isLoading: philLoading } = usePhilosophies();
  const philosophy = useMemo<Philosophy | undefined>(
    () => philosophies?.find((p) => p.philosophyId === id),
    [philosophies, id],
  );

  const {
    data: fitResult,
    isLoading: fitLoading,
    isError,
    error,
    refetch,
  } = usePhilosophyFit(id, corpCode);

  const title = philosophy ? `${philosophy.investorName} 체크리스트` : '체크리스트 분해';
  const isLoading = philLoading || fitLoading;

  let content: React.ReactNode;
  if (isLoading) {
    content = <LoadingState message="항목별 체크리스트를 분석하는 중…" />;
  } else if (isError) {
    content = (
      <ApiErrorState error={error} title="체크리스트를 불러오지 못했습니다." onRetry={refetch} />
    );
  } else if (!fitResult || fitResult.noFinancials || !fitResult.fit) {
    content = (
      <EmptyState
        icon="bar-chart-2"
        title="재무 데이터가 없어 평가할 수 없습니다."
        description={`${corpName ?? '이 종목'}의 재무제표가 수집되면 항목별 체크리스트를 표시합니다.`}
      />
    );
  } else {
    content = (
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scrollContent}>
        {corpName ? (
          <Text style={[typo.h3, { color: colors.text }]} numberOfLines={1}>
            {corpName}
          </Text>
        ) : null}
        <Text style={[typo.small, { color: colors.textSecondary, marginTop: spacing.xs }]}>
          {philosophy?.investorName ?? '이 거장'} 기준으로 본 항목별 통과/미달·미평가 근거입니다.
        </Text>

        <Card variant="elevated" style={styles.checklistCard}>
          <PhilosophyChecklist fit={fitResult.fit} checklistItems={philosophy?.checklistItems} />
        </Card>

        <DisclaimerSection style={styles.disclaimer} />
        <View style={{ height: spacing['2xl'] }} />
      </ScrollView>
    );
  }

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={['top']}>
      {/* 공용 ScreenHeader(L-5a A-1): 자체 헤더(Ionicons chevron-back + 좌측 제목) 드리프트 제거. */}
      <ScreenHeader title={title} onBack={() => router.back()} />
      <View style={styles.body}>{content}</View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  body: {
    flex: 1,
  },
  scrollContent: {
    padding: spacing.lg,
  },
  checklistCard: {
    marginTop: spacing.md,
    marginBottom: 0,
  },
  disclaimer: {
    marginTop: spacing.lg,
  },
});
