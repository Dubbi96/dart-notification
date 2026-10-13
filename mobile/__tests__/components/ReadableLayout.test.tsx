import React from 'react';
import { StyleSheet, Text } from 'react-native';
import { fireEvent, render } from '@testing-library/react-native';
import { ScreenHeader } from '@components/common/ScreenHeader';
import { CollapsibleCard } from '@components/common/CollapsibleCard';
import { OfflineBanner } from '@components/common/OfflineBanner';
import { PriceChangeChip } from '@components/common/PriceChangeChip';
import { ThemeContext, getTheme } from '@theme';
import { useNetworkStatus } from '@hooks/useNetworkStatus';

jest.mock('@expo/vector-icons', () => ({ Feather: () => null }));
jest.mock('@hooks/useReducedMotion', () => ({ useReducedMotion: () => true }));
jest.mock('@hooks/useNetworkStatus', () => ({ useNetworkStatus: jest.fn() }));
jest.mock('@hooks/useHaptics', () => ({ useHaptics: () => ({ light: jest.fn() }) }));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 24, bottom: 24, left: 0, right: 0 }),
}));

const longTitle = '장기투자 자산과 시스템 트레이딩 자금의 운영 내역';
const longSummary = '실시간 시세가 아닌 마지막으로 받은 종가와 공시를 바탕으로 표시합니다.';

it('1.5배 공통 헤더 제목·설명은 줄 수를 제한하지 않고 기존 뒤로가기를 유지한다', () => {
  const onBack = jest.fn();
  const { getByText, getByRole } = render(
    <ThemeContext.Provider value={getTheme('light', 1.5)}>
      <ScreenHeader title={longTitle} subtitle={longSummary} onBack={onBack} />
    </ThemeContext.Provider>,
  );
  for (const value of [longTitle, longSummary]) {
    expect(getByText(value).props.numberOfLines).toBeUndefined();
    expect(getByText(value).props.adjustsFontSizeToFit).toBeUndefined();
  }
  expect(StyleSheet.flatten(getByText(longSummary).props.style).fontSize).toBe(21);
  fireEvent.press(getByRole('button', { name: '뒤로 가기' }));
  expect(onBack).toHaveBeenCalledTimes(1);
});

it('접힌 카드에서도 요약 전체를 읽고 48dp 버튼으로 내용을 펼칠 수 있다', () => {
  const { getByText, getByRole, queryByText } = render(
    <ThemeContext.Provider value={getTheme('dark', 1.5)}>
      <CollapsibleCard icon="info" title={longTitle} summary={longSummary}>
        <Text>상세 근거</Text>
      </CollapsibleCard>
    </ThemeContext.Provider>,
  );
  expect(getByText(longTitle).props.numberOfLines).toBeUndefined();
  expect(getByText(longSummary).props.numberOfLines).toBeUndefined();
  expect(queryByText('상세 근거')).toBeNull();
  const control = getByRole('button');
  expect(StyleSheet.flatten(control.props.style).minHeight).toBeGreaterThanOrEqual(48);
  fireEvent.press(control);
  expect(getByText('상세 근거')).toBeTruthy();
});

it('오프라인 설명은 화면 위를 덮지 않고 별도 행에서 줄바꿈한다', () => {
  (useNetworkStatus as jest.Mock).mockReturnValue({ isOffline: true });
  const { getByRole, getByText, rerender, queryByRole } = render(<OfflineBanner />);
  expect(StyleSheet.flatten(getByRole('alert').props.style).position).not.toBe('absolute');
  expect(getByText(/오프라인 — 인터넷/).props.numberOfLines).toBeUndefined();
  (useNetworkStatus as jest.Mock).mockReturnValue({ isOffline: false });
  rerender(<OfflineBanner />);
  expect(queryByRole('alert')).toBeNull();
});

it('상세 진입 카드 안의 정적 손익 칩은 중첩 버튼이 아니며 큰 글자 토큰을 쓴다', () => {
  const { queryByRole, getByText } = render(
    <ThemeContext.Provider value={getTheme('dark', 1.5)}>
      <PriceChangeChip value={-12.34} context="pnl" disableInfo />
    </ThemeContext.Provider>,
  );
  expect(queryByRole('button')).toBeNull();
  expect(StyleSheet.flatten(getByText('-12.34%').props.style).fontSize).toBe(21);
});
