import React from 'react';
import { Text, type ColorValue, type TextStyle } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { Tabs } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useUnreadCount } from '@hooks/useNotifications';
import { usePositions } from '@hooks/usePortfolio';
import { useAuthStore } from '@stores/authStore';
import { useTheme } from '@theme';
import { spacing } from '@theme/spacing';
import { formatUnreadBadge } from '@utils/unreadBadge';
import { SHOW_TRADING } from '@utils/tradingVisibility';

export { ErrorFallback as ErrorBoundary } from '@components/common/ErrorFallback';

const TAB_BAR_CONTENT_HEIGHT = 64;

function TabLabel({
  label,
  color,
  fontSize,
}: {
  label: string;
  color: ColorValue;
  fontSize: number;
}) {
  return (
    <Text
      style={{
        color,
        fontSize,
        lineHeight: Math.ceil(fontSize * 1.4),
        fontWeight: '500',
        minWidth: 0,
      }}
      numberOfLines={1}
      allowFontScaling={false}
    >
      {label}
    </Text>
  );
}

export default function TabLayout() {
  const { colors, typography: typo } = useTheme();
  const insets = useSafeAreaInsets();
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const { data: unreadCount = 0 } = useUnreadCount({ enabled: isAuthenticated });
  const { data: positions } = usePositions({ enabled: isAuthenticated && SHOW_TRADING });
  const violatedCount = (positions ?? []).filter(
    (position) => position.thesisStatus === 'VIOLATED',
  ).length;
  const bottomPadding = Math.max(insets.bottom, spacing.sm);
  const tabContentHeight = TAB_BAR_CONTENT_HEIGHT + typo.caption.lineHeight - 20;
  const unreadBadge = formatUnreadBadge(unreadCount);
  const positionBadge = violatedCount > 0 ? violatedCount : undefined;
  const badgeHeight = Math.max(20, typo.small.lineHeight);
  // 내장 배지의 31dp 아이콘 폭/고정 높이에 글자만 커지지 않도록 배지도 함께 확장한다.
  const badgeStyle = (label: string | number | undefined): TextStyle => ({
    backgroundColor: colors.error,
    fontSize: typo.small.fontSize,
    fontVariant: ['tabular-nums'],
    width: Math.max(
      badgeHeight,
      Math.ceil(String(label ?? '').length * typo.small.fontSize * 0.75) + spacing.sm,
    ),
    height: badgeHeight,
    lineHeight: badgeHeight,
    borderRadius: badgeHeight / 2,
  });

  return (
    <Tabs
      initialRouteName="signals/index"
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.tabActive,
        tabBarInactiveTintColor: colors.tabInactive,
        tabBarStyle: {
          backgroundColor: colors.tabBar,
          borderTopColor: colors.tabBarBorder,
          borderTopWidth: 1,
          paddingBottom: bottomPadding,
          paddingTop: spacing.sm,
          height: tabContentHeight + bottomPadding,
        },
        tabBarLabelPosition: 'below-icon',
        // 배지의 Animated.Text는 전역 Text 래퍼 밖에 있어 OS 배율 중복 적용을 명시적으로 막는다.
        tabBarAllowFontScaling: false,
      }}
    >
      <Tabs.Screen
        name="signals/index"
        options={{
          title: '판단',
          tabBarIcon: ({ color, size }) => <Feather name="compass" size={size} color={color} />,
          tabBarLabel: ({ color }) => (
            <TabLabel label="판단" color={color} fontSize={typo.caption.fontSize} />
          ),
        }}
      />
      <Tabs.Screen
        name="portfolio/index"
        options={{
          title: '포지션',
          href: SHOW_TRADING ? undefined : null,
          tabBarIcon: ({ color, size }) => <Feather name="briefcase" size={size} color={color} />,
          tabBarLabel: ({ color }) => (
            <TabLabel label="포지션" color={color} fontSize={typo.caption.fontSize} />
          ),
          tabBarBadge: positionBadge,
          tabBarBadgeStyle: badgeStyle(positionBadge),
        }}
      />
      <Tabs.Screen
        name="notifications/index"
        options={{
          title: '알림',
          tabBarIcon: ({ color, size }) => <Feather name="bell" size={size} color={color} />,
          tabBarLabel: ({ color }) => (
            <TabLabel label="알림" color={color} fontSize={typo.caption.fontSize} />
          ),
          tabBarBadge: unreadBadge,
          tabBarBadgeStyle: badgeStyle(unreadBadge),
        }}
      />
      <Tabs.Screen
        name="settings/index"
        options={{
          title: '제어',
          tabBarIcon: ({ color, size }) => <Feather name="shield" size={size} color={color} />,
          tabBarLabel: ({ color }) => (
            <TabLabel label="제어" color={color} fontSize={typo.caption.fontSize} />
          ),
        }}
      />
      <Tabs.Screen name="home/index" options={{ href: null }} />
    </Tabs>
  );
}
