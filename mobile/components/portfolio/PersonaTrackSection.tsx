import React, { useCallback } from 'react';
import { View, Text, FlatList, StyleSheet } from 'react-native';
import { Banner } from 'react-native-paper';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '@theme';
import { spacing, radius } from '@theme/spacing';
import { SkeletonList } from '@components/common/SkeletonCard';
import { EmptyState, ApiErrorState } from '@components/common/StateView';
import { MarketRegimeCard } from '@components/persona/MarketRegimeCard';
import { PersonaSelectCard } from '@components/persona/PersonaSelectCard';
import { PERSONA_EMPHASIS, nextPersonaEmphasis } from '@components/persona/personaDisplay';
import { usePersonaOverview } from '@hooks/usePersonaOverview';
import { usePersonaStore } from '@stores/personaStore';

import type { PhilosophyStyle } from '@app-types/style-comparison.types';
import type { PersonaOverview, PersonaOverviewRow } from '@app-types/persona.types';

// persona별 모의운용 4트랙 성과 비교 — DAR-138 (P-D) / DAR-205 어휘 약화·중복 통합.
// 4 거장 철학(버핏·린치·그린블라트·드러켄밀러)의 모의 성과(수익률·MDD·신호적중률·현재 장 적합도)를
// 한 화면에서 비교하고, 추천우선→비교 패턴으로 현재 장 적합 persona를 먼저 보여준다.
// ★ DAR-205: 이 인라인 탭이 persona 비교의 단일 surface다(풀스크린 /persona 중복 제거). 카드 탭은
//   '선택→결과 반영'이 아니라 '비교 화면에서 강조'다 — 신호 큐레이션/홈/추천은 바뀌지 않는다.
// ★ M11+ 정책: 실주문·자동매매 실행 UI 없음. ★ 신뢰: 표본<30 DataLimitBadge·테마 토큰만·색 단독 의미 금지.

function SectionHeader({ data }: { data: PersonaOverview }) {
  const { colors, typography: typo } = useTheme();

  return (
    <View style={styles.headerBox}>
      {/* 정직 고지 — 강조는 비교 표시 용도, 신호/추천 미연동·실주문 없음(M11+ 정책) */}
      <Banner
        visible
        actions={[]}
        icon="information"
        style={[styles.banner, { backgroundColor: colors.surfaceSecondary }]}
      >
        <Text style={[typo.small, { color: colors.info }]}>
          persona별 모의운용 비교입니다 — 강조는 비교 표시 용도이며 신호 점수·추천을 바꾸지 않습니다.
          실제 주문·자동매매도 실행되지 않습니다(M11+ 정책).
        </Text>
      </Banner>

      {/* 추천우선: 현재 장 적합 persona 추천 카드 */}
      <MarketRegimeCard regime={data.regime} personas={data.personas} dataLimited={data.dataLimited} />

      {/* → 비교: 카드 탭 동작 안내(강조). 별도 풀스크린 진입 없이 아래 카드를 바로 비교/강조 */}
      <View style={styles.compareLabelRow}>
        <Feather name="bar-chart-2" size={14} color={colors.textSecondary} />
        <Text style={[typo.captionMedium, { color: colors.textSecondary, marginLeft: spacing.xs }]}>
          persona 4트랙 비교 — {PERSONA_EMPHASIS.cardActionHint}
        </Text>
      </View>
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
      // 비교 강조 토글(순수) — 같은 persona 재탭 시 강조 해제.
      const next = nextPersonaEmphasis(selectedPersona, style);
      if (next === null) clearPersona();
      else setPersona(next);
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
  compareLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
});
