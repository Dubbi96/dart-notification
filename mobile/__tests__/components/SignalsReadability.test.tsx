import React from 'react';
import { Dimensions, StyleSheet } from 'react-native';
import { fireEvent, render } from '@testing-library/react-native';
import { ThemeContext, getTheme } from '@theme';
import { EditionDateStrip } from '@components/signals/EditionDateStrip';
import { EditionFallbackBriefing } from '@components/signals/EditionFallbackBriefing';
import { EditionOptInBanner } from '@components/signals/EditionOptInBanner';
import { DeviceRuleCheckSheet } from '@components/signals/DeviceRuleCheckSheet';
import { EDITION_OPT_IN_BANNER } from '@utils/editionOptInBanner';

import SignalsScreen from '../../app/(tabs)/signals/index';

const mockDismiss = jest.fn();
const mockMutate = jest.fn();
jest.mock('@expo/vector-icons', () => ({ Feather: () => null }));
jest.mock('@hooks/useReducedMotion', () => ({ useReducedMotion: () => true }));
jest.mock('@hooks/useHaptics', () => ({ useHaptics: () => ({ light: jest.fn() }) }));
jest.mock('@components/common/DialogProvider', () => ({
  useDialog: () => ({ showDialog: jest.fn() }),
}));
jest.mock('@hooks/useEditionOptInBanner', () => ({
  useEditionOptInBanner: () => ({ dismissed: false, dismiss: mockDismiss }),
}));
jest.mock('@hooks/useNotificationSettings', () => ({
  useNotificationSettings: () => ({ isSuccess: true, data: { editionPushEnabled: false } }),
  useUpdateNotificationSettings: () => ({ mutate: mockMutate, isPending: false }),
}));
jest.mock('@components/signals/BuyEditionView', () => ({ BuyEditionView: () => null }));
jest.mock('@utils/deviceRuleDecision', () => ({ runDeviceRuleSelfCheck: jest.fn() }));
jest.mock('@stores/authStore', () => ({
  useAuthStore: (selector: (state: { isAuthenticated: boolean }) => unknown) =>
    selector({ isAuthenticated: false }),
}));
jest.mock('expo-router', () => ({
  router: { push: jest.fn() },
  useLocalSearchParams: () => ({}),
  useScrollToTop: jest.fn(),
}));

const initialDimensions = Dimensions.get('window');
afterEach(() => {
  Dimensions.set({ window: initialDimensions, screen: initialDimensions });
});

describe.each(['light', 'dark'] as const)('%s 판단 화면 읽기 계약', (scheme) => {
  it('알림의 긴 설명은 도움말에서 읽고 켜기 동작은 별도로 실행한다', () => {
    const { getByText, queryByText, getByRole } = render(
      <ThemeContext.Provider value={getTheme(scheme, 1.5)}>
        <EditionOptInBanner />
      </ThemeContext.Provider>,
    );
    expect(getByText(EDITION_OPT_IN_BANNER.title)).toBeTruthy();
    expect(queryByText(EDITION_OPT_IN_BANNER.description)).toBeNull();
    fireEvent.press(getByRole('button', { name: '판단 알림 설명 보기' }));
    expect(getByText(EDITION_OPT_IN_BANNER.description)).toBeTruthy();
    expect(getByText('평일 저녁 7시 이후, 발행할 판단이 있는 날 알림을 보냅니다.')).toBeTruthy();
    expect(mockMutate).not.toHaveBeenCalled();
    expect(mockDismiss).not.toHaveBeenCalled();
    fireEvent.press(getByRole('button', { name: '설명 닫기' }));
    expect(queryByText(EDITION_OPT_IN_BANNER.description)).toBeNull();
    fireEvent.press(getByRole('button', { name: EDITION_OPT_IN_BANNER.enableLabel }));
    expect(mockMutate).toHaveBeenCalledWith({ editionPushEnabled: true }, expect.any(Object));
  });

  it.each([1, 1.5])('글자 배율 %s에서 날짜/공시/알림 제목을 말줄이지 않는다', (scale) => {
    const theme = getTheme(scheme, scale);
    const company = '검토용 매우 긴 이름의 국내 반도체 제조 기업';
    const summary =
      '계약 규모와 계약 기간을 함께 확인해야 하며, 해지 조건과 매출 대비 비중도 확인해야 합니다.';
    const { getByText, getByRole, getByTestId } = render(
      <ThemeContext.Provider value={theme}>
        <EditionDateStrip
          editions={[{ date: '20261013', count: 12, strongBuyCount: 0 }]}
          todayDate="20261015"
          selectedDate="20261013"
          onSelect={jest.fn()}
        />
        <EditionFallbackBriefing
          items={[
            {
              rcpNo: 'test',
              corpName: company,
              eventLabel: '장기 대규모 공급계약에 관한 정정 공시',
              summaryLine: summary,
              summarySource: 'TITLE',
            },
          ]}
        />
        <EditionOptInBanner />
      </ThemeContext.Provider>,
    );
    for (const text of [company, summary, '10.13', EDITION_OPT_IN_BANNER.title]) {
      expect(getByText(text).props.numberOfLines).toBeUndefined();
    }
    expect(StyleSheet.flatten(getByText(company).props.style).fontSize).toBe(
      theme.typography.bodyMedium.fontSize,
    );
    expect(StyleSheet.flatten(getByText(summary).props.style).fontSize).toBeGreaterThanOrEqual(16);
    const chip = getByRole('button', { name: /10월 13일.*선택됨/ });
    expect(StyleSheet.flatten(chip.props.style).width).toBeGreaterThanOrEqual(
      scale === 1 ? 72 : 95,
    );
    expect(StyleSheet.flatten(chip.props.style).minHeight).toBeGreaterThanOrEqual(48);
    expect(
      StyleSheet.flatten(getByTestId('edition-fallback-briefing').props.style).paddingHorizontal,
    ).toBeUndefined();
    const close = getByRole('button', { name: EDITION_OPT_IN_BANNER.dismissA11yLabel });
    expect(StyleSheet.flatten(close.props.style)).toMatchObject({ width: 48, minHeight: 48 });
    fireEvent.press(close);
    expect(mockDismiss).toHaveBeenCalledTimes(1);
  });

  it.each([
    [320, 1, 'row'],
    [320, 1.5, 'column'],
    [384, 1, 'row'],
    [384, 1.5, 'row'],
  ] as const)('%sdp/글자%s에서 화면·모달 제목과 버튼을 분리한다', (width, scale, direction) => {
    const dimensions = { width, height: 640, scale: 1, fontScale: 1 };
    Dimensions.set({ window: dimensions, screen: dimensions });
    const { getByTestId, getByText, getByRole } = render(
      <ThemeContext.Provider value={getTheme(scheme, scale)}>
        <SignalsScreen />
        <DeviceRuleCheckSheet visible onClose={jest.fn()} />
      </ThemeContext.Provider>,
    );
    for (const id of ['signals-screen-header-row', 'device-rule-check-header']) {
      expect(StyleSheet.flatten(getByTestId(id).props.style).flexDirection).toBe(direction);
    }
    expect(getByText('오늘의 판단').props.numberOfLines).toBeUndefined();
    expect(getByText('기기 판단 점검').props.numberOfLines).toBeUndefined();
    expect(
      StyleSheet.flatten(getByRole('button', { name: '닫기' }).props.style).minHeight,
    ).toBeGreaterThanOrEqual(48);
  });
});
