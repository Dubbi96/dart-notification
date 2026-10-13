import React from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { fireEvent, render, within } from '@testing-library/react-native';
import Constants from 'expo-constants';
import { ThemeContext, getTheme } from '@theme';

import SettingsScreen from '../../app/(tabs)/settings';

const mockSetScale = jest.fn();
const mockSetScheme = jest.fn();
const mockShowDialog = jest.fn();
const mockLogout = jest.fn();
const mockAuth = { isAuthenticated: true };
const mockName = '글자 확대와 좁은 화면에서 이름이 잘리지 않는 사용자';
const mockEmail = 'long-account-name-for-layout-check@example.invalid';

jest.mock('@expo/vector-icons', () => ({ Feather: () => null }));
jest.mock('@hooks/useReducedMotion', () => ({ useReducedMotion: () => true }));
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
  useDialog: () => ({ showDialog: mockShowDialog }),
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
  useLogout: () => ({ mutate: mockLogout }),
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
    expect(StyleSheet.flatten(getByText('아주 크게 (1.5x)').props.style).fontSize).toBe(21);
    expect(StyleSheet.flatten(getByText('아주 크게 (1.5x)').props.style).flexShrink).toBe(1);
  });

  it('현재값 배치를 바꿔도 테마와 글자 크기 전환은 행 전체에서 유지한다', () => {
    const { getByRole } = renderSettings();
    fireEvent.press(getByRole('button', { name: '글자 크기, 현재 아주 크게 (1.5x)' }));
    expect(mockSetScale).toHaveBeenCalledWith(null);
    fireEvent.press(getByRole('button', { name: '화면 설정, 현재 시스템' }));
    expect(mockSetScheme).toHaveBeenCalledWith('light');
  });

  it('게스트 로그인 링크는 실제 높이 48dp를 확보한다', () => {
    mockAuth.isAuthenticated = false;
    const { getByRole } = renderSettings();
    expect(
      StyleSheet.flatten(getByRole('button', { name: '로그인하기' }).props.style).minHeight,
    ).toBeGreaterThanOrEqual(48);
  });

  it('반복 설명은 숨기고 현재값·계정 정보·비상 제어 목적을 남긴다', () => {
    const { getByText, getByRole, queryByText } = renderSettings();
    for (const text of [
      '계정 정보 관리',
      '관심 기업 관리',
      '알림 환경 설정',
      '북마크한 공시 모아보기',
      '테마 모드 전환',
      '본문 글자 배율',
      '이메일 문의 · 시스템 상태',
      '시세·공시 데이터의 출처와 지연 고지',
    ]) {
      expect(queryByText(text)).toBeNull();
    }
    for (const text of [
      mockName,
      mockEmail,
      '상태 확인 · 운영자 신규 진입 중단',
      '시스템',
      '아주 크게 (1.5x)',
    ]) {
      expect(getByText(text)).toBeTruthy();
    }
    expect(getByRole('button', { name: '보관함' }).props.accessibilityHint).toBe(
      '저장한 공시를 엽니다',
    );
    expect(getByRole('button', { name: '화면 설정, 현재 시스템' }).props.accessibilityHint).toBe(
      '탭하면 다음 옵션으로 전환',
    );
  });

  it('설정 도움말 하나만 별도로 열고 닫으며 메뉴 안에 버튼을 중첩하지 않는다', () => {
    const { getByRole, getAllByRole, getByText, queryByText } = renderSettings();
    const label = '화면·글자 설정 설명 보기';
    const body = '누를 때마다 시스템, 라이트, 다크 순서로 바뀝니다.';
    expect(getAllByRole('button', { name: label })).toHaveLength(1);
    expect(queryByText(body)).toBeNull();
    const themeRow = getByRole('button', { name: '화면 설정, 현재 시스템' });
    expect(within(themeRow).queryByRole('button', { name: label })).toBeNull();
    fireEvent.press(getByRole('button', { name: label }));
    expect(getByText(body)).toBeTruthy();
    expect(getByRole('button', { name: label }).props.accessibilityState.expanded).toBe(true);
    expect(mockSetScale).not.toHaveBeenCalled();
    expect(mockSetScheme).not.toHaveBeenCalled();
    expect(mockLogout).not.toHaveBeenCalled();
    fireEvent.press(getByRole('button', { name: '설명 닫기' }));
    expect(queryByText(body)).toBeNull();
  });

  it('로그아웃 확인 절차를 생략하지 않는다', () => {
    const { getByRole } = renderSettings();
    fireEvent.press(getByRole('button', { name: '로그아웃' }));
    expect(mockLogout).not.toHaveBeenCalled();
    const dialog = mockShowDialog.mock.calls[0][0];
    expect(dialog.message).toBe('로그아웃하시겠어요?');
    expect(dialog.buttons[0].style).toBe('cancel');
    expect(dialog.buttons[1].style).toBe('destructive');
    dialog.buttons[1].onPress();
    expect(mockLogout).toHaveBeenCalledTimes(1);
  });
});
