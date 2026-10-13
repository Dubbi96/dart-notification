import React from 'react';
import { Modal, StyleSheet } from 'react-native';
import { act, fireEvent, render } from '@testing-library/react-native';
import { DeviceRuleCheckSheet } from '@components/signals/DeviceRuleCheckSheet';
import { useReducedMotion } from '@hooks/useReducedMotion';
import { runDeviceRuleSelfCheck } from '@utils/deviceRuleDecision';
import type { DeviceRuleSelfCheckResult } from '@utils/deviceRuleDecision';

jest.mock('@expo/vector-icons', () => ({ Feather: () => null }));
jest.mock('@hooks/useReducedMotion', () => ({ useReducedMotion: jest.fn(() => true) }));
jest.mock('@utils/deviceRuleDecision', () => ({ runDeviceRuleSelfCheck: jest.fn() }));

const mockRun = runDeviceRuleSelfCheck as jest.MockedFunction<typeof runDeviceRuleSelfCheck>;
const result: DeviceRuleSelfCheckResult = {
  passed: 1,
  total: 2,
  scope: 'SYNTHETIC_SAFETY',
  executionAllowed: false,
  cases: [
    {
      id: 'missing',
      label: '가격 누락',
      explanation: '누락 시 차단',
      expected: 'BLOCKED',
      actual: 'BLOCKED',
      passed: true,
    },
    {
      id: 'kill',
      label: '통제 상태 미확인',
      explanation: '미확인 시 차단',
      expected: 'BLOCKED',
      actual: 'READY',
      passed: false,
    },
  ],
};

beforeEach(() => {
  mockRun.mockReset();
  (useReducedMotion as jest.Mock).mockReturnValue(true);
});

describe('DeviceRuleCheckSheet', () => {
  it('합성·모의 상태는 남기고 상세 점검 범위는 도움말에서 설명한다', () => {
    const { getByText, getByRole, queryByText, UNSAFE_getByType } = render(
      <DeviceRuleCheckSheet visible onClose={jest.fn()} />,
    );
    expect(mockRun).not.toHaveBeenCalled();
    expect(getByText('합성 사례로 안전 규칙 점검')).toBeTruthy();
    expect(getByText('종가 기반 모의 점검 · 실주문 아님')).toBeTruthy();
    expect(queryByText(/합성 사례를 이 휴대전화의 Rule Engine으로 계산/)).toBeNull();
    expect(queryByText(/사례 통과/)).toBeNull();
    expect(UNSAFE_getByType(Modal).props.animationType).toBe('none');
    const help = getByRole('button', { name: '기기 점검 설명 보기' });
    expect(StyleSheet.flatten(help.props.style)).toMatchObject({ width: 48, height: 48 });
    expect(help.props.accessibilityState.expanded).toBe(false);
    fireEvent.press(getByRole('button', { name: '기기 점검 설명 보기' }));
    expect(getByText(/합성 사례를 이 휴대전화의 Rule Engine으로 계산/)).toBeTruthy();
    expect(
      getByText(/상시 감시, 실시간 가격 판단, 자동 실주문은 연결되지 않았습니다/),
    ).toBeTruthy();
    expect(UNSAFE_getByType(Modal).props.visible).toBe(true);
    expect(
      getByRole('button', { name: '기기 점검 설명 접기' }).props.accessibilityState.expanded,
    ).toBe(true);
    fireEvent.press(getByRole('button', { name: '기기 점검 설명 접기' }));
    expect(queryByText(/합성 사례를 이 휴대전화의 Rule Engine으로 계산/)).toBeNull();
    expect(mockRun).not.toHaveBeenCalled();
  });

  it('반복 탭은 하나만 실행하고 계산 중에도 닫을 수 있다', async () => {
    let complete!: (value: DeviceRuleSelfCheckResult) => void;
    mockRun.mockReturnValueOnce(
      new Promise((resolve) => {
        complete = resolve;
      }),
    );
    const onClose = jest.fn();
    const { getByRole, queryByText, rerender } = render(
      <DeviceRuleCheckSheet visible onClose={onClose} />,
    );
    const start = getByRole('button', { name: '이 기기에서 점검하기' });
    act(() => {
      fireEvent.press(start);
      fireEvent.press(start);
    });
    expect(mockRun).toHaveBeenCalledTimes(1);
    expect(getByRole('button', { name: '기기에서 계산 중' }).props.accessibilityState).toEqual({
      disabled: true,
      busy: true,
    });
    expect(queryByText(/사례 통과/)).toBeNull();
    fireEvent.press(getByRole('button', { name: '닫기' }));
    expect(onClose).toHaveBeenCalledTimes(1);
    rerender(<DeviceRuleCheckSheet visible={false} onClose={onClose} />);
    await act(async () => {
      complete(result);
    });
    expect(mockRun).toHaveBeenCalledTimes(1);
    expect(queryByText('1 / 2 사례 통과')).toBeNull();
  });

  it('성공·실패 사례를 구분하고 점검 통과를 수익성·현재 데이터 인증으로 표시하지 않는다', async () => {
    mockRun.mockResolvedValueOnce(result);
    const { getByRole, findByText, getByText, queryByText } = render(
      <DeviceRuleCheckSheet visible onClose={jest.fn()} />,
    );
    fireEvent.press(getByRole('button', { name: '이 기기에서 점검하기' }));
    expect(await findByText('1 / 2 사례 통과')).toBeTruthy();
    expect(queryByText('예상대로 동작')).toBeNull();
    expect(queryByText('누락 시 차단')).toBeNull();
    expect(getByText('점검 실패 · 실거래 연결 금지')).toBeTruthy();
    expect(getByText('미확인 시 차단')).toBeTruthy();
    expect(getByText('수익성·실데이터 검증 아님 · 실거래 승인 아님')).toBeTruthy();
    fireEvent.press(getByRole('button', { name: '사례별 상세 보기' }));
    expect(getByText('예상대로 동작')).toBeTruthy();
    expect(getByText('누락 시 차단')).toBeTruthy();
    fireEvent.press(getByRole('button', { name: '사례별 상세 접기' }));
    expect(queryByText('누락 시 차단')).toBeNull();
    expect(getByText('미확인 시 차단')).toBeTruthy();
    expect(queryByText(/수익성 검증, 백테스트/)).toBeNull();
    fireEvent.press(getByRole('button', { name: '기기 점검 설명 보기' }));
    expect(
      getByText(
        /수익성 검증, 백테스트, 실거래 승인 또는 현재 데이터의 정상 여부를 뜻하지 않습니다/,
      ),
    ).toBeTruthy();
    fireEvent.press(getByRole('button', { name: '기기 점검 설명 접기' }));
    expect(getByRole('button', { name: '다시 점검하기' }).props.accessibilityState.busy).toBe(
      false,
    );
  });

  it('실행 오류를 통과로 간주하지 않고 재시도를 허용한다', async () => {
    mockRun.mockRejectedValueOnce(new Error('device calculation failed'));
    const { getByRole, findByRole, findByText, queryByRole, queryByText } = render(
      <DeviceRuleCheckSheet visible onClose={jest.fn()} />,
    );
    fireEvent.press(getByRole('button', { name: '이 기기에서 점검하기' }));
    expect(await findByRole('alert')).toHaveTextContent(/통과로 간주하지 않습니다\./);
    expect(queryByText(/사례 통과/)).toBeNull();
    mockRun.mockResolvedValueOnce(result);
    fireEvent.press(getByRole('button', { name: '이 기기에서 점검하기' }));
    await findByText('1 / 2 사례 통과');
    expect(queryByRole('alert')).toBeNull();
    expect(mockRun).toHaveBeenCalledTimes(2);
  });

  it('Android 뒤로가기도 닫기에 연결하고 허용된 경우에만 전환 모션을 사용한다', () => {
    (useReducedMotion as jest.Mock).mockReturnValue(false);
    const onClose = jest.fn();
    const { UNSAFE_getByType } = render(<DeviceRuleCheckSheet visible onClose={onClose} />);
    const modal = UNSAFE_getByType(Modal);
    expect(modal.props.animationType).toBe('slide');
    fireEvent(modal, 'requestClose');
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(mockRun).not.toHaveBeenCalled();
  });
});
