import React, { useMemo } from 'react';
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
import { BellSlash } from 'phosphor-react-native';
import { router } from 'expo-router';
import { useTheme } from '@theme';
import { spacing } from '@theme/spacing';
import { useAuthStore } from '@stores/authStore';
import { useNotifications, useMarkAsRead, useMarkAllAsRead } from '@hooks/useNotifications';
import { getTypeLabel } from '@utils/disclosureType';
import { formatDistanceToNow } from 'date-fns';
import { ko } from 'date-fns/locale';

export default function NotificationsScreen() {
  const { colors, typography: typo } = useTheme();
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);

  const {
    data,
    fetchNextPage,
    hasNextPage,
    isLoading,
    refetch,
  } = useNotifications({ enabled: isAuthenticated });
  const markAsRead = useMarkAsRead();
  const markAllAsRead = useMarkAllAsRead();

  const notifications = useMemo(
    () => data?.pages.flatMap((page) => page.data) ?? [],
    [data],
  );

  const unreadCount = data?.pages[0]?.meta.unreadCount ?? 0;

  if (!isAuthenticated) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
        <View style={[styles.header, { borderBottomColor: colors.borderLight }]}>
          <Text style={[typo.h2, { color: colors.text }]}>알림</Text>
        </View>
        <View style={styles.guestContainer}>
          <BellSlash size={48} color={colors.textTertiary} weight="thin" />
          <Text style={[typo.body, { color: colors.textSecondary, marginTop: spacing.md }]}>
            로그인하고 알림을 받아보세요
          </Text>
          <TouchableOpacity
            style={[styles.loginButton, { backgroundColor: colors.primary }]}
            onPress={() => {
              useAuthStore.getState().clearAuth();
              router.push('/auth/sign-in');
            }}
          >
            <Text style={[typo.bodyMedium, { color: '#FFFFFF' }]}>로그인</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  const handleNotificationPress = (item: any) => {
    if (!item.isRead) {
      markAsRead.mutate(item.id);
    }
    router.push(`/disclosure/${item.disclosureRcpNo}`);
  };

  const handleMarkAllAsRead = () => {
    markAllAsRead.mutate();
  };

  const renderItem = ({ item }: { item: any }) => (
    <TouchableOpacity
      style={[
        styles.notificationItem,
        {
          backgroundColor: item.isRead ? colors.surface : colors.primaryLight,
          borderBottomColor: colors.borderLight,
        },
      ]}
      activeOpacity={0.7}
      onPress={() => handleNotificationPress(item)}
    >
      <View
        style={[
          styles.dot,
          { backgroundColor: item.isRead ? 'transparent' : colors.primary },
        ]}
      />
      <View style={styles.notificationContent}>
        <Text style={[typo.captionMedium, { color: colors.text }]} numberOfLines={1}>
          {item.disclosure.corpName} - {getTypeLabel(item.disclosure.disclosureType)}
        </Text>
        <Text
          style={[typo.caption, { color: colors.textSecondary, marginTop: 2 }]}
          numberOfLines={2}
        >
          {item.disclosure.reportName}
        </Text>
        <Text style={[typo.small, { color: colors.textTertiary, marginTop: spacing.xs }]}>
          {formatDistanceToNow(new Date(item.sentAt), { addSuffix: true, locale: ko })}
        </Text>
      </View>
      <Ionicons name="chevron-forward" size={18} color={colors.textTertiary} />
    </TouchableOpacity>
  );

  if (isLoading) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={['top']}>
        <View style={[styles.header, { borderBottomColor: colors.border }]}>
          <Text style={[typo.h2, { color: colors.text }]}>알림</Text>
          <View />
        </View>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={['top']}>
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <Text style={[typo.h2, { color: colors.text }]}>알림</Text>
        <TouchableOpacity onPress={() => router.push('/settings-detail/notification-settings')} hitSlop={8}>
          <Text style={[typo.captionMedium, { color: colors.primary }]}>알림 설정</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.subHeader}>
        {unreadCount > 0 && (
          <View style={[styles.unreadBadge, { backgroundColor: colors.primary }]}>
            <Text style={[typo.small, { color: '#FFFFFF', fontWeight: '600' }]}>{unreadCount}개 안 읽음</Text>
          </View>
        )}
        <View style={{ flex: 1 }} />
        <TouchableOpacity onPress={handleMarkAllAsRead}>
          <Text style={[typo.captionMedium, { color: colors.primary }]}>모두 읽음</Text>
        </TouchableOpacity>
      </View>

      <FlatList
        data={notifications}
        renderItem={renderItem}
        keyExtractor={(item) => item.id}
        showsVerticalScrollIndicator={false}
        onEndReached={() => {
          if (hasNextPage) {
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
        ListEmptyComponent={
          <View style={styles.empty}>
            <BellSlash size={48} color={colors.textTertiary} weight="thin" />
            <Text style={[typo.body, { color: colors.textSecondary, marginTop: spacing.md }]}>
              알림이 아직 없어요
            </Text>
          </View>
        }
      />
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
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.base,
    borderBottomWidth: 1,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  subHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  unreadBadge: {
    minWidth: 22,
    height: 22,
    borderRadius: 11,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 6,
  },
  notificationItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.base,
    borderBottomWidth: 1,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: spacing.md,
  },
  notificationContent: {
    flex: 1,
    marginRight: spacing.sm,
  },
  empty: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingTop: 120,
  },
  guestContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loginButton: {
    marginTop: spacing.lg,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.sm,
    borderRadius: 20,
  },
});
