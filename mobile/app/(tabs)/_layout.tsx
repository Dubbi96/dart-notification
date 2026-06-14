import React from 'react';
import { Tabs } from 'expo-router';
import { Ionicons, Feather } from '@expo/vector-icons';
import { useTheme } from '@theme';
import { useAuthStore } from '@stores/authStore';
import { useUnreadCount } from '@hooks/useNotifications';
import { usePositions } from '@hooks/usePortfolio';
import { formatUnreadBadge } from '@utils/unreadBadge';

// 5탭 IA: 홈 / 알림 / 신호 / 포트폴리오 / 설정.
// 신호·포트폴리오는 신규(M6/M7). 신규 탭은 Feather 아이콘(zap/briefcase).
// DAR-106: notifications 탭은 통합 인박스(공시/신호/청산/논리훼손)라 라벨 '알림'으로 정정.
// 공시 목록(disclosures)은 홈의 명확한 진입점으로 발견성 승격(중복 탭 없이).

export default function TabLayout() {
  const { colors } = useTheme();
  // DAR-216: 탭 배지도 React Query 단일원천에서 직접 구독(Zustand 복제 제거).
  // 비로그인은 /notifications 401이므로 enabled로 차단 → 배지 미표시.
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const { data: unreadCount = 0 } = useUnreadCount({ enabled: isAuthenticated });
  const unreadBadge = formatUnreadBadge(unreadCount);

  // 포트폴리오 배지: VIOLATED 포지션 수. 데이터/엔드포인트 미존재 시 0 → 배지 미표시.
  const { data: positions } = usePositions();
  const violatedCount = (positions ?? []).filter((p) => p.thesisStatus === 'VIOLATED').length;

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.tabActive,
        tabBarInactiveTintColor: colors.tabInactive,
        tabBarStyle: {
          backgroundColor: colors.tabBar,
          borderTopColor: colors.tabBarBorder,
          borderTopWidth: 1,
          paddingBottom: 8,
          paddingTop: 8,
          height: 88,
        },
        tabBarLabelStyle: {
          fontSize: 12,
          fontWeight: '500',
        },
      }}
    >
      <Tabs.Screen
        name="home/index"
        options={{
          title: '홈',
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="home-outline" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="notifications/index"
        options={{
          title: '알림',
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="notifications-outline" size={size} color={color} />
          ),
          tabBarBadge: unreadBadge,
          tabBarBadgeStyle: {
            backgroundColor: colors.error,
            fontSize: 11,
            fontWeight: '700',
          },
        }}
      />
      <Tabs.Screen
        name="signals/index"
        options={{
          title: '신호',
          tabBarIcon: ({ color, size }) => <Feather name="zap" size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="portfolio/index"
        options={{
          title: '포트폴리오',
          tabBarIcon: ({ color, size }) => <Feather name="briefcase" size={size} color={color} />,
          tabBarBadge: violatedCount > 0 ? violatedCount : undefined,
          tabBarBadgeStyle: {
            backgroundColor: colors.error,
            fontSize: 11,
            fontWeight: '700',
          },
        }}
      />
      <Tabs.Screen
        name="settings/index"
        options={{
          title: '설정',
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="settings-outline" size={size} color={color} />
          ),
        }}
      />
    </Tabs>
  );
}
