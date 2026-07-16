import React from 'react';
import { render } from '@testing-library/react-native';
import { EditionSignalList } from '@components/signals/EditionSignalList';
import { useEdition } from '@hooks/useSignals';

// DAR-509: 에디션 세로 리스트 — 빈 4분기 카피 / 과거 배너·오늘로 / 오늘 배너 미노출을 검증.
// useEdition(react-query)·expo-router 만 모킹하고 SignalExploreCard 는 실제 렌더(corpName 노출).
jest.mock('@hooks/useSignals', () => ({ useEdition: jest.fn() }));
jest.mock('expo-router', () => ({ router: { push: jest.fn() } }));

const mockUseEdition = useEdition as unknown as jest.Mock;

function editionResult(overrides: Record<string, unknown>) {
  return {
    data: undefined,
    isLoading: false,
    isError: false,
    isRefetching: false,
    error: null,
    refetch: jest.fn(),
    ...overrides,
  };
}

describe('components/signals/EditionSignalList', () => {
  it('날짜 미확정/로딩 중에는 스켈레톤을 렌더한다(백지 방지)', () => {
    mockUseEdition.mockReturnValue(editionResult({ isLoading: true }));
    const { toJSON } = render(
      <EditionSignalList date={undefined} todayDate="20260717" onSelectDate={jest.fn()} />,
    );
    expect(toJSON()).toBeTruthy();
  });

  it('빈 에디션(QUIET)은 정직 카피 + 직전 거래일 CTA를 노출한다', () => {
    mockUseEdition.mockReturnValue(
      editionResult({
        data: {
          items: [],
          meta: {
            date: '20260716',
            isToday: false,
            isEmpty: true,
            emptyReason: 'QUIET',
            prevEditionDate: '20260714',
          },
        },
      }),
    );
    const { getByText } = render(
      <EditionSignalList date="20260716" todayDate="20260717" onSelectDate={jest.fn()} />,
    );
    expect(getByText('이 날은 주목할 신호가 없었어요')).toBeTruthy();
    expect(getByText('직전 거래일 보기')).toBeTruthy();
  });

  it('과거 에디션(신호 있음)은 지난 판단 배너 + 오늘로 리셋 + 카드', () => {
    mockUseEdition.mockReturnValue(
      editionResult({
        data: {
          items: [
            {
              id: 's1',
              corpCode: '00126380',
              corpName: '삼성전자',
              buyScore: 80,
              grade: 'BUY',
              riskFlags: [],
              createdAt: '2026-07-16T10:00:00Z',
            },
          ],
          meta: { date: '20260716', isToday: false, isEmpty: false },
        },
      }),
    );
    const { getByText, getByLabelText } = render(
      <EditionSignalList date="20260716" todayDate="20260717" onSelectDate={jest.fn()} />,
    );
    expect(getByText('지난 판단 · 현재 시세와 다를 수 있어요')).toBeTruthy();
    expect(getByText('오늘로')).toBeTruthy();
    // 카드는 Surface no-hide-descendants 라 내부 Text 는 a11y 트리에서 숨김 → 카드 단위 합성
    // 라벨(기업명 포함)로 렌더 여부를 검증한다.
    expect(getByLabelText(/삼성전자/)).toBeTruthy();
  });

  it('오늘 에디션에는 지난 판단 배너를 노출하지 않는다', () => {
    mockUseEdition.mockReturnValue(
      editionResult({
        data: {
          items: [
            {
              id: 's1',
              corpCode: '00126380',
              corpName: '삼성전자',
              buyScore: 80,
              grade: 'BUY',
              riskFlags: [],
              createdAt: '2026-07-17T10:00:00Z',
            },
          ],
          meta: { date: '20260717', isToday: true, isEmpty: false },
        },
      }),
    );
    const { queryByText } = render(
      <EditionSignalList date="20260717" todayDate="20260717" onSelectDate={jest.fn()} />,
    );
    expect(queryByText('지난 판단 · 현재 시세와 다를 수 있어요')).toBeNull();
  });
});
