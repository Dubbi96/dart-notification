import React, { useMemo } from 'react';
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
import { router, type Href } from 'expo-router';
import { useTheme } from '@theme';
import { spacing } from '@theme/spacing';
import { useAuthStore } from '@stores/authStore';
import { EmptyState } from '@components/common/StateView';
import { emptyStateCopy } from '@components/common/emptyStateCopy';
import { AppRefreshControl } from '@components/common/AppRefreshControl';
import { useSnackbar } from '@components/common/SnackbarProvider';
import { snackbarCopy, SNACKBAR_DURATION } from '@components/common/snackbarCopy';
import { useNotifications, useMarkAsRead, useMarkAllAsRead } from '@hooks/useNotifications';
import { getTypeLabel } from '@utils/disclosureType';
import { formatDistanceToNow } from 'date-fns';
import { ko } from 'date-fns/locale';

import type { Notification, NotificationType } from '@app-types/notification.types';

// DAR-84: 통합 인박스 — 타입별 아이콘/색상 토큰(하드코딩 색상 0) + 폴백 라벨
type TypeMeta = {
  icon: keyof typeof Ionicons.glyphMap;
  colorKey: 'primary' | 'success' | 'warning' | 'error';
  label: string;
};
const NOTIFICATION_TYPE_META: Record<NotificationType, TypeMeta> = {
  DISCLOSURE: { icon: 'document-text-outline', colorKey: 'primary', label: '공시' },
  SIGNAL: { icon: 'trending-up-outline', colorKey: 'success', label: '신호' },
  EXIT: { icon: 'log-out-outline', colorKey: 'warning', label: '청산' },
  THESIS_VIOLATED: { icon: 'alert-circle-outline', colorKey: 'error', label: '논리훼손' },
};
const getTypeMeta = (type: NotificationType): TypeMeta =>
  NOTIFICATION_TYPE_META[type] ?? NOTIFICATION_TYPE_META.DISCLOSURE;

export default function NotificationsScreen() {
  const { colors, typography: typo } = useTheme();
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const { showSnackbar } = useSnackbar();

  const {
    data,
    fetchNextPage,
    hasNextPage,
    isLoading,
    isRefetching,
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
        <EmptyState
          {...emptyStateCopy.notificationsGuest}
          onAction={() => {
            useAuthStore.getState().clearAuth();
            router.push('/auth/sign-in');
          }}
        />
      </SafeAreaView>
    );
  }

  const handleNotificationPress = (item: Notification) => {
    if (!item.isRead) {
      markAsRead.mutate(item.id);
    }
    // DAR-84: deepLink 우선, 없으면 공시 라우트로 폴백
    if (item.deepLink) {
      router.push(item.deepLink as Href);
    } else if (item.disclosureRcpNo) {
      router.push(`/disclosure/${item.disclosureRcpNo}`);
    }
  };

  const handleMarkAllAsRead = () => {
    if (unreadCount === 0) return;
    const count = unreadCount;
    markAllAsRead.mutate();
    showSnackbar(snackbarCopy.allNotificationsRead(count), { duration: SNACKBAR_DURATION.success });
  };

  const renderItem = ({ item }: { item: Notification }) => {
    const meta = getTypeMeta(item.type);
    const accent = colors[meta.colorKey];
    // DAR-84 다형 표시: 공시는 조인 데이터 우선, 그 외 타입은 title/body 사용
    const primaryText =
      item.disclosure
        ? `${item.disclosure.corpName} · ${getTypeLabel(item.disclosure.disclosureType)}`
        : (item.title ?? meta.label);
    const secondaryText = item.disclosure?.reportName ?? item.body ?? '';

    return (
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
        <View style={[styles.iconWrap, { backgroundColor: colors.surface }]}>
          <Ionicons name={meta.icon} size={18} color={accent} />
          {!item.isRead && (
            <View style={[styles.unreadDot, { backgroundColor: accent, borderColor: colors.surface }]} />
          )}
        </View>
        <View style={styles.notificationContent}>
          <Text style={[typo.captionMedium, { color: colors.text }]} numberOfLines={1}>
            {primaryText}
          </Text>
          {secondaryText ? (
            <Text
              style={[typo.caption, { color: colors.textSecondary, marginTop: 2 }]}
              numberOfLines={2}
            >
              {secondaryText}
            </Text>
          ) : null}
          <Text style={[typo.small, { color: colors.textTertiary, marginTop: spacing.xs }]}>
            {formatDistanceToNow(new Date(item.sentAt), { addSuffix: true, locale: ko })}
          </Text>
        </View>
        <Ionicons name="chevron-forward" size={18} color={colors.textTertiary} />
      </TouchableOpacity>
    );
  };

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
          <AppRefreshControl refreshing={isRefetching} onRefresh={refetch} />
        }
        ListEmptyComponent={<EmptyState {...emptyStateCopy.notificationsEmpty} />}
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
  iconWrap: {
    width: 36,
    height: 36,
    borderRadius: 18,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: spacing.md,
  },
  unreadDot: {
    position: 'absolute',
    top: -1,
    right: -1,
    width: 10,
    height: 10,
    borderRadius: 5,
    borderWidth: 1.5,
  },
  notificationContent: {
    flex: 1,
    marginRight: spacing.sm,
  },
});
