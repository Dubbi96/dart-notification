import React, { useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  FlatList,
  ActivityIndicator,
  RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons, Feather } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useTheme } from '@theme';
import { spacing, radius } from '@theme/spacing';
import { Card } from '@components/common/Card';
import { GlassCard } from '@components/common/GlassCard';
import { useDisclosures } from '@hooks/useDisclosures';

function getTypeColor(type: string, primary: string, info: string, warning: string) {
  switch (type) {
    case '정기보고서':
      return primary;
    case '주요사항보고':
      return info;
    case '지분변동':
      return warning;
    default:
      return primary;
  }
}

export default function HomeScreen() {
  const { colors, typography: typo, isDark } = useTheme();
  const {
    data,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isLoading,
    refetch,
  } = useDisclosures();

  const disclosures = useMemo(
    () => data?.pages.flatMap((page) => page.data) ?? [],
    [data],
  );

  const totalCount = data?.pages[0]?.meta.total ?? 0;

  const renderDisclosureItem = ({ item }: { item: any }) => (
    <TouchableOpacity
      activeOpacity={0.7}
      onPress={() => router.push(`/disclosure/${item.id}`)}
    >
      <Card style={styles.disclosureCard} variant="elevated">
        <View style={styles.disclosureHeader}>
          <View
            style={[
              styles.typeBadge,
              { backgroundColor: getTypeColor(item.disclosureType, colors.primaryLight, colors.info + '20', colors.warning + '20') },
            ]}
          >
            <Text
              style={[
                typo.small,
                { color: getTypeColor(item.disclosureType, colors.primary, colors.info, colors.warning), fontWeight: '600' },
              ]}
            >
              {item.disclosureType}
            </Text>
          </View>
          <Text style={[typo.small, { color: colors.textTertiary }]}>{item.rcpDt}</Text>
        </View>
        <Text style={[typo.bodyMedium, { color: colors.text, marginTop: spacing.sm }]} numberOfLines={2}>
          {item.reportName}
        </Text>
        <Text style={[typo.caption, { color: colors.textSecondary, marginTop: spacing.xs }]}>
          {item.corpName}
        </Text>
      </Card>
    </TouchableOpacity>
  );

  if (isLoading) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={['top']}>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={['top']}>
      {/* Header - Paychain style gradient header */}
      <LinearGradient
        colors={[colors.cardGradientStart, colors.cardGradientEnd]}
        style={styles.header}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
      >
        <View style={styles.headerTop}>
          <View>
            <Text style={[typo.caption, { color: 'rgba(255,255,255,0.7)' }]}>좋은 아침이에요</Text>
            <Text style={[typo.h2, { color: '#FFFFFF', marginTop: 2 }]}>DART 알리미</Text>
          </View>
          <TouchableOpacity
            style={styles.headerIcon}
            onPress={() => router.push('/(tabs)/notifications')}
          >
            <GlassCard intensity={20} variant="iridescent" style={styles.headerIconGlass}>
              <View style={styles.headerIconInner}>
                <Ionicons name="notifications-outline" size={22} color="#FFFFFF" />
              </View>
            </GlassCard>
          </TouchableOpacity>
        </View>

        {/* Summary card - Glassmorphism + Holographic iridescent */}
        <GlassCard style={styles.summaryCard} intensity={30} variant="iridescent">
          <View style={styles.summaryContent}>
            <View style={styles.summaryItem}>
              <Text style={[typo.h2, { color: '#FFFFFF' }]}>{totalCount}</Text>
              <Text style={[typo.small, { color: 'rgba(255,255,255,0.8)' }]}>오늘의 공시</Text>
            </View>
            <View style={[styles.summaryDivider, { backgroundColor: 'rgba(255,255,255,0.25)' }]} />
            <View style={styles.summaryItem}>
              <Text style={[typo.h2, { color: '#FFFFFF' }]}>-</Text>
              <Text style={[typo.small, { color: 'rgba(255,255,255,0.8)' }]}>관심 기업</Text>
            </View>
            <View style={[styles.summaryDivider, { backgroundColor: 'rgba(255,255,255,0.25)' }]} />
            <View style={styles.summaryItem}>
              <Text style={[typo.h2, { color: '#FFFFFF' }]}>-</Text>
              <Text style={[typo.small, { color: 'rgba(255,255,255,0.8)' }]}>새 알림</Text>
            </View>
          </View>
        </GlassCard>
      </LinearGradient>

      {/* Content area with top border radius */}
      <View style={[styles.contentArea, { backgroundColor: colors.background }]}>
      {/* Quick Actions - Paychain style icon row */}
      <View style={styles.quickActions}>
        {[
          { icon: 'search-outline' as const, label: '검색' },
          { icon: 'star-outline' as const, label: '관심목록' },
          { icon: 'filter-outline' as const, label: '필터' },
          { icon: 'bookmark-outline' as const, label: '저장됨' },
        ].map((action) => (
          <TouchableOpacity key={action.label} style={styles.actionItem}>
            <View style={[styles.actionIcon, { backgroundColor: colors.primaryLight }]}>
              <Ionicons name={action.icon} size={22} color={colors.primary} />
            </View>
            <Text style={[typo.small, { color: colors.textSecondary, marginTop: spacing.xs }]}>
              {action.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Recent Disclosures */}
      <View style={styles.sectionHeader}>
        <Text style={[typo.h3, { color: colors.text }]}>최근 공시</Text>
        <TouchableOpacity>
          <Text style={[typo.captionMedium, { color: colors.primary }]}>전체보기</Text>
        </TouchableOpacity>
      </View>

      <FlatList
        data={disclosures}
        renderItem={renderDisclosureItem}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.listContent}
        showsVerticalScrollIndicator={false}
        onEndReached={() => {
          if (hasNextPage && !isFetchingNextPage) {
            fetchNextPage();
          }
        }}
        onEndReachedThreshold={0.5}
        refreshControl={
          <RefreshControl
            refreshing={false}
            onRefresh={refetch}
            tintColor={colors.primary}
          />
        }
        ListFooterComponent={
          isFetchingNextPage ? (
            <ActivityIndicator style={{ paddingVertical: spacing.lg }} color={colors.primary} />
          ) : null
        }
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <Feather name="file-text" size={44} color={colors.textTertiary} />
            <Text style={[typo.body, { color: colors.textSecondary, marginTop: spacing.md }]}>
              공시 데이터가 없습니다
            </Text>
          </View>
        }
      />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
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
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.base,
    paddingBottom: spacing.xl + radius.xl,
  },
  headerTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  headerIcon: {
    width: 44,
    height: 44,
  },
  headerIconGlass: {
    width: 44,
    height: 44,
    borderRadius: radius.md,
  },
  headerIconInner: {
    width: 44,
    height: 44,
    justifyContent: 'center',
    alignItems: 'center',
  },
  summaryCard: {
    marginTop: spacing.lg,
  },
  summaryContent: {
    flexDirection: 'row',
    padding: spacing.base,
  },
  summaryItem: {
    flex: 1,
    alignItems: 'center',
  },
  summaryDivider: {
    width: 1,
  },
  contentArea: {
    flex: 1,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    marginTop: -radius.xl,
  },
  quickActions: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    paddingVertical: spacing.lg,
    paddingHorizontal: spacing.base,
  },
  actionItem: {
    alignItems: 'center',
  },
  actionIcon: {
    width: 48,
    height: 48,
    borderRadius: radius.md,
    justifyContent: 'center',
    alignItems: 'center',
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    marginBottom: spacing.md,
  },
  listContent: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.xl,
    gap: spacing.md,
  },
  disclosureCard: {
    marginBottom: 0,
  },
  disclosureHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  typeBadge: {
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: radius.sm,
  },
});
