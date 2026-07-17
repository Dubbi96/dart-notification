import React, { useCallback, useMemo } from 'react';
import { View, Text, FlatList, StyleSheet, TouchableOpacity, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useTheme, MAX_CHIP_FONT_SCALE } from '@theme';
import { spacing, radius, sizing } from '@theme/spacing';
import { ScreenHeader } from '@components/common/ScreenHeader';
import { Card } from '@components/common/Card';
import { LoadingState, EmptyState, ApiErrorState } from '@components/common/StateView';
import { emptyStateCopy } from '@components/common/emptyStateCopy';
import { useSnackbar } from '@components/common/SnackbarProvider';
import { snackbarCopy, SNACKBAR_DURATION } from '@components/common/snackbarCopy';
import {
  useSavedDisclosures,
  useRemoveSavedDisclosure,
  useSaveDisclosure,
} from '@hooks/useSavedDisclosures';
import { useHaptics } from '@hooks/useHaptics';
import { getTypeStyle, getTypeLabel } from '@utils/disclosureType';
import { formatYmdDots } from '@utils/datetime';

import type { SavedDisclosure } from '@hooks/useSavedDisclosures';

export default function SavedDisclosuresScreen() {
  const { colors, typography: typo, isDark } = useTheme();
  const { showSnackbar } = useSnackbar();
  const haptics = useHaptics();
  const { data, isLoading, isError, error, refetch, isRefetching } = useSavedDisclosures();
  const removeMutation = useRemoveSavedDisclosure();
  const saveMutation = useSaveDisclosure();

  // handleRemove가 items를 참조하므로 참조 안정화(useCallback 의존성 매 렌더 변동 방지).
  const items = useMemo(() => data?.data ?? [], [data]);

  // UXR-17(D-3): 해제는 낙관적 제거(훅 onMutate)로 목록에서 즉시 사라지고, 스낵바·햅틱은 결과로 분기 —
  // 성공 시에만 '실행 취소'(rcpNo 재저장 + 항목 낙관적 복원) 안내, 실패 시 훅 롤백과 함께 실패 안내.
  const handleRemove = useCallback(
    (id: string, rcpNo: string) => {
      // '실행 취소' 낙관적 복원용 원본 항목을 제거 전에 캡처.
      const removed = items.find((item) => item.id === id);
      removeMutation.mutate(id, {
        onSuccess: () => {
          haptics.light();
          showSnackbar(snackbarCopy.disclosureUnsaved, {
            duration: SNACKBAR_DURATION.success,
            action: {
              label: '실행 취소',
              onPress: () =>
                saveMutation.mutate(
                  { rcpNo, optimisticItem: removed },
                  {
                    onError: () =>
                      showSnackbar(snackbarCopy.disclosureSaveFailed, {
                        duration: SNACKBAR_DURATION.error,
                      }),
                  },
                ),
            },
          });
        },
        onError: () =>
          // 제거 실패 카피는 §3-1 표의 범용 문구(watchlistRemoveFailed)를 재사용.
          showSnackbar(snackbarCopy.watchlistRemoveFailed, {
            duration: SNACKBAR_DURATION.error,
          }),
      });
    },
    [items, removeMutation, saveMutation, haptics, showSnackbar],
  );

  const renderItem = useCallback(
    ({ item }: { item: SavedDisclosure }) => {
      const typeStyle = getTypeStyle(item.disclosureType, isDark);
      // UXR-17(A-8): notifications 행 패턴 이식 — 행 전체를 단일 버튼으로 읽는 합성 라벨(유형·제목·기업명·날짜).
      const rowA11yLabel = [
        getTypeLabel(item.disclosureType),
        item.reportName,
        item.corpName,
        formatYmdDots(item.rcpDt),
      ]
        .filter(Boolean)
        .join(', ');
      return (
        <TouchableOpacity
          activeOpacity={0.7}
          onPress={() => router.push(`/disclosure/${item.rcpNo}`)}
          accessibilityRole="button"
          accessibilityLabel={rowA11yLabel}
        >
          <Card style={styles.card} variant="elevated">
            <View style={styles.cardHeader}>
              <View style={[styles.typeBadge, { backgroundColor: typeStyle.bg }]}>
                <Text
                  style={[typo.small, { color: typeStyle.text, fontWeight: '600' }]}
                  maxFontSizeMultiplier={MAX_CHIP_FONT_SCALE}
                >
                  {getTypeLabel(item.disclosureType)}
                </Text>
              </View>
              <TouchableOpacity
                style={styles.removeButton}
                onPress={() => handleRemove(item.id, item.rcpNo)}
                accessibilityRole="button"
                accessibilityLabel="저장 해제"
              >
                <Ionicons name="bookmark" size={20} color={colors.primary} />
              </TouchableOpacity>
            </View>
            <Text
              style={[typo.bodyMedium, { color: colors.text, marginTop: spacing.sm }]}
              numberOfLines={2}
            >
              {item.reportName}
            </Text>
            <View style={styles.cardFooter}>
              <Text style={[typo.caption, { color: colors.textSecondary }]}>{item.corpName}</Text>
              <Text style={[typo.caption, { color: colors.textTertiary }]}>
                {formatYmdDots(item.rcpDt)}
              </Text>
            </View>
          </Card>
        </TouchableOpacity>
      );
    },
    [colors, typo, isDark, handleRemove],
  );

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
      <ScreenHeader
        title="보관함"
        onBack={() => router.back()}
        subtitle={!isLoading && !isError ? `${items.length}건` : undefined}
      />

      {isLoading ? (
        // UXR-17(D-1): 수제 스피너 대신 표준 StateView.LoadingState로 통일(에러/빈 상태와 같은 계열).
        <LoadingState message="보관함을 불러오는 중..." />
      ) : isError ? (
        // 장애를 '저장 0건' 빈 상태로 위장하지 않도록 에러는 명시 분기 + 재시도 동선 제공.
        <ApiErrorState
          error={error}
          onRetry={refetch}
          title="보관함을 불러오지 못했습니다"
          description="잠시 후 다시 시도해 주세요."
        />
      ) : (
        <FlatList
          data={items}
          renderItem={renderItem}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          initialNumToRender={10}
          maxToRenderPerBatch={10}
          windowSize={11}
          removeClippedSubviews
          refreshControl={
            <RefreshControl
              refreshing={isRefetching}
              onRefresh={refetch}
              colors={[colors.primary]}
              tintColor={colors.primary}
            />
          }
          ListEmptyComponent={<EmptyState {...emptyStateCopy.savedDisclosuresEmpty} />}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  listContent: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    gap: spacing.md,
  },
  card: {
    marginBottom: 0,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  // DAR-455(D11): 저장 해제 버튼 터치영역 ≥44pt(watchlist actionBtn 패턴 재사용).
  removeButton: {
    minWidth: sizing.minTouchTarget,
    minHeight: sizing.minTouchTarget,
    alignItems: 'center',
    justifyContent: 'center',
  },
  typeBadge: {
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: radius.sm,
  },
  cardFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: spacing.xs,
  },
});
