import React, { useMemo, useState } from 'react';
import {
  View,
  Text,
  FlatList,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useTheme } from '@theme';
import { spacing, radius } from '@theme/spacing';
import { formatDistanceToNow, parse } from 'date-fns';
import { ko } from 'date-fns/locale';
import { useWatchlist, useRemoveFromWatchlist } from '@hooks/useWatchlist';
import { useDialog } from '@components/common/DialogProvider';
import { SearchOverlay } from '@components/common/SearchOverlay';
import { EmptyState, ApiErrorState } from '@components/common/StateView';
import { emptyStateCopy } from '@components/common/emptyStateCopy';
import { useStockQuotes } from '@hooks/useStockQuotes';
import { StockPriceBadge } from '@components/common/StockPriceBadge';

export default function WatchlistScreen() {
  const { colors, typography: typo } = useTheme();
  const { showDialog } = useDialog();
  const { data, isLoading, isError, error, refetch } = useWatchlist();
  const removeFromWatchlist = useRemoveFromWatchlist();

  const [searchVisible, setSearchVisible] = useState(false);

  const watchlistItems = data?.data ?? [];
  const total = data?.meta?.total ?? 0;
  const limit = data?.meta?.limit ?? 30;

  // DAR-158: 관심기업 가격 배지 — 종목코드 일괄 조회(N+1 회피, 단일 in 쿼리).
  const stockCodes = useMemo(
    () => (data?.data ?? []).map((i) => i.stockCode).filter((c): c is string => !!c),
    [data],
  );
  const { quotes } = useStockQuotes(stockCodes);

  if (isLoading) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
        <View style={[styles.header, { borderBottomColor: colors.border }]}>
          <TouchableOpacity onPress={() => router.back()} style={styles.headerButton}>
            <Ionicons name="chevron-back" size={26} color={colors.text} />
          </TouchableOpacity>
          <Text style={[typo.h3, { color: colors.text, flex: 1, textAlign: 'center' }]}>
            관심목록
          </Text>
          <View style={styles.headerButton} />
        </View>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.headerButton}>
          <Ionicons name="chevron-back" size={26} color={colors.text} />
        </TouchableOpacity>
        <Text style={[typo.h3, { color: colors.text, flex: 1, textAlign: 'center' }]}>
          관심목록
        </Text>
        <TouchableOpacity
          style={styles.headerButton}
          onPress={() => setSearchVisible(true)}
          disabled={total >= limit}
        >
          <Ionicons name="add" size={24} color={total >= limit ? colors.textTertiary : colors.primary} />
        </TouchableOpacity>
      </View>

      <View style={styles.counter}>
        <Text style={[typo.caption, { color: colors.textSecondary }]}>
          {total} / {limit} 기업
        </Text>
      </View>

      <FlatList
        data={watchlistItems}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.listContent}
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
                onPress={() => {
                  showDialog({
                    title: '관심목록 해제',
                    message: `${item.corpName}을(를) 관심목록에서 제거할까요?`,
                    icon: { name: 'trash-2', color: colors.error },
                    buttons: [
                      { text: '취소', style: 'cancel' },
                      { text: '해제', style: 'destructive', onPress: () => removeFromWatchlist.mutate(item.id) },
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
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
  },
  headerButton: {
    paddingHorizontal: spacing.base,
    paddingVertical: spacing.sm,
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
  actionBtn: { padding: spacing.xs },
});
