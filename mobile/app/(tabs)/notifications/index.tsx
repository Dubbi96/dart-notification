import React, { useMemo, useCallback, useRef, useState } from 'react';
import {
  View,
  Text,
  FlatList,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router, useScrollToTop, type Href } from 'expo-router';
import { useTheme } from '@theme';
import { spacing, radius } from '@theme/spacing';
import { useAuthStore } from '@stores/authStore';
import { EmptyState, ApiErrorState } from '@components/common/StateView';
import { SkeletonList } from '@components/common/SkeletonCard';
import { GuestPrompt } from '@components/common/GuestPrompt';
import { emptyStateCopy } from '@components/common/emptyStateCopy';
import { guestPromptCopy } from '@components/common/guestPromptCopy';
import { useSnackbar } from '@components/common/SnackbarProvider';
import { snackbarCopy, SNACKBAR_DURATION } from '@components/common/snackbarCopy';
import { useNotifications, useMarkAsRead, useMarkAllAsRead } from '@hooks/useNotifications';
import { getTypeLabel } from '@utils/disclosureType';
import { resolveDeepLink } from '@utils/deeplink';
import { relativeTime } from '@utils/datetime';

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

// DAR-161: 알림 인박스 타입 필터 세그먼트. null = 전체.
type SegmentKey = NotificationType | null;
interface Segment {
  key: SegmentKey;
  label: string;
}
const SEGMENTS: readonly Segment[] = [
  { key: null, label: '전체' },
  { key: 'DISCLOSURE', label: '공시' },
  { key: 'SIGNAL', label: '신호' },
  { key: 'EXIT', label: '청산' },
  { key: 'THESIS_VIOLATED', label: '논리훼손' },
];

// DAR-161: 세그먼트 칩 — 타입별 미읽음 점 배지. 활성 시 primary 배경 + primaryForeground 텍스트.
interface TypeSegmentChipProps {
  segment: Segment;
  active: boolean;
  unread: number;
  onSelect: (key: SegmentKey) => void;
}

function TypeSegmentChipBase({ segment, active, unread, onSelect }: TypeSegmentChipProps) {
  const { colors, typography: typo } = useTheme();
  const handlePress = useCallback(() => onSelect(segment.key), [onSelect, segment.key]);

  const a11yLabel = unread > 0 ? `${segment.label}, 안 읽음 ${unread}개` : segment.label;

  return (
    <TouchableOpacity
      style={[
        styles.segmentChip,
        {
          backgroundColor: active ? colors.primary : colors.surfaceSecondary,
          borderColor: active ? colors.primary : colors.borderLight,
        },
      ]}
      activeOpacity={0.7}
      onPress={handlePress}
      hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      accessibilityLabel={a11yLabel}
    >
      <Text
        style={[
          typo.captionMedium,
          { color: active ? colors.primaryForeground : colors.textSecondary },
        ]}
      >
        {segment.label}
      </Text>
      {unread > 0 && (
        <View
          style={[
            styles.segmentBadge,
            { backgroundColor: active ? colors.primaryForeground : colors.primary },
          ]}
        >
          <Text
            style={[
              typo.small,
              styles.segmentBadgeText,
              { color: active ? colors.primary : colors.primaryForeground },
            ]}
          >
            {unread > 99 ? '99+' : unread}
          </Text>
        </View>
      )}
    </TouchableOpacity>
  );
}

const TypeSegmentChip = React.memo(TypeSegmentChipBase);

// DAR-128: 알림 행을 메모이즈된 자식으로 분리(FlatList 리렌더 차단) + a11y 라벨/역할/터치영역 일관화.
interface NotificationRowProps {
  item: Notification;
  onPress: (item: Notification) => void;
}

function NotificationRowBase({ item, onPress }: NotificationRowProps) {
  const { colors, typography: typo } = useTheme();
  const meta = getTypeMeta(item.type);
  const accent = colors[meta.colorKey];
  // DAR-84 다형 표시: 공시는 조인 데이터 우선, 그 외 타입은 title/body 사용
  const primaryText = item.disclosure
    ? `${item.disclosure.corpName} · ${getTypeLabel(item.disclosure.disclosureType)}`
    : (item.title ?? meta.label);
  const secondaryText = item.disclosure?.reportName ?? item.body ?? '';
  const sentAtLabel = relativeTime(item.sentAt);

  const handlePress = useCallback(() => onPress(item), [onPress, item]);

  // 카드 그룹핑: 행을 단일 단위로 읽기(타입·내용·시각·읽음 상태 합성).
  const a11yLabel = [
    meta.label,
    item.isRead ? '읽음' : '안 읽음',
    primaryText,
    secondaryText,
    sentAtLabel,
  ]
    .filter(Boolean)
    .join(', ');

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
      onPress={handlePress}
      accessibilityRole="button"
      accessibilityLabel={a11yLabel}
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
          <Text style={[typo.caption, { color: colors.textSecondary, marginTop: 2 }]} numberOfLines={2}>
            {secondaryText}
          </Text>
        ) : null}
        <Text style={[typo.small, { color: colors.textTertiary, marginTop: spacing.xs }]}>
          {sentAtLabel}
        </Text>
      </View>
      <Ionicons name="chevron-forward" size={18} color={colors.textTertiary} />
    </TouchableOpacity>
  );
}

const NotificationRow = React.memo(NotificationRowBase);

export default function NotificationsScreen() {
  const { colors, typography: typo } = useTheme();
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const { showSnackbar } = useSnackbar();

  // DAR-161: 선택된 타입 세그먼트(null = 전체). queryKey에 반영돼 캐시가 분리된다.
  const [selectedType, setSelectedType] = useState<SegmentKey>(null);

  // DAR-181: 탭 재탭 시 알림 리스트 최상단 복귀.
  const listRef = useRef<FlatList<Notification>>(null);
  useScrollToTop(listRef);

  const {
    data,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isLoading,
    isError,
    error,
    isRefetching,
    refetch,
  } = useNotifications({ enabled: isAuthenticated, type: selectedType ?? undefined });
  const markAsRead = useMarkAsRead();
  const markAllAsRead = useMarkAllAsRead();

  const notifications = useMemo(
    () => data?.pages.flatMap((page) => page.data) ?? [],
    [data],
  );

  const unreadCount = data?.pages[0]?.meta.unreadCount ?? 0;
  // 타입별 미읽음 — 세그먼트 점 배지용(전체 기준, 현재 필터와 무관).
  const unreadByType = data?.pages[0]?.meta.unreadByType ?? {};

  const handleSelectType = useCallback((key: SegmentKey) => setSelectedType(key), []);

  // Hooks는 조건부 early return 위에서 호출(rules-of-hooks).
  const handleNotificationPress = useCallback(
    (item: Notification) => {
      if (!item.isRead) {
        markAsRead.mutate(item.id);
      }
      // DAR-90: deepLink 화이트리스트 검증 우선, 없으면 공시 rcpNo 폴백(미허용은 무시)
      // DAR-150: deepLink 미충전 비공시 알림은 type·refId 타입별 폴백으로 라우팅,
      // 그래도 대상이 없으면 스낵바로 안내해 무반응(dead tap) 제거.
      const target = resolveDeepLink(item);
      if (target) {
        router.push(target as Href);
      } else {
        showSnackbar(snackbarCopy.notificationNoTarget, { duration: SNACKBAR_DURATION.error });
      }
    },
    [markAsRead, showSnackbar],
  );

  const handleMarkAllAsRead = useCallback(() => {
    if (unreadCount === 0) return;
    const count = unreadCount;
    markAllAsRead.mutate();
    showSnackbar(snackbarCopy.allNotificationsRead(count), { duration: SNACKBAR_DURATION.success });
  }, [unreadCount, markAllAsRead, showSnackbar]);

  const renderItem = useCallback(
    ({ item }: { item: Notification }) => (
      <NotificationRow item={item} onPress={handleNotificationPress} />
    ),
    [handleNotificationPress],
  );

  if (!isAuthenticated) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
        <View style={[styles.header, { borderBottomColor: colors.borderLight }]}>
          <Text style={[typo.h2, { color: colors.text }]}>알림</Text>
        </View>
        {/* DAR-113: 빈/에러 화면 대신 가치 프리뷰 + 로그인 CTA로 자연스러운 로그인 유도. */}
        <GuestPrompt {...guestPromptCopy.notifications} />
      </SafeAreaView>
    );
  }

  if (isLoading) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={['top']}>
        <View style={[styles.header, { borderBottomColor: colors.border }]}>
          <Text style={[typo.h2, { color: colors.text }]}>알림</Text>
          <View />
        </View>
        {/* DAR-147 정렬: 중앙 스피너 대신 알림 카드 리스트 자리 스켈레톤(disclosures/signals와 일관). */}
        <SkeletonList variant="disclosure" />
      </SafeAreaView>
    );
  }

  // 장애를 '알림 없음' 빈 상태로 위장하지 않도록 에러는 명시 분기 + 재시도 동선 제공.
  if (isError) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={['top']}>
        <View style={[styles.header, { borderBottomColor: colors.border }]}>
          <Text style={[typo.h2, { color: colors.text }]}>알림</Text>
          <View />
        </View>
        <ApiErrorState
          error={error}
          onRetry={refetch}
          title="알림을 불러오지 못했습니다"
          description="잠시 후 다시 시도해 주세요."
        />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={['top']}>
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <Text style={[typo.h2, { color: colors.text }]}>알림</Text>
        <TouchableOpacity
          onPress={() => router.push('/settings-detail/notification-settings')}
          hitSlop={12}
          accessibilityRole="button"
          accessibilityLabel="알림 설정 열기"
        >
          <Text style={[typo.captionMedium, { color: colors.primary }]}>알림 설정</Text>
        </TouchableOpacity>
      </View>

      {/* DAR-161: 타입 세그먼트 칩 — 공시/신호/청산/논리훼손 + 전체, 타입별 미읽음 배지 */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.segmentRow}
      >
        {SEGMENTS.map((segment) => (
          <TypeSegmentChip
            key={segment.key ?? 'ALL'}
            segment={segment}
            active={selectedType === segment.key}
            unread={segment.key === null ? unreadCount : (unreadByType[segment.key] ?? 0)}
            onSelect={handleSelectType}
          />
        ))}
      </ScrollView>

      <View style={styles.subHeader}>
        {unreadCount > 0 && (
          <View style={[styles.unreadBadge, { backgroundColor: colors.primary }]}>
            <Text style={[typo.small, { color: colors.primaryForeground, fontWeight: '600' }]}>
              {unreadCount}개 안 읽음
            </Text>
          </View>
        )}
        <View style={{ flex: 1 }} />
        <TouchableOpacity
          onPress={handleMarkAllAsRead}
          hitSlop={12}
          disabled={unreadCount === 0}
          accessibilityRole="button"
          accessibilityLabel="모든 알림 읽음으로 표시"
          accessibilityState={{ disabled: unreadCount === 0 }}
        >
          <Text
            style={[typo.captionMedium, { color: unreadCount === 0 ? colors.textTertiary : colors.primary }]}
          >
            모두 읽음
          </Text>
        </TouchableOpacity>
      </View>

      <FlatList
        ref={listRef}
        data={notifications}
        renderItem={renderItem}
        keyExtractor={(item) => item.id}
        showsVerticalScrollIndicator={false}
        removeClippedSubviews={false}
        initialNumToRender={10}
        maxToRenderPerBatch={10}
        windowSize={9}
        onEndReached={() => {
          if (hasNextPage && !isFetchingNextPage) {
            fetchNextPage();
          }
        }}
        onEndReachedThreshold={0.5}
        refreshing={isRefetching}
        onRefresh={refetch}
        ListEmptyComponent={
          // 타입 필터 적용 중이면 '해당 타입 알림 없음'으로 정직하게 안내(장애 위장 방지).
          selectedType ? (
            <EmptyState
              icon="bell-off"
              title={`${getTypeMeta(selectedType).label} 알림이 아직 없어요`}
              description="다른 타입을 선택하거나 전체에서 확인해 보세요"
            />
          ) : (
            <EmptyState {...emptyStateCopy.notificationsEmpty} />
          )
        }
        ListFooterComponent={
          isFetchingNextPage ? (
            <View style={styles.footerLoading}>
              <ActivityIndicator size="small" color={colors.primary} />
            </View>
          ) : null
        }
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  footerLoading: {
    paddingVertical: spacing.lg,
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
  segmentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.xs,
  },
  segmentChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.base,
    paddingVertical: spacing.sm,
    borderRadius: radius.full,
    borderWidth: 1,
  },
  segmentBadge: {
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 5,
  },
  segmentBadgeText: {
    fontWeight: '700',
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
