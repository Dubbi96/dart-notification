import React from 'react';
import { render } from '@testing-library/react-native';
import { ThemeContext, getTheme } from '@theme';

import TabLayout from '../../app/(tabs)/_layout';

const mockScreen = jest.fn<null, [unknown]>(() => null);
const mockTabs = jest.fn(({ children }: { children: React.ReactNode }) => <>{children}</>);
let mockUnreadCount = 125;
jest.mock('expo-router', () => ({
  Tabs: Object.assign((props: { children: React.ReactNode }) => mockTabs(props), {
    Screen: (props: unknown) => mockScreen(props),
  }),
}));
jest.mock('@expo/vector-icons', () => ({ Feather: () => null }));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 24, bottom: 24, left: 0, right: 0 }),
}));
jest.mock('@components/common/ErrorFallback', () => ({ ErrorFallback: () => null }));
jest.mock('@hooks/useNotifications', () => ({
  useUnreadCount: () => ({ data: mockUnreadCount }),
}));
jest.mock('@hooks/usePortfolio', () => ({
  usePositions: () => ({ data: [{ thesisStatus: 'VIOLATED' }] }),
}));
jest.mock('@stores/authStore', () => ({
  useAuthStore: (selector: (state: { isAuthenticated: boolean }) => unknown) =>
    selector({ isAuthenticated: true }),
}));
jest.mock('@utils/tradingVisibility', () => ({ SHOW_TRADING: true }));

beforeEach(() => {
  mockUnreadCount = 125;
});

describe.each(['light', 'dark'] as const)('%s 하단 탭 배지', (scheme) => {
  it.each([1, 1.25, 1.5])('%s배 글자와 배지 폭·높이가 함께 확장된다', (scale) => {
    const theme = getTheme(scheme, scale);
    render(
      <ThemeContext.Provider value={theme}>
        <TabLayout />
      </ThemeContext.Provider>,
    );
    const screens = mockScreen.mock.calls.map(([props]) => props) as {
      name: string;
      options: { tabBarBadge?: string | number; tabBarBadgeStyle?: Record<string, unknown> };
    }[];
    const unread = screens.find((screen) => screen.name === 'notifications/index')!.options;
    const position = screens.find((screen) => screen.name === 'portfolio/index')!.options;
    expect(unread.tabBarBadge).toBe('99+');
    expect(position.tabBarBadge).toBe(1);
    const fontSize = theme.typography.small.fontSize;
    for (const options of [unread, position]) {
      const style = options.tabBarBadgeStyle!;
      expect(style.fontSize).toBe(fontSize);
      expect(style.height).toBe(Math.max(20, theme.typography.small.lineHeight));
      expect(style.lineHeight).toBe(style.height);
      expect(style.borderRadius).toBe(Number(style.height) / 2);
      expect(style.fontVariant).toEqual(['tabular-nums']);
      expect(style.end).toBe(-3 - (Number(style.width) - 20) / 2);
      expect(style.top).toBe(-Number(style.height) / 2);
      expect(style.transform).toBeUndefined();
      // 31dp 아이콘 영역 중앙에서 배지 오른쪽 끝까지. 320dp/4탭 경계를 넘지 않는다.
      expect(31 / 2 - Number(style.end)).toBeLessThanOrEqual(320 / 4 / 2);
      expect(Number(style.width)).toBeGreaterThanOrEqual(
        Math.ceil(String(options.tabBarBadge).length * fontSize * 0.75) + 8,
      );
    }
    expect(Number(unread.tabBarBadgeStyle!.width)).toBeGreaterThan(31);
    expect(mockTabs.mock.calls[0][0]).toEqual(
      expect.objectContaining({
        screenOptions: expect.objectContaining({ tabBarAllowFontScaling: false }),
      }),
    );
  });

  it('읽지 않은 알림이 없으면 배지를 표시하지 않는다', () => {
    mockUnreadCount = 0;
    render(
      <ThemeContext.Provider value={getTheme(scheme, 1.5)}>
        <TabLayout />
      </ThemeContext.Provider>,
    );
    const options = mockScreen.mock.calls
      .map(([props]) => props as { name: string; options: { tabBarBadge?: string } })
      .find((screen) => screen.name === 'notifications/index')!.options;
    expect(options.tabBarBadge).toBeUndefined();
  });
});
