import React, { useCallback } from 'react';
import { View, Text, FlatList, StyleSheet, Pressable } from 'react-native';
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

// persona별 모의운용 4트랙 성과 비교 — DAR-138 (P-D).
// 기존엔 스타일 탭의 작은 CTA(PersonaPickerHeader)에만 묻혀 있던 persona 진입을
// 포트폴리오 전용 탭으로 승격한다. 4 거장 철학(버핏·린치·그린블라트·드러켄밀러)의
// 모의 성과(수익률·MDD·신호적중률·현재 장 적합도)를 한 화면에서 비교하고, 추천우선→비교
// 패턴으로 현재 장 적합 persona를 먼저 보여준 뒤 직접 고른다(인라인 선택, 영속).
// ★ M11+ 정책: '모의/선택'까지만 — 실주문·자동매매 실행 UI 없음.
// ★ 신뢰: 표본<30 DataLimitBadge·'참고' 전제·결정론 Rule 고지·테마 토큰만·색 단독 의미 금지.

function SectionHeader({ data }: { data: PersonaOverview }) {
  const { colors, typography: typo } = useTheme();
  const goFullScreen = useCallback(() => router.push('/persona'), []);

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
          persona별 모의운용 비교입니다 — 실제 주문·자동매매는 실행되지 않습니다(M11+ 정책). 선택은
          전략 비교·모의 운용 표시 용도입니다.
        </Text>
      </Banner>

      {/* 추천우선: 현재 장 적합 persona 추천 카드 */}
      <MarketRegimeCard regime={data.regime} personas={data.personas} dataLimited={data.dataLimited} />

      {/* → 비교: 4트랙 성과 비교 안내 + 전용 화면 진입 */}
      <Pressable
        onPress={goFullScreen}
        accessibilityRole="button"
        accessibilityLabel="persona 비교 전체 화면 열기"
      >
        <Surface
          elevation={1}
          style={[styles.compareCta, { backgroundColor: colors.surface, borderColor: colors.border }]}
        >
          <View style={styles.compareTextCol}>
            <View style={styles.compareLabelRow}>
              <Feather name="bar-chart-2" size={14} color={colors.textSecondary} />
              <Text style={[typo.captionMedium, { color: colors.text, marginLeft: spacing.xs }]}>
                persona 4트랙 비교
              </Text>
            </View>
            <Text style={[styles.compareSub, typo.small, { color: colors.textSecondary }]}>
              적합도·모의 성과로 직접 고르기 — 카드를 탭하면 선택됩니다
            </Text>
          </View>
          <Feather name="external-link" size={18} color={colors.primary} />
        </Surface>
      </Pressable>
    </View>
  );
}

export function PersonaTrackSection() {
  const { colors } = useTheme();
  const query = usePersonaOverview();
  const selectedPersona = usePersonaStore((s) => s.selectedPersona);
  const setPersona = usePersonaStore((s) => s.setPersona);
  const clearPersona = usePersonaStore((s) => s.clearPersona);

  const handleSelect = useCallback(
    (style: PhilosophyStyle) => {
      // 같은 persona 재탭 시 선택 해제(토글) — /persona 화면과 동일 거동.
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

  if (query.isLoading) return <SkeletonList variant="buyScore" />;
  if (query.isError) {
    return (
      <ApiErrorState
        error={query.error}
        title="persona별 성과를 불러오지 못했습니다."
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
      initialNumToRender={4}
      refreshing={query.isRefetching}
      onRefresh={query.refetch}
      ListHeaderComponent={data ? <SectionHeader data={data} /> : null}
      ListEmptyComponent={
        <EmptyState
          icon="users"
          title="아직 persona 데이터가 없습니다."
          description="모의운용 사이클이 누적되면 4트랙 성과 비교가 표시됩니다."
        />
      }
      style={{ backgroundColor: colors.background }}
    />
  );
}

const styles = StyleSheet.create({
  listContent: {
    padding: spacing.lg,
    gap: spacing.md,
    flexGrow: 1,
  },
  headerBox: {
    gap: spacing.md,
    marginBottom: spacing.md,
  },
  banner: {
    borderRadius: radius.md,
  },
  compareCta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderRadius: radius.lg,
    borderWidth: 1,
    padding: spacing.base,
    gap: spacing.sm,
  },
  compareTextCol: {
    flexShrink: 1,
  },
  compareLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  compareSub: {
    marginTop: 2,
  },
});
