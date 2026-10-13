import React from 'react';
import { Animated, StyleSheet } from 'react-native';
import { fireEvent, render } from '@testing-library/react-native';
import { EditionDecisionCard } from '@components/signals/EditionDecisionCard';
import { EditionDecisionSummary } from '@components/signals/EditionDecisionSummary';
import { useReducedMotion } from '@hooks/useReducedMotion';
import { evaluateEditionOnDevice, evaluateShadowPosition } from '@utils/deviceRuleDecision';
import type { DeviceEditionDecision } from '@utils/deviceRuleDecision';
import type { TradingSignal } from '@app-types/signal.types';
import { ThemeContext, getTheme } from '@theme';
import { createHash as mockCreateHash } from 'crypto';

jest.mock('@hooks/useReducedMotion', () => ({ useReducedMotion: jest.fn(() => true) }));
jest.mock('@expo/vector-icons', () => ({ Feather: () => null }));
jest.mock('expo-crypto', () => ({
  CryptoDigestAlgorithm: { SHA256: 'SHA-256' },
  digestStringAsync: async (_algorithm: string, value: string) =>
    mockCreateHash('sha256').update(value).digest('hex'),
}));

const signal: TradingSignal = {
  id: 'signal-1',
  corpCode: '00126380',
  corpName: '삼성전자',
  ticker: '005930',
  eventType: 'SUPPLY_CONTRACT',
  grade: 'BUY',
  buyScore: 72,
  summary: '계약과 가격 조건을 함께 확인합니다.',
  entryConditions: [{ id: 'ma20', label: '이동평균선 위', required: true, met: true }],
  riskFlags: [],
  referencePrice: {
    tradeDate: '20261013',
    closePrice: 71_000,
    highPrice: 72_000,
    lowPrice: 70_000,
    source: 'STOCK_DAILY_PRICE',
  },
  createdAt: '2026-10-13T10:00:00.000Z',
};

let edition: DeviceEditionDecision;
beforeAll(async () => {
  edition = await evaluateEditionOnDevice([signal], '20261013');
});

describe('기기 판단 카드의 점진적 정보 공개', () => {
  it('기본 화면은 손절·중단 기준과 종가 한계를 보이고 내부 기록을 감춘다', () => {
    const { getByText, queryByTestId, queryByText, getByRole } = render(
      <EditionDecisionCard signal={signal} decision={edition.decisions[0]} rank={1} />,
    );
    expect(getByText(/손절 조건/)).toBeTruthy();
    expect(getByText(/중단 기준/)).toBeTruthy();
    expect(getByText(/실시간 시세 아님/)).toBeTruthy();
    expect(queryByText(/기기 계산 기록/)).toBeNull();
    expect(queryByTestId('decision-details')).toBeNull();
    const control = getByRole('button', { name: '판단 근거와 목표가 펼치기' });
    expect(control.props.accessibilityState.expanded).toBe(false);
    expect(StyleSheet.flatten(control.props.style).minHeight).toBeGreaterThanOrEqual(48);
  });

  it('펼침은 화면 이동 없이 근거·목표를 보이고 원문은 별도 버튼으로 연다', () => {
    const onPress = jest.fn();
    const { getByRole, getByText, queryByTestId } = render(
      <EditionDecisionCard
        signal={signal}
        decision={edition.decisions[0]}
        rank={1}
        onPress={onPress}
      />,
    );
    fireEvent.press(getByRole('button', { name: '판단 근거와 목표가 펼치기' }));
    expect(onPress).not.toHaveBeenCalled();
    expect(getByText(edition.decisions[0].rationale)).toBeTruthy();
    expect(getByText(/부분익절/)).toBeTruthy();
    expect(getByRole('button', { name: '판단 근거 접기' }).props.accessibilityState.expanded).toBe(
      true,
    );
    fireEvent.press(getByRole('button', { name: '공시 원문과 분석 상세 보기' }));
    expect(onPress).toHaveBeenCalledWith(signal);
    fireEvent.press(getByRole('button', { name: '판단 근거 접기' }));
    expect(queryByTestId('decision-details')).toBeNull();
    expect(getByText(/손절 조건/)).toBeTruthy();
  });

  it('반올림한 참고 가격과 실제 체결가 대비 손절 조건을 구분한다', () => {
    const plan = edition.decisions[0].pricePlan!;
    const { getByText, getByRole } = render(
      <EditionDecisionCard signal={signal} decision={edition.decisions[0]} rank={1} />,
    );
    expect(getByText('손절 조건: 체결가 대비 -5%')).toBeTruthy();
    expect(getByText('참고 약 67,500원')).toBeTruthy();
    expect(getByText('약 69,600 ~ 71,000원')).toBeTruthy();
    const position = {
      entryPrice: plan.entryHigh,
      currentPrice: plan.stopPrice,
      heldTradingDays: 2,
      partialExitTaken: false,
      quoteAt: '2026-10-13T10:00:00.000Z',
      evaluatedAt: '2026-10-13T10:00:01.000Z',
      maxQuoteAgeMs: 60_000,
      killSwitchState: 'CLEAR' as const,
      hardRiskBlocked: false,
    };
    expect(evaluateShadowPosition(position).action).toBe('HOLD');
    expect(evaluateShadowPosition({ ...position, currentPrice: 67_450 }).action).toBe('EXIT');
    fireEvent.press(getByRole('button', { name: '판단 근거와 목표가 펼치기' }));
    expect(getByText('참고 목표 약 78,100원')).toBeTruthy();
    expect(getByText(/주문 가능한 호가를 뜻하지 않습니다/)).toBeTruthy();
  });

  it('동작 줄이기 사용자는 펼칠 때 애니메이션을 실행하지 않는다', () => {
    const animation = jest.spyOn(Animated, 'timing');
    const { getByRole } = render(
      <EditionDecisionCard signal={signal} decision={edition.decisions[0]} rank={1} />,
    );
    fireEvent.press(getByRole('button', { name: '판단 근거와 목표가 펼치기' }));
    expect(animation).not.toHaveBeenCalled();
    animation.mockRestore();
  });

  it('사용자가 펼칠 때만 짧은 애니메이션으로 상태를 알린다', () => {
    (useReducedMotion as jest.Mock).mockReturnValueOnce(false).mockReturnValueOnce(false);
    const animation = jest.spyOn(Animated, 'timing');
    const { getByRole } = render(
      <EditionDecisionCard signal={signal} decision={edition.decisions[0]} rank={1} />,
    );
    expect(animation).not.toHaveBeenCalled();
    fireEvent.press(getByRole('button', { name: '판단 근거와 목표가 펼치기' }));
    expect(animation).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ duration: 160, useNativeDriver: true }),
    );
    animation.mockRestore();
  });

  it('차단 사유는 펼치지 않아도 읽을 수 있고 매수 가격을 만들지 않는다', async () => {
    const blocked = await evaluateEditionOnDevice(
      [{ ...signal, riskFlags: [{ id: 'halt', label: '거래정지 위험', severity: 'high' }] }],
      '20261013',
    );
    const { getByText, queryByText } = render(
      <EditionDecisionCard signal={signal} decision={blocked.decisions[0]} rank={1} />,
    );
    expect(getByText(/중단 기준.*거래정지 위험/)).toBeTruthy();
    expect(queryByText('모의 진입 구간')).toBeNull();
  });

  it('다크 모드·큰 글씨에서도 재단 없이 표시하며 종합 의견은 내부 식별자를 숨긴다', () => {
    const { getByText, queryByText } = render(
      <ThemeContext.Provider value={getTheme('dark', 1.5)}>
        <EditionDecisionSummary decision={edition} historical />
        <EditionDecisionCard signal={signal} decision={edition.decisions[0]} rank={1} historical />
      </ThemeContext.Provider>,
    );
    expect(getByText('당시의 종합 의견')).toBeTruthy();
    expect(getByText(/실시간 판단·실주문이 아닙니다/)).toBeTruthy();
    expect(getByText(edition.headline).props.numberOfLines).toBeUndefined();
    expect(queryByText(/Strategy|receipt/)).toBeNull();
  });
});
