import React from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { fireEvent, render } from '@testing-library/react-native';
import Constants from 'expo-constants';
import { ThemeContext, getTheme } from '@theme';

import SettingsScreen from '../../app/(tabs)/settings';

const mockSetScale = jest.fn();
const mockSetScheme = jest.fn();
const mockAuth = { isAuthenticated: true };
const mockName = '글자 확대와 좁은 화면에서 이름이 잘리지 않는 사용자';
const mockEmail = 'long-account-name-for-layout-check@example.invalid';

jest.mock('@expo/vector-icons', () => ({ Feather: () => null }));
jest.mock('expo-constants', () => ({
  __esModule: true,
  default: { expoConfig: { name: 'Synthetic', slug: 'synthetic', version: '9.8.7-test' } },
}));
jest.mock('expo-router', () => ({ useFocusEffect: jest.fn(), router: { push: jest.fn() } }));
jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: jest.requireActual('react-native').View,
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));
jest.mock('@components/common/DevConnectionStatus', () => ({ DevConnectionStatus: () => null }));
jest.mock('@components/common/DialogProvider', () => ({
  useDialog: () => ({ showDialog: jest.fn() }),
}));
jest.mock('@stores/authStore', () => ({ useAuthStore: () => mockAuth }));
jest.mock('@stores/settingsStore', () => ({
  useSettingsStore: () => ({
    colorSchemeOverride: 'system',
    textScaleOverride: 1.5,
    setColorScheme: mockSetScheme,
    setTextScaleOverride: mockSetScale,
  }),
}));
jest.mock('@hooks/useAuth', () => ({
  useLogout: () => ({ mutate: jest.fn() }),
  useMe: () => ({ data: { name: mockName, email: mockEmail }, refetch: jest.fn() }),
}));
jest.mock('@hooks/useWatchlist', () => ({
  useWatchlist: () => ({ data: { meta: { total: 25 } } }),
}));

function renderSettings() {
  return render(
    <ThemeContext.Provider value={getTheme('light', 1.5)}>
      <View style={styles.viewport}>
        <SettingsScreen />
      </View>
    </ThemeContext.Provider>,
  );
}

const styles = StyleSheet.create({ viewport: { width: 320 } });

describe('설정 화면의 큰 글자 레이아웃 계약', () => {
  beforeEach(() => {
    mockAuth.isAuthenticated = true;
    Constants.expoConfig!.version = '9.8.7-test';
    jest.clearAllMocks();
  });

  it.each([
    ['9.8.7-test', 'Version 9.8.7-test'],
    [undefined, 'Version 확인 불가'],
  ])('앱 정보는 실제 Expo 버전 %s를 표시하며 없으면 숫자를 추정하지 않는다', (version, label) => {
    Constants.expoConfig!.version = version;
    const { getByText, queryByText } = renderSettings();
    expect(getByText(label!)).toBeTruthy();
    expect(queryByText('Version 1.0.0')).toBeNull();
  });

  it('프로필과 설정을 하나의 스크롤에 넣고 긴 이름·이메일·현재값을 자르지 않는다', () => {
    const { getByText, UNSAFE_getAllByType } = renderSettings();
    expect(UNSAFE_getAllByType(ScrollView)).toHaveLength(1);
    for (const text of [mockName, mockEmail, '아주 크게 (1.5x)', '개인정보 처리방침']) {
      expect(getByText(text).props.numberOfLines).toBeUndefined();
    }
    expect(StyleSheet.flatten(getByText('본문 글자 배율').props.style).fontSize).toBe(21);
    expect(StyleSheet.flatten(getByText('아주 크게 (1.5x)').props.style).flexShrink).toBe(1);
  });

  it('현재값 배치를 바꿔도 테마와 글자 크기 전환은 행 전체에서 유지한다', () => {
    const { getByRole } = renderSettings();
    fireEvent.press(
      getByRole('button', { name: '글자 크기, 본문 글자 배율, 현재 아주 크게 (1.5x)' }),
    );
    expect(mockSetScale).toHaveBeenCalledWith(null);
    fireEvent.press(getByRole('button', { name: '화면 설정, 테마 모드 전환, 현재 시스템' }));
    expect(mockSetScheme).toHaveBeenCalledWith('light');
  });

  it('게스트 로그인 링크는 실제 높이 48dp를 확보한다', () => {
    mockAuth.isAuthenticated = false;
    const { getByRole } = renderSettings();
    expect(
      StyleSheet.flatten(getByRole('button', { name: '로그인하기' }).props.style).minHeight,
    ).toBeGreaterThanOrEqual(48);
  });
});
