import React, { useCallback, useMemo } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, FlatList } from 'react-native';
import { Surface } from 'react-native-paper';
import { Feather } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useTheme } from '@theme';
import { spacing, radius } from '@theme/spacing';
import { CuratedSignalCard } from '@components/signals/CuratedSignalCard';
import { ApiErrorState } from '@components/common/StateView';
import { SkeletonCard } from '@components/common/SkeletonCard';
import { useBuySignals } from '@hooks/useSignals';
import { useCarouselCardWidth } from '@hooks/useCarouselCardWidth';
import { curateBuySignals, CURATION_CRITERIA_LABEL } from '@utils/signalCuration';
import { verticalHitSlopForHeight } from '@utils/touchTarget';

import type { TradingSignal } from '@app-types/signal.types';

// L1 "오늘 주목할 신호" 큐레이션 슬롯(DAR-116) — 신호 탭 최상단 1순위.
// HomeSignalPreview 큐레이션 로직을 신호 탭으로 승격(공용 util curateBuySignals).
// 매수등급 0이면 가짜 BUY 금지(§2) → "점수순 전체 탐색" CTA로 아래 L2 탐색을 유도한다.

interface CurationSlotProps {
  /** 추천 0건일 때 '점수순 전체 탐색' CTA가 호출(아래 L2 탐색으로 스크롤·유도). */
  onExplore: () => void;
}

function CurationSlotBase({ onExplore }: CurationSlotProps) {
  const { colors, typography: typo } = useTheme();
  const { data, isLoading, isError, error, refetch } = useBuySignals();
  // 화면 폭 반응형 카드 폭/스냅 간격(DAR-301).
  const { cardWidth, snapToInterval } = useCarouselCardWidth();

  // 공용 큐레이션: 매수등급만 점수 내림차순 상위 N(가짜 BUY 금지).
  const topSignals = useMemo(() => curateBuySignals(data), [data]);

  const handleCardPress = useCallback((signal: TradingSignal) => {
    router.push(`/signals/${signal.id}`);
  }, []);

  const renderCard = useCallback(
    ({ item }: { item: TradingSignal }) => (
      <CuratedSignalCard signal={item} onPress={handleCardPress} cardWidth={cardWidth} />
    ),
    [handleCardPress, cardWidth],
  );

  const heading = (
    <View style={styles.heading}>
      <Feather name="zap" size={16} color={colors.primary} />
      <View style={styles.headingText}>
        <Text style={[typo.bodyMedium, { color: colors.text }]}>오늘 주목할 신호</Text>
        {/* 큐레이션 기준 라벨(§6) — 정렬 근거 투명화, 블랙박스·과신 방지 */}
        <Text style={[typo.small, { color: colors.textSecondary }]}>
          {CURATION_CRITERIA_LABEL} (참고)
        </Text>
      </View>
    </View>
  );

  let body: React.ReactNode;

  if (isLoading) {
    body = (
      <View
        style={styles.skeletonRow}
        accessibilityRole="progressbar"
        accessibilityLabel="주목할 신호 불러오는 중"
      >
        {[0, 1].map((i) => (
          <View key={i} style={[styles.skeletonCard, { width: cardWidth }]}>
            <SkeletonCard variant="buyScore" />
          </View>
        ))}
      </View>
    );
  } else if (isError) {
    body = (
      <ApiErrorState
        error={error}
        onRetry={refetch}
        title="주목할 신호를 불러오지 못했습니다"
        description="잠시 후 다시 시도해 주세요."
      />
    );
  } else if (topSignals.length === 0) {
    // 정직 빈 상태(§2): 매수등급 0 → 가짜 BUY 금지. '점수순 전체 탐색' CTA로 L2 유도.
    body = (
      <Surface
        elevation={0}
        style={[styles.emptyCard, { backgroundColor: colors.surface, borderColor: colors.border }]}
      >
        <Feather name="compass" size={26} color={colors.textTertiary} />
        <Text style={[typo.bodyMedium, { color: colors.text, marginTop: spacing.sm, textAlign: 'center' }]}>
          아직 매수등급 신호가 없어요
        </Text>
        <Text style={[typo.small, { color: colors.textSecondary, marginTop: spacing.xs, textAlign: 'center' }]}>
          가짜 매수 신호 대신, 점수순으로 전체 신호를 살펴보세요
        </Text>
        <TouchableOpacity
          onPress={onExplore}
          style={[styles.exploreBtn, { borderColor: colors.primary }]}
          // DAR-449(B14): 빈상태 CTA 시각 높이 36pt(paddingVertical 8*2 + 라인높이 20, <44) —
          // 시각 크기 유지하며 유효 터치 영역만 44pt로 보정(인접 탭 없는 단독 버튼이라 세로 확장 안전).
          hitSlop={verticalHitSlopForHeight(36)}
          accessibilityRole="button"
          accessibilityLabel="점수순으로 전체 신호 탐색"
        >
          <Text style={[typo.captionMedium, { color: colors.primary }]}>점수순 전체 탐색</Text>
          <Feather name="arrow-down" size={14} color={colors.primary} />
        </TouchableOpacity>
      </Surface>
    );
  } else {
    body = (
      <FlatList
        horizontal
        data={topSignals}
        renderItem={renderCard}
        keyExtractor={(item) => item.id}
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.carousel}
        // 카드 단위 스냅(DAR-301) — 카드폭 + gap 기준으로 멈춰 peek 정렬 일관.
        snapToInterval={snapToInterval}
        snapToAlignment="start"
        decelerationRate="fast"
      />
    );
  }

  return (
    <View style={styles.container}>
      {heading}
      {body}
    </View>
  );
}

export const CurationSlot = React.memo(CurationSlotBase);

const styles = StyleSheet.create({
  container: {
    paddingTop: spacing.md,
  },
  heading: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    marginBottom: spacing.md,
  },
  headingText: {
    flex: 1,
    gap: 2,
  },
  carousel: {
    // DAR-319: 카드 간격은 각 카드(CuratedSignalCard)의 marginRight 로 적용(스켈레톤과 동일).
    // contentContainer gap 은 Android Fabric 가로 FlatList 에서 미적용될 수 있어 비의존.
    paddingHorizontal: spacing.lg,
  },
  skeletonRow: {
    flexDirection: 'row',
    paddingLeft: spacing.lg,
  },
  skeletonCard: {
    // 폭은 인라인 주입(DAR-301) — 카드와 동일 반응형 폭.
    marginRight: spacing.md,
  },
  emptyCard: {
    marginHorizontal: spacing.lg,
    borderRadius: radius.lg,
    borderWidth: 1,
    padding: spacing.lg,
    alignItems: 'center',
  },
  exploreBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    marginTop: spacing.md,
    paddingHorizontal: spacing.base,
    paddingVertical: spacing.sm,
    borderWidth: 1,
    borderRadius: radius.full,
  },
});
