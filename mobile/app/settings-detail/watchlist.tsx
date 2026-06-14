import React, { useMemo, useState } from 'react';
import {
  View,
  Text,
  FlatList,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useTheme } from '@theme';
import { spacing, radius } from '@theme/spacing';
import { formatDistanceToNow, parse } from 'date-fns';
import { ko } from 'date-fns/locale';
import { useWatchlist, useRemoveFromWatchlist, useAddToWatchlist } from '@hooks/useWatchlist';
import { useDialog } from '@components/common/DialogProvider';
import { SearchOverlay } from '@components/common/SearchOverlay';
import { ScreenHeader } from '@components/common/ScreenHeader';
import { EmptyState, ApiErrorState } from '@components/common/StateView';
import { emptyStateCopy } from '@components/common/emptyStateCopy';
import { useStockQuotes } from '@hooks/useStockQuotes';
import { StockPriceBadge } from '@components/common/StockPriceBadge';
import { useSnackbar } from '@components/common/SnackbarProvider';
import { snackbarCopy, SNACKBAR_DURATION } from '@components/common/snackbarCopy';
import { useHaptics } from '@hooks/useHaptics';

import type { WatchlistItem } from '@app-types/user.types';

export default function WatchlistScreen() {
  const { colors, typography: typo } = useTheme();
  const { showDialog } = useDialog();
  const { showSnackbar } = useSnackbar();
  const haptics = useHaptics();
  const { data, isLoading, isError, error, refetch, isRefetching } = useWatchlist();
  const removeFromWatchlist = useRemoveFromWatchlist();
  const addToWatchlist = useAddToWatchlist();

  const [searchVisible, setSearchVisible] = useState(false);

  const watchlistItems = data?.data ?? [];
  const total = data?.meta?.total ?? 0;
  const limit = data?.meta?.limit ?? 30;

  // DAR-202: 제거 → 성공 스낵바·햅틱·되돌리기(재추가). 공시 저장(disclosure/[id])과 동일한 인터랙션 일관성.
  const handleRemove = (item: WatchlistItem) => {
    removeFromWatchlist.mutate(item.id, {
      onSuccess: () => {
        haptics.success();
        showSnackbar(snackbarCopy.watchlistRemoved(item.corpName), {
          duration: SNACKBAR_DURATION.success,
          action: {
            label: '되돌리기',
            onPress: () =>
              addToWatchlist.mutate({
                corpCode: item.corpCode,
                corpName: item.corpName,
                stockCode: item.stockCode,
                market: item.market,
              }),
          },
        });
      },
      onError: () => {
        haptics.warning();
        showSnackbar(snackbarCopy.watchlistRemoveFailed, { duration: SNACKBAR_DURATION.error });
      },
    });
  };

  // DAR-202: 한도 도달 시 +버튼 dead tap 대신 안내 스낵바.
  const handleAdd = () => {
    if (total >= limit) {
      showSnackbar(snackbarCopy.watchlistLimitReached(limit), { duration: SNACKBAR_DURATION.error });
      return;
    }
    setSearchVisible(true);
  };

  // DAR-158: 관심기업 가격 배지 — 종목코드 일괄 조회(N+1 회피, 단일 in 쿼리).
  const stockCodes = useMemo(
    () => (data?.data ?? []).map((i) => i.stockCode).filter((c): c is string => !!c),
    [data],
  );
  const { quotes } = useStockQuotes(stockCodes);

  if (isLoading) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
        <ScreenHeader title="관심목록" onBack={() => router.back()} />
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
      <ScreenHeader
        title="관심목록"
        onBack={() => router.back()}
        rightSlot={
          <TouchableOpacity
            style={styles.headerAction}
            onPress={handleAdd}
            accessibilityRole="button"
            accessibilityLabel={total >= limit ? '관심기업 추가 (한도 도달)' : '관심기업 추가'}
          >
            <Ionicons name="add" size={24} color={total >= limit ? colors.textTertiary : colors.primary} />
          </TouchableOpacity>
        }
      />

      <View style={styles.counter}>
        <Text style={[typo.caption, { color: colors.textSecondary }]}>
          {total} / {limit} 기업
        </Text>
      </View>

      <FlatList
        data={watchlistItems}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.listContent}
        refreshControl={
          <RefreshControl
            refreshing={isRefetching}
            onRefresh={refetch}
            colors={[colors.primary]}
            tintColor={colors.primary}
          />
        }
        ListEmptyComponent={
          isError ? (
            // 연결 실패 시 빈 화면 대신 사유+재시도(DAR-43 §1).
            <ApiErrorState
              error={error}
              onRetry={refetch}
              title="관심기업을 불러오지 못했습니다"
            />
          ) : (
            <EmptyState
              {...emptyStateCopy.watchlistEmpty}
              onAction={() => setSearchVisible(true)}
            />
          )
        }
        renderItem={({ item }) => (
          <TouchableOpacity
            style={[
              styles.watchlistItem,
              { backgroundColor: colors.surface, borderColor: colors.borderLight },
            ]}
            activeOpacity={0.7}
            onPress={() => router.push(`/company/${item.corpCode}`)}
          >
            <View style={styles.itemContent}>
              <View style={styles.nameRow}>
                <Text style={[typo.bodyMedium, { color: colors.text }]}>{item.corpName}</Text>
                {(item.newDisclosureCount ?? 0) > 0 && (
                  <View
                    style={[styles.newBadge, { backgroundColor: colors.primary }]}
                    accessibilityRole="text"
                    accessibilityLabel={`신규 공시 ${item.newDisclosureCount}건`}
                  >
                    <Text style={[typo.small, styles.newBadgeText, { color: colors.primaryForeground }]}>
                      신규 {(item.newDisclosureCount ?? 0) > 99 ? '99+' : item.newDisclosureCount}
                    </Text>
                  </View>
                )}
              </View>
              <Text style={[typo.small, { color: colors.textSecondary }]}>
                {item.stockCode ? `${item.stockCode}${item.market ? ` · ${item.market}` : ''}` : ''}
                {item.stockCode && item.lastDisclosureDate ? ' · ' : ''}
                {item.lastDisclosureDate
                  ? `마지막 공시 ${formatDistanceToNow(parse(item.lastDisclosureDate, 'yyyyMMdd', new Date()), { addSuffix: true, locale: ko })}`
                  : !item.stockCode ? '공시 없음' : ''}
              </Text>
              {/* DAR-158: 가격 배지 — 시세 있을 때만, 없으면 미표시. */}
              {item.stockCode && quotes[item.stockCode] ? (
                <StockPriceBadge quote={quotes[item.stockCode]} style={styles.priceBadge} />
              ) : null}
            </View>
            <View style={styles.itemActions}>
              <TouchableOpacity
                style={styles.actionBtn}
                hitSlop={{ top: spacing.md, bottom: spacing.md, left: spacing.md, right: spacing.md }}
                accessibilityRole="button"
                accessibilityLabel={`${item.corpName} 관심목록에서 제거`}
                onPress={() => {
                  showDialog({
                    title: '관심목록 해제',
                    message: `${item.corpName}을(를) 관심목록에서 제거할까요?`,
                    icon: { name: 'trash-2', color: colors.error },
                    buttons: [
                      { text: '취소', style: 'cancel' },
                      { text: '해제', style: 'destructive', onPress: () => handleRemove(item) },
                    ],
                  });
                }}
              >
                <Ionicons name="trash-outline" size={20} color={colors.error} />
              </TouchableOpacity>
            </View>
          </TouchableOpacity>
        )}
      />

      <SearchOverlay
        visible={searchVisible}
        onClose={() => setSearchVisible(false)}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerAction: {
    width: 44,
    height: 44,
    justifyContent: 'center',
    alignItems: 'flex-end',
  },
  counter: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  listContent: {
    paddingHorizontal: spacing.lg,
    gap: spacing.sm,
  },
  watchlistItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.base,
    borderRadius: radius.lg,
    borderWidth: 1,
  },
  itemContent: { flex: 1 },
  priceBadge: { marginTop: spacing.xs },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    flexWrap: 'wrap',
  },
  newBadge: {
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: radius.full,
  },
  newBadgeText: { fontWeight: '700' },
  itemActions: { flexDirection: 'row', gap: spacing.md },
  // DAR-202: 삭제 버튼 터치영역 ≥44pt(iOS HIG). padding xs(4pt)로는 미달이라 최소 크기 보장.
  actionBtn: {
    minWidth: 44,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
