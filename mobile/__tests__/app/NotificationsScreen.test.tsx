import React from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { fireEvent, render } from '@testing-library/react-native';
import { ThemeContext, getTheme } from '@theme';

import type { Notification } from '@app-types/notification.types';

import NotificationsScreen from '../../app/(tabs)/notifications';

const mockMarkAsRead = jest.fn();
const mockMarkAllAsRead = jest.fn();
const mockPush = jest.fn();
const mockTitle = '긴 회사명과 함께 표시되는 주가 급변동 및 위험 조건 확인 알림';
const mockBody =
  '공시 원문과 가격 기준 시각을 확인하기 전에는 진입을 보류합니다. 큰 글자에서도 이 문장의 마지막 위험 안내가 생략되지 않아야 합니다.';
const mockItem: Notification = {
  id: 'layout-notification',
  userId: 'synthetic-user',
  type: 'PRICE_MOVE',
  refId: '005930-20261013',
  title: mockTitle,
  body: mockBody,
  deepLink: '/signals',
  disclosureRcpNo: null,
  sentAt: '2026-10-13T01:00:00.000Z',
  isRead: false,
  readAt: null,
  disclosure: null,
};

jest.mock('@expo/vector-icons', () => ({ Feather: () => null }));
jest.mock('expo-router', () => ({
  useScrollToTop: jest.fn(),
  router: { push: (...args: unknown[]) => mockPush(...args) },
}));
jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: jest.requireActual('react-native').View,
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));
jest.mock('@stores/authStore', () => ({
  useAuthStore: (selector: (state: { isAuthenticated: boolean }) => unknown) =>
    selector({ isAuthenticated: true }),
}));
jest.mock('@components/common/SnackbarProvider', () => ({
  useSnackbar: () => ({ showSnackbar: jest.fn() }),
}));
jest.mock('@hooks/useNotifications', () => ({
  useNotifications: () => ({
    data: {
      pages: [
        { data: [mockItem], meta: { unreadCount: 1234, unreadByCategory: { signal: 1234 } } },
      ],
    },
    isLoading: false,
    isError: false,
    isRefetching: false,
    refetch: jest.fn(),
  }),
  useMarkAsRead: () => ({ mutate: mockMarkAsRead }),
  useMarkAllAsRead: () => ({ mutate: mockMarkAllAsRead }),
}));
jest.mock('@utils/datetime', () => ({ relativeTime: () => '방금 전' }));

function renderNotifications() {
  return render(
    <ThemeContext.Provider value={getTheme('dark', 1.5)}>
      <View style={styles.viewport}>
        <NotificationsScreen />
      </View>
    </ThemeContext.Provider>,
  );
}

const styles = StyleSheet.create({ viewport: { width: 320 } });

describe('알림 화면의 큰 글자 레이아웃 계약', () => {
  beforeEach(() => jest.clearAllMocks());

  it('긴 제목·위험 설명을 줄 수로 잘라내지 않고 본문 16px·보조 14px 위계를 유지한다', () => {
    const { getByText } = renderNotifications();
    expect(getByText(mockTitle).props.numberOfLines).toBeUndefined();
    expect(getByText(mockBody).props.numberOfLines).toBeUndefined();
    expect(StyleSheet.flatten(getByText(mockTitle).props.style).fontSize).toBe(24);
    expect(StyleSheet.flatten(getByText(mockBody).props.style).fontSize).toBe(21);
    expect(StyleSheet.flatten(getByText('방금 전').props.style).fontSize).toBe(21);
  });

  it('헤더·필터·뉴스 동선은 48dp이고 가로 필터가 남는 화면 높이를 차지하지 않는다', () => {
    const { getByRole, UNSAFE_getAllByType } = renderNotifications();
    for (const name of ['알림 설정 열기', '모든 알림 읽음으로 표시', '전체, 안 읽음 1234개']) {
      expect(
        StyleSheet.flatten(getByRole('button', { name }).props.style).minHeight,
      ).toBeGreaterThanOrEqual(48);
    }
    expect(StyleSheet.flatten(getByRole('link').props.style).minHeight).toBeGreaterThanOrEqual(48);
    const filter = UNSAFE_getAllByType(ScrollView).find((view) => view.props.horizontal);
    expect(StyleSheet.flatten(filter!.props.style)).toMatchObject({ flexGrow: 0, flexShrink: 0 });
  });

  it('알림 읽음·설정 이동 동작은 유지한다', () => {
    const { getByRole } = renderNotifications();
    fireEvent.press(getByRole('button', { name: /급변동, 안 읽음, 긴 회사명/ }));
    expect(mockMarkAsRead).toHaveBeenCalledWith('layout-notification');
    expect(mockPush).toHaveBeenCalledWith('/signals');
    fireEvent.press(getByRole('button', { name: '모든 알림 읽음으로 표시' }));
    expect(mockMarkAllAsRead).toHaveBeenCalledTimes(1);
    fireEvent.press(getByRole('button', { name: '알림 설정 열기' }));
    expect(mockPush).toHaveBeenCalledWith('/settings-detail/notification-settings');
  });
});
