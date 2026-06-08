import React, { useCallback } from 'react';
import { View, Text, FlatList, StyleSheet, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Surface, Banner } from 'react-native-paper';
import { Feather } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useTheme } from '@theme';
import { spacing, radius } from '@theme/spacing';
import { SkeletonList } from '@components/common/SkeletonCard';
import { EmptyState, ApiErrorState } from '@components/common/StateView';
import { MarketRegimeCard } from '@components/persona/MarketRegimeCard';
import { PersonaSelectCard } from '@components/persona/PersonaSelectCard';
import { usePersonaOverview } from '@hooks/usePersonaOverview';
import { usePersonaStore } from '@stores/personaStore';

import type { PhilosophyStyle } from '@app-types/style-comparison.types';
import type { PersonaOverview, PersonaOverviewRow } from '@app-types/persona.types';

// 자동매매 persona 선택 화면 — DAR-131 (P-D).
// 4 거장 철학 카드(스타일·성과 수치·현재 장 적합도·추천 배지)에서 모의운용 persona를 고른다.
// 추천우선→비교 패턴: 상단 '현재 장 적합 persona' 추천 카드 + 복합점수 내림차순 카드 리스트.
// 선택은 Zustand 영속(secure-store). ★ M11+ 정책: '모의/선택'까지만 — 실주문/자동매매 실행 UI 없음.
// ★ 신뢰: 과신 카피 금지·참고 라벨 상시·표본<30 DataLimitBadge·refreshControl 커스텀 래퍼 금지.

function PersonaListHeader({ data }: { data: PersonaOverview }) {
  const { colors, typography: typo } = useTheme();
  return (
    <View style={styles.headerBox}>
      {/* M11+ 정책 정직 고지 — 선택은 모의운용 한정, 실행 승인 UI 없음 */}
      <Banner
        visible
        actions={[]}
        icon="information"
        style={[styles.banner, { backgroundColor: colors.surfaceSecondary }]}
      >
        <Text style={[typo.small, { color: colors.info }]}>
          모의운용 persona 선택입니다 — 실제 주문·자동매매는 실행되지 않습니다(M11+ 정책). 선택은
          전략 비교·모의 운용 표시 용도이며, 실주문은 별도 사용자 승인 단계가 필요합니다.
        </Text>
      </Banner>

      <MarketRegimeCard regime={data.regime} personas={data.personas} dataLimited={data.dataLimited} />

      <View style={styles.compareLabel}>
        <Feather name="bar-chart-2" size={14} color={colors.textSecondary} />
        <Text style={[typo.captionMedium, { color: colors.textSecondary, marginLeft: spacing.xs }]}>
          persona 비교 — 적합도·모의 성과로 직접 고르기
        </Text>
      </View>
    </View>
  );
}

export default function PersonaSelectScreen() {
  const { colors, typography: typo } = useTheme();
  const query = usePersonaOverview();
  const selectedPersona = usePersonaStore((s) => s.selectedPersona);
  const setPersona = usePersonaStore((s) => s.setPersona);
  const clearPersona = usePersonaStore((s) => s.clearPersona);

  const handleSelect = useCallback(
    (style: PhilosophyStyle) => {
      // 같은 persona 재탭 시 선택 해제(토글).
      if (selectedPersona === style) clearPersona();
      else setPersona(style);
    },
    [selectedPersona, setPersona, clearPersona],
  );

  const renderCard = useCallback(
    ({ item }: { item: PersonaOverviewRow }) => (
      <PersonaSelectCard
        row={item}
        selected={selectedPersona === item.performance.style}
        onSelect={handleSelect}
      />
    ),
    [selectedPersona, handleSelect],
  );

  const selectedLabel = query.data?.personas.find(
    (p) => p.performance.style === selectedPersona,
  )?.performance.label;

  const renderBody = () => {
    if (query.isLoading) return <SkeletonList variant="buyScore" />;
    if (query.isError) {
      return (
        <ApiErrorState
          error={query.error}
          title="persona 정보를 불러오지 못했습니다."
          onRetry={query.refetch}
        />
      );
    }

    const data = query.data;

    return (
      <FlatList
        data={data?.personas ?? []}
        renderItem={renderCard}
        keyExtractor={(item) => item.performance.style}
        contentContainerStyle={styles.listContent}
        showsVerticalScrollIndicator={false}
        removeClippedSubviews={false}
        refreshing={query.isRefetching}
        onRefresh={query.refetch}
        ListHeaderComponent={data ? <PersonaListHeader data={data} /> : null}
        ListEmptyComponent={
          <EmptyState
            icon="users"
            title="아직 persona 데이터가 없습니다."
            description="모의운용 사이클이 누적되면 성과 비교가 표시됩니다."
          />
        }
      />
    );
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={['top']}>
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <TouchableOpacity
          onPress={() => router.back()}
          hitSlop={8}
          style={styles.backButton}
          accessibilityRole="button"
          accessibilityLabel="뒤로 가기"
        >
          <Feather name="chevron-left" size={26} color={colors.text} />
        </TouchableOpacity>
        <View style={styles.headerTitle}>
          <Text style={[typo.h3, { color: colors.text }]}>persona 선택</Text>
          <Text style={[typo.small, { color: colors.textSecondary }]}>
            현재 장에 맞는 거장 철학을 모의운용으로 고르기
          </Text>
        </View>
        <View style={styles.backButton} />
      </View>

      <View style={styles.body}>{renderBody()}</View>

      {/* 선택 상태 표시 바 — 자동매매 persona(모의) */}
      {selectedPersona && selectedLabel ? (
        <Surface
          elevation={3}
          style={[styles.selectedFooter, { backgroundColor: colors.surface, borderTopColor: colors.border }]}
        >
          <View style={styles.selectedInfo}>
            <Feather name="bookmark" size={16} color={colors.primary} />
            <View style={styles.selectedTextCol}>
              <Text style={[typo.small, { color: colors.textSecondary }]}>선택한 모의운용 persona</Text>
              <Text style={[typo.captionMedium, { color: colors.text }]}>{selectedLabel}</Text>
            </View>
          </View>
          <TouchableOpacity
            onPress={clearPersona}
            hitSlop={8}
            style={styles.clearButton}
            accessibilityRole="button"
            accessibilityLabel="선택 해제"
          >
            <Text style={[typo.small, { color: colors.primary, fontWeight: '600' }]}>선택 해제</Text>
          </TouchableOpacity>
        </Surface>
      ) : null}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
  },
  backButton: {
    width: 40,
    height: 40,
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerTitle: {
    flex: 1,
    alignItems: 'center',
  },
  body: {
    flex: 1,
  },
  listContent: {
    padding: spacing.lg,
    gap: spacing.md,
    flexGrow: 1,
  },
  headerBox: {
    gap: spacing.md,
    marginBottom: spacing.xs,
  },
  banner: {
    borderRadius: radius.md,
  },
  compareLabel: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: spacing.xs,
  },
  selectedFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderTopWidth: 1,
  },
  selectedInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    flexShrink: 1,
  },
  selectedTextCol: {
    marginLeft: spacing.sm,
    gap: 2,
  },
  clearButton: {
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
});
