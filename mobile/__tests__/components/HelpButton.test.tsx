import React from 'react';
import { Modal, StyleSheet } from 'react-native';
import { fireEvent, render } from '@testing-library/react-native';
import { HelpButton } from '@components/common/HelpButton';
import { ThemeContext, getTheme } from '@theme';
import { useReducedMotion } from '@hooks/useReducedMotion';

jest.mock('@expo/vector-icons', () => ({ Feather: () => null }));
jest.mock('@hooks/useReducedMotion', () => ({ useReducedMotion: jest.fn(() => true) }));

const sections = [{ heading: '계산 시점', body: '받아 온 종가로 계산합니다.' }];

it.each(['light', 'dark'] as const)(
  '%s 모드에서 48dp 설명 버튼으로 전체 내용을 열고 닫는다',
  (mode) => {
    const { getByRole, getByText, queryByText } = render(
      <ThemeContext.Provider value={getTheme(mode, 1.5)}>
        <HelpButton title="계산 기준" sections={sections} footnote="실주문은 실행하지 않습니다." />
      </ThemeContext.Provider>,
    );
    const trigger = getByRole('button', { name: '계산 기준 설명 보기' });
    expect(StyleSheet.flatten(trigger.props.style)).toMatchObject({ width: 48, height: 48 });
    expect(trigger.props.accessibilityState.expanded).toBe(false);
    expect(queryByText(sections[0].body)).toBeNull();
    fireEvent(trigger, 'focus');
    expect(StyleSheet.flatten(trigger.props.style).borderColor).toBe(getTheme(mode).colors.text);
    fireEvent(trigger, 'blur');
    fireEvent.press(trigger);
    expect(getByText(sections[0].body).props.numberOfLines).toBeUndefined();
    expect(StyleSheet.flatten(getByText(sections[0].body).props.style).fontSize).toBe(21);
    expect(getByText('실주문은 실행하지 않습니다.')).toBeTruthy();
    fireEvent.press(getByRole('button', { name: '설명 닫기' }));
    expect(queryByText(sections[0].body)).toBeNull();
    expect(
      getByRole('button', { name: '계산 기준 설명 보기' }).props.accessibilityState.expanded,
    ).toBe(false);
  },
);

it.each([true, false])('Android 닫기 요청으로 닫히며 동작 줄이기=%s를 따른다', (reducedMotion) => {
  (useReducedMotion as jest.Mock).mockReturnValue(reducedMotion);
  const { getByRole, queryByText, UNSAFE_getByType } = render(
    <HelpButton title="계산 기준" sections={sections} />,
  );
  fireEvent.press(getByRole('button', { name: '계산 기준 설명 보기' }));
  const modal = UNSAFE_getByType(Modal);
  expect(modal.props.animationType).toBe(reducedMotion ? 'none' : 'slide');
  fireEvent(modal, 'requestClose');
  expect(queryByText(sections[0].body)).toBeNull();
});
