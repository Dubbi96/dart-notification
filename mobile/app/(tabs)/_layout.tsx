import React from 'react';
import { Text, type ColorValue } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { Tabs } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useUnreadCount } from '@hooks/useNotifications';
import { usePositions } from '@hooks/usePortfolio';
import { useAuthStore } from '@stores/authStore';
import { MAX_CHIP_FONT_SCALE, useTheme } from '@theme';
import { spacing } from '@theme/spacing';
import { formatUnreadBadge } from '@utils/unreadBadge';
import { SHOW_TRADING } from '@utils/tradingVisibility';

export { ErrorFallback as ErrorBoundary } from '@components/common/ErrorFallback';

const TAB_BAR_CONTENT_HEIGHT = 54;

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
      style={{ color, fontSize, fontWeight: '500', flexShrink: 1, minWidth: 0 }}
      numberOfLines={1}
      ellipsizeMode="tail"
      adjustsFontSizeToFit
      minimumFontScale={0.8}
      maxFontSizeMultiplier={MAX_CHIP_FONT_SCALE}
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
          height: TAB_BAR_CONTENT_HEIGHT + bottomPadding,
        },
      }}
    >
      <Tabs.Screen
        name="signals/index"
        options={{
          title: '판단',
          tabBarIcon: ({ color, size }) => <Feather name="compass" size={size} color={color} />,
          tabBarLabel: ({ color }) => (
            <TabLabel label="판단" color={color} fontSize={typo.small.fontSize} />
          ),
        }}
      />
      <Tabs.Screen
        name="portfolio/index"
        options={{
          title: '포트폴리오',
          href: SHOW_TRADING ? undefined : null,
          tabBarIcon: ({ color, size }) => <Feather name="briefcase" size={size} color={color} />,
          tabBarLabel: ({ color }) => (
            <TabLabel label="포트폴리오" color={color} fontSize={typo.small.fontSize} />
          ),
          tabBarBadge: violatedCount > 0 ? violatedCount : undefined,
          tabBarBadgeStyle: { backgroundColor: colors.error, fontSize: typo.small.fontSize },
        }}
      />
      <Tabs.Screen
        name="notifications/index"
        options={{
          title: '알림',
          tabBarIcon: ({ color, size }) => <Feather name="bell" size={size} color={color} />,
          tabBarLabel: ({ color }) => (
            <TabLabel label="알림" color={color} fontSize={typo.small.fontSize} />
          ),
          tabBarBadge: formatUnreadBadge(unreadCount),
          tabBarBadgeStyle: { backgroundColor: colors.error, fontSize: typo.small.fontSize },
        }}
      />
      <Tabs.Screen
        name="settings/index"
        options={{
          title: '제어',
          tabBarIcon: ({ color, size }) => <Feather name="shield" size={size} color={color} />,
          tabBarLabel: ({ color }) => (
            <TabLabel label="제어" color={color} fontSize={typo.small.fontSize} />
          ),
        }}
      />
      <Tabs.Screen name="home/index" options={{ href: null }} />
    </Tabs>
  );
}
