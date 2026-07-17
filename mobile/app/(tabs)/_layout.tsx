import React from 'react';
import { Text, type ColorValue } from 'react-native';
import { Tabs } from 'expo-router';
import { Ionicons, Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme, MAX_CHIP_FONT_SCALE } from '@theme';
import { spacing } from '@theme/spacing';
import { useAuthStore } from '@stores/authStore';
import { useUnreadCount } from '@hooks/useNotifications';
import { usePositions } from '@hooks/usePortfolio';
import { formatUnreadBadge } from '@utils/unreadBadge';

// DAR-224: 탭 셸 ErrorBoundary. 탭 내부 화면의 렌더 에러가 셸/하단탭까지
// 무너뜨리지 않도록 (tabs) 서브트리에서 한 번 더 격리한다(루트 폴백 UI 재사용).
export { ErrorFallback as ErrorBoundary } from '@components/common/ErrorFallback';

// 5탭 IA: 홈 / 알림 / 신호 / 포트폴리오 / 설정.
// 신호·포트폴리오는 신규(M6/M7). 신규 탭은 Feather 아이콘(zap/briefcase).
// DAR-106: notifications 탭은 통합 인박스(공시/신호/청산/논리훼손)라 라벨 '알림'으로 정정.
// 공시 목록(disclosures)은 홈의 명확한 진입점으로 발견성 승격(중복 탭 없이).

// UXR L-1 A-10: 고정 height 88(매직넘버) 분해 — 아이콘·라벨·상하 패딩을 담는 콘텐츠 기준
// 높이에 기기 실제 하단 인셋(useSafeAreaInsets)을 더해 파생한다. 54 = 기존 88에서 iOS 홈
// 인디케이터 인셋(34)을 분리한 값으로, 인셋 큰 기기의 라벨-인디케이터 근접과 인셋 없는
// Android의 과대 높이를 함께 해소한다(인셋 있는 iOS 시각 높이 88은 보존).
const TAB_BAR_CONTENT_HEIGHT = 54;

// DAR-554: 5탭 균등폭에서 '포트폴리오'(5자)가 OS 큰 글꼴(1.3x)에서 실측 잘림('포트폴...')
// 재현됨(에뮬 실측). R-4 헤드라인 패턴(adjustsFontSizeToFit)을 탭 라벨에도 적용해 말줄임 대신
// 배율 축소로 온전히 표시 — flexShrink 이웃이 없는 고정폭 탭이라 R-1 3종세트 대신 폰트 축소로 해결.
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
      style={{ color, fontSize, fontWeight: '500' }}
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
  // 하단 패딩: 홈 인디케이터 인셋과 기본 패딩 중 큰 값 — 라벨이 인디케이터를 침범하지 않는다.
  const tabBarBottomPadding = Math.max(insets.bottom, spacing.sm);
  // DAR-216: 탭 배지도 React Query 단일원천에서 직접 구독(Zustand 복제 제거).
  // 비로그인은 /notifications 401이므로 enabled로 차단 → 배지 미표시.
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const { data: unreadCount = 0 } = useUnreadCount({ enabled: isAuthenticated });
  const unreadBadge = formatUnreadBadge(unreadCount);

  // 포트폴리오 배지: VIOLATED 포지션 수. 데이터/엔드포인트 미존재 시 0 → 배지 미표시.
  // UXR L-1 A-9: 비로그인은 /positions 401 — 위 useUnreadCount(DAR-216)와 동일하게 enabled 로 차단.
  const { data: positions } = usePositions({ enabled: isAuthenticated });
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
          // UXR L-1 A-10: 8/12 매직넘버 → spacing.sm·typo.small 토큰, 높이는 인셋 파생(상단 주석).
          paddingBottom: tabBarBottomPadding,
          paddingTop: spacing.sm,
          height: TAB_BAR_CONTENT_HEIGHT + tabBarBottomPadding,
        },
        tabBarLabelStyle: {
          fontSize: typo.small.fontSize,
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
          tabBarLabel: ({ color }) => (
            <TabLabel label="홈" color={color} fontSize={typo.small.fontSize} />
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
          tabBarLabel: ({ color }) => (
            <TabLabel label="알림" color={color} fontSize={typo.small.fontSize} />
          ),
          tabBarBadge: unreadBadge,
          tabBarBadgeStyle: {
            backgroundColor: colors.error,
            // UXR L-1 A-10: 토큰 밖 11 → typo.small(최소 가독 크기 토큰) 통일.
            fontSize: typo.small.fontSize,
            fontWeight: '700',
          },
        }}
      />
      <Tabs.Screen
        name="signals/index"
        options={{
          title: '신호',
          tabBarIcon: ({ color, size }) => <Feather name="zap" size={size} color={color} />,
          tabBarLabel: ({ color }) => (
            <TabLabel label="신호" color={color} fontSize={typo.small.fontSize} />
          ),
        }}
      />
      <Tabs.Screen
        name="portfolio/index"
        options={{
          title: '포트폴리오',
          tabBarIcon: ({ color, size }) => <Feather name="briefcase" size={size} color={color} />,
          tabBarLabel: ({ color }) => (
            <TabLabel label="포트폴리오" color={color} fontSize={typo.small.fontSize} />
          ),
          tabBarBadge: violatedCount > 0 ? violatedCount : undefined,
          tabBarBadgeStyle: {
            backgroundColor: colors.error,
            // UXR L-1 A-10: 토큰 밖 11 → typo.small(최소 가독 크기 토큰) 통일.
            fontSize: typo.small.fontSize,
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
          tabBarLabel: ({ color }) => (
            <TabLabel label="설정" color={color} fontSize={typo.small.fontSize} />
          ),
        }}
      />
    </Tabs>
  );
}
