import React, { useState, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  TextInput,
  FlatList,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
  ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { FileText, MagnifyingGlass } from 'phosphor-react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useTheme } from '@theme';
import { spacing, radius } from '@theme/spacing';
import { Card } from '@components/common/Card';
import { useDisclosures, useDisclosureSearch } from '@hooks/useDisclosures';
import { useDisclosureTypes } from '@hooks/useDisclosureTypes';
import { useRequireAuth } from '@hooks/useRequireAuth';
import { useAuthStore } from '@stores/authStore';
import { getTypeStyle, getTypeLabel } from '@utils/disclosureType';
import { parse, format } from 'date-fns';

export default function DisclosuresScreen() {
  const { colors, typography: typo, isDark } = useTheme();
  const { isAuthenticated, requireAuth } = useRequireAuth();
  const params = useLocalSearchParams<{ watchlistOnly?: string }>();
  const { data: disclosureTypes = [] } = useDisclosureTypes();
  const filters = useMemo(() => ['전체', ...disclosureTypes.map((t) => t.id)], [disclosureTypes]);
  const [activeFilter, setActiveFilter] = useState<string>('전체');
  const [watchlistOnly, setWatchlistOnly] = useState(params.watchlistOnly === 'true');
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [timer, setTimer] = useState<ReturnType<typeof setTimeout> | null>(null);
  const [searchFocused, setSearchFocused] = useState(false);

  const disclosureType = activeFilter === '전체' ? undefined : activeFilter;
  const isSearching = debouncedQuery.length > 0;

  const listQuery = useDisclosures(disclosureType, watchlistOnly);
  const searchQueryResult = useDisclosureSearch(debouncedQuery, disclosureType);

  const activeQuery = isSearching ? searchQueryResult : listQuery;

  const items = useMemo(() => {
    const all = activeQuery.data?.pages.flatMap((page) => page.data) ?? [];
    const seen = new Set<string>();
    return all.filter((item) => {
      if (seen.has(item.rcpNo)) return false;
      seen.add(item.rcpNo);
      return true;
    });
  }, [activeQuery.data]);

  const totalCount = activeQuery.data?.pages[0]?.meta.total ?? 0;

  const handleSearchChange = useCallback(
    (text: string) => {
      setSearchQuery(text);
      if (timer) clearTimeout(timer);
      const newTimer = setTimeout(() => setDebouncedQuery(text.trim()), 300);
      setTimer(newTimer);
    },
    [timer],
  );

  const handleFilterPress = (filter: string) => {
    setActiveFilter(filter);
  };

  const renderItem = ({ item }: { item: any }) => {
    const typeStyle = getTypeStyle(item.disclosureType, isDark);
    return (
      <TouchableOpacity
        activeOpacity={0.7}
        onPress={() => router.push(`/disclosure/${item.rcpNo}`)}
      >
        <Card style={styles.card} variant="elevated">
          <View style={styles.cardHeader}>
            <View style={[styles.typeBadge, { backgroundColor: typeStyle.bg }]}>
              <Text style={[typo.small, { color: typeStyle.text, fontWeight: '600' }]}>
                {getTypeLabel(item.disclosureType)}
              </Text>
            </View>
            <Text style={[typo.small, { color: colors.textTertiary }]}>{format(parse(item.rcpDt, 'yyyyMMdd', new Date()), 'yyyy.MM.dd')}</Text>
          </View>
          <Text
            style={[typo.bodyMedium, { color: colors.text, marginTop: spacing.sm }]}
            numberOfLines={2}
          >
            {item.reportName}
          </Text>
          <Text style={[typo.caption, { color: colors.textSecondary, marginTop: spacing.xs }]}>
            {item.corpName}
          </Text>
        </Card>
      </TouchableOpacity>
    );
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
      {/* Header */}
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={8}>
          <Ionicons name="chevron-back" size={26} color={colors.text} />
        </TouchableOpacity>
        <Text style={[typo.h3, { color: colors.text, marginLeft: spacing.sm }]}>전체 공시</Text>
        <View style={{ flex: 1 }} />
        <Text style={[typo.caption, { color: colors.textSecondary }]}>
          {totalCount.toLocaleString()}건
        </Text>
      </View>

      {/* Search Bar */}
      <View style={[
        styles.searchBar,
        {
          backgroundColor: colors.inputBackground,
          borderColor: searchFocused ? colors.primary : colors.inputBorder,
        },
      ]}>
        <Ionicons name="search" size={18} color={searchFocused ? colors.primary : colors.textTertiary} />
        <TextInput
          style={[typo.body, styles.searchInput, { color: colors.inputText }]}
          placeholder="기업명, 보고서명 검색"
          placeholderTextColor={colors.inputPlaceholder}
          value={searchQuery}
          onChangeText={handleSearchChange}
          onFocus={() => setSearchFocused(true)}
          onBlur={() => setSearchFocused(false)}
          returnKeyType="search"
        />

        {searchQuery.length > 0 && (
          <TouchableOpacity onPress={() => handleSearchChange('')} hitSlop={8}>
            <Ionicons name="close-circle" size={18} color={colors.textTertiary} />
          </TouchableOpacity>
        )}
      </View>

      {/* Filter Chips */}
      <View>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.filterRow}
          >
          {isAuthenticated && (
            <TouchableOpacity
              style={[
                styles.filterChip,
                watchlistOnly
                  ? { backgroundColor: colors.primary }
                  : { backgroundColor: colors.surface, borderColor: colors.borderLight, borderWidth: 1 },
              ]}
              onPress={() => setWatchlistOnly(!watchlistOnly)}
              activeOpacity={0.7}
            >
              <Ionicons
                name="star"
                size={12}
                color={watchlistOnly ? '#FFFFFF' : colors.primary}
              />
              <Text
                style={[
                  typo.small,
                  {
                    color: watchlistOnly ? '#FFFFFF' : colors.text,
                    fontWeight: watchlistOnly ? '600' : '400',
                  },
                ]}
              >
                관심목록
              </Text>
            </TouchableOpacity>
          )}
          {filters.map((filter) => {
            const isActive = activeFilter === filter;
            const typeStyle = filter !== '전체' ? getTypeStyle(filter, isDark) : null;
            return (
              <TouchableOpacity
                key={filter}
                style={[
                  styles.filterChip,
                  isActive
                    ? { backgroundColor: colors.primary }
                    : { backgroundColor: colors.surface, borderColor: colors.borderLight, borderWidth: 1 },
                ]}
                onPress={() => handleFilterPress(filter)}
                activeOpacity={0.7}
              >
                {!isActive && typeStyle && (
                  <View style={[styles.chipDot, { backgroundColor: typeStyle.text }]} />
                )}
                <Text
                  style={[
                    typo.small,
                    {
                      color: isActive ? '#FFFFFF' : colors.text,
                      fontWeight: isActive ? '600' : '400',
                    },
                  ]}
                >
                  {filter === '전체' ? '전체' : getTypeLabel(filter)}
                </Text>
              </TouchableOpacity>
            );
          })}
          </ScrollView>
        </View>

      {/* Login Banner */}
      {!isAuthenticated && (
        <TouchableOpacity
          style={{ paddingHorizontal: spacing.lg, marginTop: spacing.sm }}
          onPress={() => {
            useAuthStore.getState().clearAuth();
            router.push('/auth/sign-in');
          }}
          activeOpacity={0.7}
        >
          <View style={[styles.loginBanner, { borderColor: colors.primary, backgroundColor: colors.primaryLight }]}>
            <View style={[styles.loginIconCircle, { borderColor: colors.primary, backgroundColor: colors.surface }]}>
              <Ionicons name="person-outline" size={18} color={colors.primary} />
            </View>
            <View style={{ flex: 1, marginLeft: spacing.md }}>
              <Text style={[typo.bodyMedium, { color: colors.primaryDark }]}>
                로그인하고 시작하기
              </Text>
              <Text style={[typo.small, { color: colors.primary, marginTop: 2 }]}>
                관심기업 공시만 모아볼 수 있어요
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={16} color={colors.textTertiary} />
          </View>
        </TouchableOpacity>
      )}

      {/* List */}
      {activeQuery.isLoading ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      ) : (
        <FlatList
          data={items}
          renderItem={renderItem}
          keyExtractor={(item) => item.rcpNo}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          onEndReached={() => {
            if (activeQuery.hasNextPage && !activeQuery.isFetchingNextPage) {
              activeQuery.fetchNextPage();
            }
          }}
          onEndReachedThreshold={0.5}
          refreshControl={
            <RefreshControl
              refreshing={false}
              onRefresh={activeQuery.refetch}
              tintColor={colors.primary}
            />
          }
          ListFooterComponent={
            activeQuery.isFetchingNextPage ? (
              <ActivityIndicator style={{ paddingVertical: spacing.lg }} color={colors.primary} />
            ) : null
          }
          ListEmptyComponent={
            <View style={styles.centered}>
              {isSearching
                ? <MagnifyingGlass size={48} color={colors.textTertiary} weight="thin" />
                : <FileText size={48} color={colors.textTertiary} weight="thin" />
              }
              <Text style={[typo.body, { color: colors.textSecondary, marginTop: spacing.md }]}>
                {isSearching ? '검색 결과가 없습니다' : '공시 데이터가 없습니다'}
              </Text>
            </View>
          }
        />
      )}
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
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
  },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: spacing.lg,
    marginTop: spacing.md,
    paddingHorizontal: spacing.md,
    minHeight: 48,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
    borderWidth: 1,
    gap: spacing.sm,
  },
  searchInput: {
    flex: 1,
    paddingVertical: spacing.xs,
  },
  filterRow: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    flexGrow: 1,
    gap: spacing.sm,
  },
  filterChip: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.full,
    height: 34,
    gap: spacing.xs,
  },
  chipDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  listContent: {
    paddingTop: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.xl,
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
  typeBadge: {
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: radius.sm,
  },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingTop: 60,
  },
  loginBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.base,
    paddingVertical: spacing.base,
    borderRadius: radius.lg,
    borderWidth: 1,
  },
  loginIconCircle: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
});
