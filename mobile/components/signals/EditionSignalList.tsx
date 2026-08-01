import React, { useCallback, useMemo } from 'react';
import { View, Text, FlatList, StyleSheet, TouchableOpacity } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useTheme } from '@theme';
import { spacing, radius } from '@theme/spacing';
import { EditionDecisionCard } from '@components/signals/EditionDecisionCard';
import { EditionDecisionSummary } from '@components/signals/EditionDecisionSummary';
import { EditionFallbackBriefing } from '@components/signals/EditionFallbackBriefing';
import { DisclaimerSection } from '@components/common/DisclaimerSection';
import { EmptyState, ApiErrorState } from '@components/common/StateView';
import { SkeletonList } from '@components/common/SkeletonCard';
import { useEdition } from '@hooks/useSignals';
import { useDeviceRuleDecision, useLastDeviceEditionReceipt } from '@hooks/useDeviceRuleDecision';
import { getEditionEmptyCopy } from '@utils/editionDisplay';
import { recordTesterEvent } from '@services/testerEvents.service';

import type { TradingSignal } from '@app-types/signal.types';

// 에디션 세로 리스트(DAR-509, 정본 §3·§4-S5) — 선택된 KST 거래일의 매수등급 랭킹(점수 desc).
// 백엔드가 [buyScore desc, createdAt desc, id desc] 로 랭킹해 내려주므로 클라 재정렬 없이 그 순서를
// 보존한다(동점 tie-break 일치). keyExtractor=signal.id. refreshControl 안티패턴 금지(정본 DoD) →
// refreshing/onRefresh props 만 사용(RN 0.85 Fabric FlatList 백지 회귀 가드, mobile #1).
//
// 과거/만료 에디션(정본 §3): '지난 판단 · 현재 시세와 다를 수 있음' 배너 + 카드 muted + '오늘로' 리셋.
// 빈 에디션: 정직 4분기(CLOSED/PENDING/QUIET/COLD_START)+FUTURE 카피 + 직전 거래일 CTA(다른 날로
// 자리를 채우지 않고 명시 이동만 제공).

interface EditionSignalListProps {
  /** 선택된 KST 거래일(YYYYMMDD). undefined면 로딩 대기(에디션 목록 미확정). */
  date: string | undefined;
  /** 서버 기준 KST 오늘(YYYYMMDD) — '오늘로' 리셋 대상. */
  todayDate: string | null | undefined;
  /** 다른 에디션일로 이동(직전 거래일 CTA·'오늘로' 리셋·인접 플립). */
  onSelectDate: (date: string) => void;
  /** pull-to-refresh 시 에디션 날짜 목록(스트립)도 함께 갱신하는 부모 콜백. */
  onRefreshEditions?: () => void;
  /** 탭 재탭 시 최상단 복귀 — 부모(화면)가 공유 ref 로 주입하고 useScrollToTop 을 배선한다. */
  listRef?: React.RefObject<FlatList<TradingSignal> | null>;
}

function EditionSignalListBase({
  date,
  todayDate,
  onSelectDate,
  onRefreshEditions,
  listRef,
}: EditionSignalListProps) {
  const { colors, typography: typo } = useTheme();
  const query = useEdition(date);
  const { refetch } = query;

  const meta = query.data?.meta;
  const items = query.data?.items ?? [];
  const deviceDecision = useDeviceRuleDecision(date, items);
  const cachedReceipt = useLastDeviceEditionReceipt(date);
  const decisionBySignalId = useMemo(
    () =>
      new Map(
        (deviceDecision.data?.decisions ?? []).map((decision) => [decision.signalId, decision]),
      ),
    [deviceDecision.data?.decisions],
  );

  // 과거 에디션(오늘 아님 · 미래 아님) → 지난 판단 배너 + muted. 신호가 있을 때만 배너 노출
  // (빈 과거 에디션은 4분기 카피가 사유를 이미 고지 — 배너 중복 회피).
  const isPast = !!meta && !meta.isToday && meta.emptyReason !== 'FUTURE';
  const showBanner = isPast && items.length > 0;

  const handlePress = useCallback((signal: TradingSignal) => {
    void recordTesterEvent('card_tap'); // DAR-516 계측: 에디션 카드 탭(종목 식별자 미전송)
    router.push(`/signals/${signal.id}`);
  }, []);

  const renderItem = useCallback(
    ({ item, index }: { item: TradingSignal; index: number }) => {
      const decision = decisionBySignalId.get(item.id);
      if (!decision) return null;
      return (
        <EditionDecisionCard
          signal={item}
          decision={decision}
          rank={index + 1}
          historical={isPast}
          onPress={handlePress}
        />
      );
    },
    [decisionBySignalId, handlePress, isPast],
  );

  // pull-to-refresh — 에디션 상세 + 스트립(날짜 목록) 동시 갱신.
  const handleRefresh = useCallback(() => {
    onRefreshEditions?.();
    refetch();
  }, [onRefreshEditions, refetch]);

  // 날짜 미확정(에디션 목록 로딩 중) 또는 상세 로딩 → 스켈레톤(헤더 깜빡임 방지).
  if (!date || query.isLoading) {
    return (
      <View style={styles.container}>
        <SkeletonList variant="buyScore" />
      </View>
    );
  }

  if (query.isError) {
    return (
      <View style={styles.container}>
        {cachedReceipt.data ? (
          <View
            style={[
              styles.cachedReceipt,
              { backgroundColor: colors.surfaceSecondary, borderColor: colors.border },
            ]}
          >
            <Feather name="archive" size={16} color={colors.textSecondary} />
            <Text style={[typo.small, styles.cachedReceiptText, { color: colors.textSecondary }]}>
              마지막 기기 계산: {cachedReceipt.data.headline} ·{' '}
              {cachedReceipt.data.savedAt.slice(0, 10)}
            </Text>
          </View>
        ) : null}
        <ApiErrorState
          error={query.error}
          title="에디션을 불러오지 못했습니다."
          description="잠시 후 다시 시도해 주세요."
          onRetry={refetch}
        />
      </View>
    );
  }

  const prevDate = meta?.prevEditionDate;
  const emptyCopy = getEditionEmptyCopy(meta?.emptyReason);
  // 빈 에디션 폴백 '오늘의 주요 공시 브리핑'(DAR-551 BE·DAR-552 FE) — 있으면(항목 1개 이상)
  // 정직 카피(상위) 아래 별도 섹션으로 노출. 정직 불변식: '판단' 아님 — EmptyState 를 대체하지
  // 않고 그 아래에 이어 붙인다(compact 레이아웃으로 전환해 두 섹션이 함께 보이게).
  const fallbackBriefing = meta?.fallbackBriefing ?? [];
  const hasFallbackBriefing = fallbackBriefing.length > 0;

  if (items.length > 0 && (deviceDecision.isPending || deviceDecision.isError)) {
    return (
      <View style={styles.container}>
        {deviceDecision.isError ? (
          <ApiErrorState
            error={deviceDecision.error}
            title="기기 Rule 계산을 완료하지 못했습니다."
            description="안전상 숫자 플랜을 표시하지 않습니다. 다시 계산해 주세요."
            onRetry={deviceDecision.refetch}
          />
        ) : (
          <SkeletonList variant="buyScore" />
        )}
      </View>
    );
  }

  return (
    // testID: 선택 에디션(날짜)의 매수 신호 세로 리스트 앵커(DAR-542 스모크 ② — 날짜 스트립 탭 후 갱신 확인).
    <View style={styles.container} testID="edition-signal-list">
      {showBanner ? (
        <View
          style={[
            styles.banner,
            { backgroundColor: colors.surfaceSecondary, borderColor: colors.border },
          ]}
        >
          <Feather name="clock" size={16} color={colors.textSecondary} />
          <Text style={[typo.small, styles.bannerText, { color: colors.textSecondary }]}>
            지난 판단 · 현재 시세와 다를 수 있어요
          </Text>
          {todayDate ? (
            <TouchableOpacity
              onPress={() => onSelectDate(todayDate)}
              style={[styles.resetBtn, { borderColor: colors.primary }]}
              accessibilityRole="button"
              accessibilityLabel="오늘 에디션으로 이동"
            >
              <Text style={[typo.small, { color: colors.primary, fontWeight: '600' }]}>오늘로</Text>
            </TouchableOpacity>
          ) : null}
        </View>
      ) : null}

      <FlatList
        ref={listRef}
        data={items}
        renderItem={renderItem}
        keyExtractor={(item) => item.id}
        contentContainerStyle={[styles.listContent, showBanner && styles.mutedContent]}
        showsVerticalScrollIndicator={false}
        removeClippedSubviews={false}
        initialNumToRender={8}
        maxToRenderPerBatch={8}
        windowSize={7}
        refreshing={query.isRefetching}
        onRefresh={handleRefresh}
        ListHeaderComponent={
          deviceDecision.data ? (
            <EditionDecisionSummary decision={deviceDecision.data} historical={isPast} />
          ) : null
        }
        ListEmptyComponent={
          <View>
            <EmptyState
              icon={emptyCopy.icon}
              title={emptyCopy.title}
              description={emptyCopy.description}
              actionLabel={prevDate ? '직전 거래일 보기' : undefined}
              onAction={prevDate ? () => onSelectDate(prevDate) : undefined}
              compact={hasFallbackBriefing}
            />
            {hasFallbackBriefing ? <EditionFallbackBriefing items={fallbackBriefing} /> : null}
          </View>
        }
        ListFooterComponent={
          items.length > 0 ? (
            <DisclaimerSection
              style={styles.disclaimer}
              contextNotes={[
                '표시 가격은 해당 에디션 시점의 종가를 기준으로 기기에서 계산한 Shadow 계획이며 실주문이 아닙니다.',
                '시장가 갭으로 진입 구간을 벗어나면 계획을 적용하지 않습니다.',
              ]}
            />
          ) : null
        }
      />
    </View>
  );
}

export const EditionSignalList = React.memo(EditionSignalListBase);

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginHorizontal: spacing.lg,
    marginTop: spacing.md,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radius.lg,
    borderWidth: 1,
  },
  bannerText: {
    flex: 1,
  },
  cachedReceipt: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    margin: spacing.lg,
    padding: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
  },
  cachedReceiptText: {
    flex: 1,
  },
  resetBtn: {
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.md,
    borderRadius: radius.full,
    borderWidth: 1,
  },
  listContent: {
    padding: spacing.lg,
    gap: spacing.md,
    flexGrow: 1,
  },
  // 과거 에디션 카드 muted(정본 §3) — 지난 판단임을 시각적으로 낮춤(배너는 full opacity 유지).
  mutedContent: {
    opacity: 0.85,
  },
  disclaimer: {
    marginTop: spacing.lg,
  },
});
