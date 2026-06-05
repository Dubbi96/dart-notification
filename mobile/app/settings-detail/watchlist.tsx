import React, { useState } from 'react';
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
import { Star } from 'phosphor-react-native';
import { router } from 'expo-router';
import { useTheme } from '@theme';
import { spacing, radius } from '@theme/spacing';
import { formatDistanceToNow, parse } from 'date-fns';
import { ko } from 'date-fns/locale';
import { useWatchlist, useRemoveFromWatchlist } from '@hooks/useWatchlist';
import { useDialog } from '@components/common/DialogProvider';
import { SearchOverlay } from '@components/common/SearchOverlay';

export default function WatchlistScreen() {
  const { colors, typography: typo } = useTheme();
  const { showDialog } = useDialog();
  const { data, isLoading, refetch } = useWatchlist();
  const removeFromWatchlist = useRemoveFromWatchlist();

  const [searchVisible, setSearchVisible] = useState(false);

  const watchlistItems = data?.data ?? [];
  const total = data?.meta?.total ?? 0;
  const limit = data?.meta?.limit ?? 30;

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
          <View style={styles.emptyContainer}>
            <Star size={48} color={colors.textTertiary} weight="thin" />
            <Text style={[typo.body, { color: colors.textSecondary, marginTop: spacing.md }]}>
              관심 기업이 없습니다
            </Text>
            <Text style={[typo.small, { color: colors.textTertiary, marginTop: spacing.xs }]}>
              기업을 추가하여 공시 알림을 받아보세요
            </Text>
          </View>
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
              <Text style={[typo.bodyMedium, { color: colors.text }]}>{item.corpName}</Text>
              <Text style={[typo.small, { color: colors.textSecondary }]}>
                {item.stockCode ? `${item.stockCode}${item.market ? ` · ${item.market}` : ''}` : ''}
                {item.stockCode && item.lastDisclosureDate ? ' · ' : ''}
                {item.lastDisclosureDate
                  ? `마지막 공시 ${formatDistanceToNow(parse(item.lastDisclosureDate, 'yyyyMMdd', new Date()), { addSuffix: true, locale: ko })}`
                  : !item.stockCode ? '공시 없음' : ''}
              </Text>
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
  emptyContainer: {
    alignItems: 'center',
    paddingTop: 60,
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
  itemActions: { flexDirection: 'row', gap: spacing.md },
  actionBtn: { padding: spacing.xs },
});
