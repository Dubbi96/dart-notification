import React from 'react';
import {
  View,
  Text,
  FlatList,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons, Feather } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useTheme } from '@theme';
import { spacing, radius } from '@theme/spacing';
import { useWatchlist, useRemoveFromWatchlist } from '@hooks/useWatchlist';

export default function WatchlistScreen() {
  const { colors, typography: typo } = useTheme();
  const { data, isLoading, refetch } = useWatchlist();
  const removeFromWatchlist = useRemoveFromWatchlist();

  const watchlistItems = data?.data ?? [];
  const total = data?.meta?.total ?? 0;
  const limit = data?.meta?.limit ?? 30;

  if (isLoading) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
        <View style={[styles.header, { borderBottomColor: colors.border }]}>
          <TouchableOpacity onPress={() => router.back()} style={styles.headerButton}>
            <Ionicons name="arrow-back" size={24} color={colors.text} />
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
          <Ionicons name="arrow-back" size={24} color={colors.text} />
        </TouchableOpacity>
        <Text style={[typo.h3, { color: colors.text, flex: 1, textAlign: 'center' }]}>
          관심목록
        </Text>
        <TouchableOpacity style={styles.headerButton}>
          <Ionicons name="add" size={24} color={colors.primary} />
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
            <Feather name="star" size={44} color={colors.textTertiary} />
            <Text style={[typo.body, { color: colors.textSecondary, marginTop: spacing.md }]}>
              관심 기업이 없습니다
            </Text>
            <Text style={[typo.small, { color: colors.textTertiary, marginTop: spacing.xs }]}>
              기업을 추가하여 공시 알림을 받아보세요
            </Text>
          </View>
        }
        renderItem={({ item }) => (
          <View
            style={[
              styles.watchlistItem,
              { backgroundColor: colors.surface, borderColor: colors.borderLight },
            ]}
          >
            <View style={styles.itemContent}>
              <Text style={[typo.bodyMedium, { color: colors.text }]}>{item.corpName}</Text>
              <Text style={[typo.small, { color: colors.textSecondary }]}>{item.corpCode}</Text>
            </View>
            <View style={styles.itemActions}>
              <TouchableOpacity
                style={styles.actionBtn}
                onPress={() => removeFromWatchlist.mutate(item.id)}
              >
                <Ionicons name="trash-outline" size={20} color={colors.error} />
              </TouchableOpacity>
            </View>
          </View>
        )}
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
