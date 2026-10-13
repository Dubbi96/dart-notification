import React from 'react';
import { StyleSheet, View } from 'react-native';
import { fireEvent, render } from '@testing-library/react-native';
import { ThemeContext, getTheme } from '@theme';
import { PositionCard } from '@components/portfolio/PositionCard';
import { PortfolioRiskBadge } from '@components/portfolio/PortfolioRiskBadge';
import { AllocationSummaryCard } from '@components/portfolio/AllocationSummaryCard';

import type { Position, PortfolioRiskSnapshot } from '@app-types/portfolio.types';
import type { AosAllocationSummary } from '@app-types/allocation.types';

import PortfolioScreen from '../../app/(tabs)/portfolio';

jest.mock('@expo/vector-icons', () => ({ Feather: () => null }));
jest.mock('expo-router', () => ({ router: { push: jest.fn() }, useScrollToTop: jest.fn() }));
jest.mock('@components/common/withTradingGuard', () => ({
  withTradingGuard: (component: unknown) => component,
}));
jest.mock('@stores/authStore', () => ({
  useAuthStore: (selector: (state: { isAuthenticated: boolean }) => unknown) =>
    selector({ isAuthenticated: true }),
}));
jest.mock('@hooks/useAosAllocation', () => ({
  useAosAllocation: () => ({ data: null, isRefetching: false, refetch: jest.fn() }),
}));
jest.mock('@hooks/usePortfolio', () => ({
  usePositions: () => ({ data: [], isRefetching: false, refetch: jest.fn() }),
  usePortfolioRisk: () => ({ data: null, isRefetching: false, refetch: jest.fn() }),
  usePortfolioSummary: () => ({
    data: { totalValue: 9_876_543_210_123, totalPnl: -1_234_567_890, totalPnlPercent: -12.5 },
    isRefetching: false,
    refetch: jest.fn(),
  }),
}));

const position: Position = {
  id: 'synthetic',
  portfolioId: 'synthetic',
  corpCode: 'SYNTHETIC',
  corpName: '아주긴한국어기업이름을가진가상반도체주식회사',
  pnlPercent: -12.5,
  thesisStatus: 'VIOLATED',
  exitAction: 'EXIT',
  quantity: 123_456_789,
  avgPrice: 9_876_543_210,
};
const detail =
  '단일 종목 집중도와 일일 손실 한도를 동시에 초과했습니다. 긴 위험 사유도 생략 없이 끝까지 읽을 수 있어야 합니다.';
const risk: PortfolioRiskSnapshot = {
  portfolioId: 'synthetic',
  snapshotDate: '2026-10-13',
  totalValue: 100_000,
  cashAmount: 0,
  unrealizedPnl: -1_000,
  unrealizedPnlPct: -1,
  topPositionPct: 98,
  topSectorPct: null,
  openPositionCount: 2,
  dailyPnl: -1_000,
  dailyPnlPct: -12.5,
  weeklyPnl: null,
  weeklyPnlPct: null,
  riskLevel: 'CRITICAL',
  hardRuleBreached: true,
  hardRuleDetail: detail,
};
const allocation: AosAllocationSummary = {
  policy: null,
  executionAvailable: false,
  plans: [
    {
      id: 'synthetic',
      periodStart: '2026-10-01T00:00:00.000Z',
      periodEnd: '2026-10-31T00:00:00.000Z',
      revision: 1,
      distributableProfit: '9876543210123',
      currency: 'KRW',
      approvedAt: '2026-10-31T12:00:00.000Z',
      planHash: 'synthetic',
      items: [
        { destination: 'SPGI', weight: 0.5, amount: '4938271605062' },
        { destination: 'VTI', weight: 0.3, amount: '2962962963037' },
        { destination: 'SYSTEM_TRADING', weight: 0.2, amount: '1975308642024' },
      ],
    },
  ],
};
const styles = StyleSheet.create({ narrow: { width: 320 } });

function renderNarrow(content: React.ReactNode, scheme: 'light' | 'dark' = 'light') {
  return render(
    <ThemeContext.Provider value={getTheme(scheme, 1.5)}>
      <View style={styles.narrow}>{content}</View>
    </ThemeContext.Provider>,
  );
}

describe('포지션 큰 글씨 레이아웃 안전장치', () => {
  it.each(['light', 'dark'] as const)(
    '%s 320dp/1.5배에서 회사명·수량·평단을 숨기거나 축소하지 않는다',
    (scheme) => {
      const onPress = jest.fn();
      const { getByText, getByRole } = renderNarrow(
        <PositionCard position={position} onPress={onPress} />,
        scheme,
      );
      for (const label of [
        position.corpName,
        '123,456,789주',
        '평단 9,876,543,210원',
        '자동 매도 예정',
      ]) {
        const text = getByText(label);
        expect(text.props.numberOfLines).toBeUndefined();
        expect(text.props.adjustsFontSizeToFit).not.toBe(true);
        expect(StyleSheet.flatten(text.props.style).fontSize).toBeGreaterThanOrEqual(21);
      }
      fireEvent.press(getByRole('button', { name: new RegExp(position.corpName) }));
      expect(onPress).toHaveBeenCalledWith(position);
    },
  );

  it('Risk 상세의 2줄 재단을 없애고 경고 본문 대비를 확보한다', () => {
    const { getByText } = renderNarrow(<PortfolioRiskBadge snapshot={risk} />);
    const body = getByText(detail, { includeHiddenElements: true });
    expect(body.props.numberOfLines).toBeUndefined();
    expect(StyleSheet.flatten(body.props.style)).toMatchObject({
      fontSize: 21,
      lineHeight: 30,
      color: getTheme('light').colors.text,
    });
    expect(getByText('당일 -12.5%', { includeHiddenElements: true })).toBeTruthy();
    expect(getByText('최대종목 98%', { includeHiddenElements: true })).toBeTruthy();
  });

  it('큰 배분액과 이체 제한 설명에 한 줄 축소나 고정 행간을 적용하지 않는다', () => {
    const { getByText } = renderNarrow(<AllocationSummaryCard summary={allocation} />);
    for (const value of [
      '9,876,543,210,123원',
      '4,938,271,605,062원',
      '2,962,962,963,037원',
      '1,975,308,642,024원',
    ]) {
      const amount = getByText(value);
      expect(amount.props.numberOfLines).toBeUndefined();
      expect(amount.props.adjustsFontSizeToFit).not.toBe(true);
      expect(StyleSheet.flatten(amount.props.style).fontSize).toBeGreaterThanOrEqual(24);
    }
    const basis = getByText(/송금·환전·매수 자동 실행 없음/);
    expect(StyleSheet.flatten(basis.props.style).lineHeight).toBe(30);
  });

  it('포지션 화면 총액은 별도 전폭 행에서 정확한 금액을 보존한다', () => {
    const { getByText } = renderNarrow(<PortfolioScreen />);
    const total = getByText('9,876,543,210,123원');
    expect(total.props.numberOfLines).toBeUndefined();
    expect(total.props.adjustsFontSizeToFit).not.toBe(true);
    expect(getByText('조회 전용 · 실주문 기능 없음')).toBeTruthy();
    expect(getByText('보유 포지션이 없습니다')).toBeTruthy();
  });
});
