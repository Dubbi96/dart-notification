import React, { useCallback, useMemo, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  FlatList,
  StyleSheet,
  TouchableOpacity,
  Modal,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useQueryClient } from '@tanstack/react-query';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '@theme';
import { spacing, radius } from '@theme/spacing';
import { useDebounce } from '@hooks/useDebounce';
import { useCompanySearch, usePopularCompanies, shouldSearch } from '@hooks/useCompanySearch';
import {
  useAddToWatchlist,
  useRemoveFromWatchlist,
  useWatchlist,
  WATCHLIST_KEY,
} from '@hooks/useWatchlist';
import { useRecentSearches } from '@hooks/useRecentSearches';
import { useSnackbar } from '@components/common/SnackbarProvider';

import type { Company, WatchlistItem } from '@app-types/user.types';

const MAX_WATCHLIST_COUNT = 30;

interface Props {
  visible: boolean;
  onClose: () => void;
}

function marketLabel(market: string | null): string {
  if (market === 'KOSPI') return '코스피';
  if (market === 'KOSDAQ') return '코스닥';
  return '';
}

export function SearchOverlay({ visible, onClose }: Props) {
  const { colors, typography: typo } = useTheme();
  const queryClient = useQueryClient();
  const { showSnackbar } = useSnackbar();

  const [query, setQuery] = useState('');
  const debounced = useDebounce(query, 300);
  const term = debounced.trim();
  const searching = shouldSearch(term);

  const { data: watchlist } = useWatchlist({ enabled: visible });
  const { data: results, isLoading, isError, refetch } = useCompanySearch(searching ? term : '');
  const { data: popular } = usePopularCompanies();
  const { recent, addRecent, removeRecent } = useRecentSearches();
  const addToWatchlist = useAddToWatchlist();
  const removeFromWatchlist = useRemoveFromWatchlist();

  const watchlistItems = watchlist?.data ?? [];
  const total = watchlist?.meta?.total ?? watchlistItems.length;
  const atLimit = total >= MAX_WATCHLIST_COUNT;

  const watchlistMap = useMemo(() => {
    const map = new Map<string, WatchlistItem>();
    watchlistItems.forEach((item) => map.set(item.corpCode, item));
    return map;
  }, [watchlistItems]);

  const handleClose = useCallback(() => {
    setQuery('');
    onClose();
  }, [onClose]);

  const undoAdd = useCallback(
    (corpCode: string) => {
      const cache = queryClient.getQueryData<{ data: WatchlistItem[] }>(WATCHLIST_KEY);
      const item = cache?.data.find((i) => i.corpCode === corpCode);
      if (item && !item.id.startsWith('temp-')) {
        removeFromWatchlist.mutate(item.id);
      } else {
        // 서버 반영 전(임시 id)이면 최신 목록을 다시 받아 정합을 맞춘다.
        void queryClient.invalidateQueries({ queryKey: WATCHLIST_KEY });
      }
    },
    [queryClient, removeFromWatchlist],
  );

  const handleAdd = useCallback(
    (company: Company) => {
      if (atLimit) {
        showSnackbar(`관심 기업은 최대 ${MAX_WATCHLIST_COUNT}개까지 등록할 수 있어요.`, {
          duration: 4000,
        });
        return;
      }
      addRecent(company);
      addToWatchlist.mutate(
        {
          corpCode: company.corpCode,
          corpName: company.corpName,
          stockCode: company.stockCode,
          market: company.market,
        },
        {
          onError: (error) => {
            const status = (error as { response?: { status?: number } })?.response?.status;
            if (status !== 422) {
              showSnackbar('추가에 실패했어요. 다시 시도해 주세요.', { duration: 4000 });
            }
          },
        },
      );
      showSnackbar(`${company.corpName}을(를) 관심목록에 추가했어요.`, {
        duration: 2500,
        action: { label: '실행 취소', onPress: () => undoAdd(company.corpCode) },
      });
    },
    [atLimit, addRecent, addToWatchlist, showSnackbar, undoAdd],
  );

  const handleRemove = useCallback(
    (company: Company) => {
      const item = watchlistMap.get(company.corpCode);
      if (!item) return;
      removeFromWatchlist.mutate(item.id);
      showSnackbar(`${company.corpName}을(를) 관심목록에서 제거했어요.`, {
        duration: 2500,
        action: {
          label: '실행 취소',
          onPress: () =>
            addToWatchlist.mutate({
              corpCode: company.corpCode,
              corpName: company.corpName,
              stockCode: company.stockCode,
              market: company.market,
            }),
        },
      });
    },
    [watchlistMap, removeFromWatchlist, addToWatchlist, showSnackbar],
  );

  const toggle = useCallback(
    (company: Company) => {
      if (watchlistMap.has(company.corpCode)) handleRemove(company);
      else handleAdd(company);
    },
    [watchlistMap, handleRemove, handleAdd],
  );

  const renderItem = useCallback(
    ({ item }: { item: Company }) => {
      const added = watchlistMap.has(item.corpCode);
      const mLabel = marketLabel(item.market);
      const a11y = added
        ? `${item.corpName}, 관심목록에 추가됨. 탭하면 제거`
        : `${item.corpName}${item.stockCode ? ` 종목코드 ${item.stockCode}` : ''}${
            mLabel ? ` ${mLabel}` : ''
          }, 추가 버튼`;

      return (
        <View style={styles.resultItem}>
          <View style={styles.companyInfo}>
            <Text style={[typo.bodyMedium, { color: colors.text }]} numberOfLines={1}>
              {item.corpName}
            </Text>
            {item.stockCode ? (
              <Text style={[typo.small, { color: colors.textTertiary, marginTop: 2 }]}>
                {item.stockCode}
                {mLabel ? ` · ${mLabel}` : ''}
              </Text>
            ) : null}
          </View>
          <TouchableOpacity
            style={[
              styles.toggleBtn,
              added
                ? { backgroundColor: colors.primary, borderColor: colors.primary }
                : { borderColor: colors.primary },
            ]}
            onPress={() => toggle(item)}
            activeOpacity={0.7}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel={a11y}
          >
            <Feather
              name={added ? 'check' : 'plus'}
              size={18}
              color={added ? '#FFFFFF' : colors.primary}
            />
          </TouchableOpacity>
        </View>
      );
    },
    [watchlistMap, colors, typo, toggle],
  );

  const renderResults = () => {
    if (isError) {
      return (
        <View style={styles.centered}>
          <Feather name="wifi-off" size={48} color={colors.textTertiary} />
          <Text style={[typo.body, { color: colors.textSecondary, marginTop: spacing.md }]}>
            검색에 실패했습니다. 인터넷 연결을 확인해 주세요.
          </Text>
          <TouchableOpacity
            style={[styles.retryBtn, { borderColor: colors.primary }]}
            onPress={() => refetch()}
            accessibilityRole="button"
            accessibilityLabel="검색 재시도"
          >
            <Text style={[typo.bodyMedium, { color: colors.primary }]}>재시도</Text>
          </TouchableOpacity>
        </View>
      );
    }

    if (isLoading) {
      return (
        <View style={styles.centered}>
          <ActivityIndicator color={colors.primary} />
        </View>
      );
    }

    const list = results ?? [];
    return (
      <FlatList
        data={list}
        renderItem={renderItem}
        keyExtractor={(item) => item.corpCode}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        contentContainerStyle={styles.listContent}
        initialNumToRender={12}
        ListHeaderComponent={
          list.length > 0 ? (
            <Text style={[typo.caption, styles.sectionLabel, { color: colors.textSecondary }]}>
              검색 결과 {list.length}개
            </Text>
          ) : null
        }
        ListEmptyComponent={
          <View style={styles.centered}>
            <Feather name="search" size={48} color={colors.textTertiary} />
            <Text style={[typo.body, { color: colors.textSecondary, marginTop: spacing.md }]}>
              검색 결과가 없습니다.
            </Text>
            <Text
              style={[
                typo.small,
                { color: colors.textTertiary, marginTop: spacing.xs, textAlign: 'center' },
              ]}
            >
              {`"${term}"을(를) 다시 확인하거나\n종목코드 6자리로 검색해 보세요.`}
            </Text>
          </View>
        }
      />
    );
  };

  const renderBrowse = () => {
    const popularList = popular ?? [];
    return (
      <FlatList
        data={popularList}
        renderItem={renderItem}
        keyExtractor={(item) => item.corpCode}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        contentContainerStyle={styles.listContent}
        initialNumToRender={12}
        ListHeaderComponent={
          <View>
            {recent.length > 0 ? (
              <View style={styles.recentSection}>
                <Text style={[typo.caption, styles.sectionLabel, { color: colors.textSecondary }]}>
                  최근 검색
                </Text>
                <View style={styles.chipRow}>
                  {recent.map((c) => (
                    <TouchableOpacity
                      key={c.corpCode}
                      style={[styles.chip, { backgroundColor: colors.surface }]}
                      activeOpacity={0.7}
                      onPress={() => setQuery(c.corpName)}
                      accessibilityRole="button"
                      accessibilityLabel={`${c.corpName} 다시 검색`}
                    >
                      <Text style={[typo.small, { color: colors.text }]}>{c.corpName}</Text>
                      <TouchableOpacity
                        onPress={() => removeRecent(c.corpCode)}
                        hitSlop={8}
                        accessibilityRole="button"
                        accessibilityLabel={`${c.corpName} 최근 검색에서 삭제`}
                      >
                        <Feather name="x" size={14} color={colors.textTertiary} />
                      </TouchableOpacity>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>
            ) : null}
            {popularList.length > 0 ? (
              <Text style={[typo.caption, styles.sectionLabel, { color: colors.textSecondary }]}>
                인기 종목
              </Text>
            ) : null}
          </View>
        }
      />
    );
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={handleClose}
    >
      <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={['top']}>
        <KeyboardAvoidingView
          style={styles.container}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          {/* Header + Searchbar */}
          <View style={styles.header}>
            <View style={[styles.searchBar, { backgroundColor: colors.surface }]}>
              <Feather name="search" size={18} color={colors.textTertiary} />
              <TextInput
                style={[typo.body, styles.searchInput, { color: colors.text }]}
                placeholder="종목명 또는 종목코드 검색"
                placeholderTextColor={colors.textTertiary}
                value={query}
                onChangeText={setQuery}
                autoFocus
                returnKeyType="search"
                accessibilityLabel="관심 기업 검색"
                accessibilityHint="종목명 또는 종목코드 6자리로 검색하세요"
              />
              {query.length > 0 ? (
                <TouchableOpacity
                  onPress={() => setQuery('')}
                  hitSlop={8}
                  accessibilityRole="button"
                  accessibilityLabel="검색어 지우기"
                >
                  <Feather name="x-circle" size={18} color={colors.textTertiary} />
                </TouchableOpacity>
              ) : null}
            </View>
            <TouchableOpacity
              onPress={handleClose}
              hitSlop={8}
              style={styles.cancelBtn}
              accessibilityRole="button"
              accessibilityLabel="검색 취소"
            >
              <Text style={[typo.body, { color: colors.primary }]}>취소</Text>
            </TouchableOpacity>
          </View>

          {atLimit ? (
            <View style={styles.limitBanner}>
              <Text style={[typo.small, { color: colors.error }]}>
                관심 기업 한도에 도달했어요 ({total}/{MAX_WATCHLIST_COUNT})
              </Text>
            </View>
          ) : null}

          {searching ? renderResults() : renderBrowse()}
        </KeyboardAvoidingView>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    gap: spacing.sm,
  },
  searchBar: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: Platform.OS === 'ios' ? spacing.sm + 2 : spacing.sm,
    borderRadius: radius.md,
    gap: spacing.sm,
  },
  searchInput: {
    flex: 1,
    paddingVertical: spacing.xs,
  },
  cancelBtn: {
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.xs,
  },
  limitBanner: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.sm,
  },
  listContent: {
    flexGrow: 1,
    paddingBottom: spacing['2xl'],
  },
  sectionLabel: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
  },
  recentSection: {
    paddingBottom: spacing.sm,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingHorizontal: spacing.lg,
    gap: spacing.sm,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radius.full,
    gap: spacing.xs,
  },
  resultItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    minHeight: 56,
  },
  companyInfo: {
    flex: 1,
  },
  toggleBtn: {
    width: 44,
    height: 44,
    borderRadius: radius.full,
    borderWidth: 1.5,
    justifyContent: 'center',
    alignItems: 'center',
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 60,
    paddingHorizontal: spacing.lg,
  },
  retryBtn: {
    marginTop: spacing.lg,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.xl,
    borderRadius: radius.md,
    borderWidth: 1,
  },
});
