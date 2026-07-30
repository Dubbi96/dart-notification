import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import { EditionSignalList } from '@components/signals/EditionSignalList';
import { useEdition } from '@hooks/useSignals';
import { router } from 'expo-router';

// DAR-509: 에디션 세로 리스트 — 빈 4분기 카피 / 과거 배너·오늘로 / 오늘 배너 미노출을 검증.
// DAR-552: 빈 에디션 폴백 '오늘의 주요 공시 브리핑'(meta.fallbackBriefing) 유/무 2상태를 추가 검증.
// useEdition(react-query)·expo-router 만 모킹하고 종합 의견·판단 플랜 카드는 실제 렌더한다.
jest.mock('@hooks/useSignals', () => ({ useEdition: jest.fn() }));
jest.mock('expo-router', () => ({ router: { push: jest.fn() } }));

const mockUseEdition = useEdition as unknown as jest.Mock;
const mockRouterPush = router.push as jest.Mock;

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
  beforeEach(() => {
    mockRouterPush.mockClear();
  });

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

  it('폴백 브리핑 없음(빈 배열)이면 정직 카피만 노출하고 브리핑 섹션은 렌더하지 않는다', () => {
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
            fallbackBriefing: [],
          },
        },
      }),
    );
    const { getByText, queryByTestId, queryByText } = render(
      <EditionSignalList date="20260716" todayDate="20260717" onSelectDate={jest.fn()} />,
    );
    expect(getByText('이 날은 주목할 신호가 없었어요')).toBeTruthy();
    expect(queryByTestId('edition-fallback-briefing')).toBeNull();
    expect(queryByText(/오늘의 주요 공시/)).toBeNull();
  });

  it('폴백 브리핑 있음이면 정직 카피 아래 "오늘의 주요 공시 N건" 섹션을 렌더하고 행 탭 시 공시 상세로 이동한다', () => {
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
            fallbackBriefing: [
              {
                rcpNo: '20260716000123',
                corpName: '삼성전자',
                eventLabel: '공급계약',
                summaryLine: '반도체 장비 공급계약 체결 — 계약금액 1,200억원 규모.',
                summarySource: 'AI',
              },
              {
                rcpNo: '20260716000456',
                corpName: 'SK하이닉스',
                eventLabel: '기타 공시',
                summaryLine: '분기보고서 제출.',
                summarySource: 'TITLE',
              },
            ],
          },
        },
      }),
    );
    const { getByText, getByLabelText } = render(
      <EditionSignalList date="20260716" todayDate="20260717" onSelectDate={jest.fn()} />,
    );
    // 정직 라벨: 빈 이유 카피가 상위에 유지된다(브리핑이 판단을 위장하지 않음).
    expect(getByText('이 날은 주목할 신호가 없었어요')).toBeTruthy();
    expect(getByText('오늘의 주요 공시 2건')).toBeTruthy();
    expect(getByText('삼성전자')).toBeTruthy();
    expect(getByText('공급계약')).toBeTruthy();
    expect(getByText('반도체 장비 공급계약 체결 — 계약금액 1,200억원 규모.')).toBeTruthy();
    expect(getByText('SK하이닉스')).toBeTruthy();

    // 탭 → 공시 상세(rcpNo 기반 딥링크)로 이동.
    fireEvent.press(
      getByLabelText('삼성전자 공급계약. 반도체 장비 공급계약 체결 — 계약금액 1,200억원 규모.'),
    );
    expect(mockRouterPush).toHaveBeenCalledWith('/disclosure/20260716000123');
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
              eventType: 'SUPPLY_CONTRACT',
              summary: '공급계약 규모와 거래량을 함께 확인한 판단입니다.',
              entryConditions: [
                { id: 'ma20', label: '현재가가 20일 이동평균선 위', required: true, met: true },
              ],
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
    expect(getByText('당시의 종합 의견')).toBeTruthy();
    expect(getByLabelText(/1순위 삼성전자, 조건부 진입 검토/)).toBeTruthy();
    expect(getByText('당시 조건 유지 시 단기 기준', { includeHiddenElements: true })).toBeTruthy();
    expect(getByText('+10%', { includeHiddenElements: true })).toBeTruthy();
    expect(getByText('-5%', { includeHiddenElements: true })).toBeTruthy();
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
              eventType: 'SUPPLY_CONTRACT',
              entryConditions: [{ id: 'rsi', label: 'RSI 70 미만', required: true, met: false }],
              riskFlags: [],
              createdAt: '2026-07-17T10:00:00Z',
            },
          ],
          meta: { date: '20260717', isToday: true, isEmpty: false },
        },
      }),
    );
    const { getByText, getByLabelText, queryByText } = render(
      <EditionSignalList date="20260717" todayDate="20260717" onSelectDate={jest.fn()} />,
    );
    expect(queryByText('지난 판단 · 현재 시세와 다를 수 있어요')).toBeNull();
    expect(getByText('오늘의 종합 의견')).toBeTruthy();
    expect(getByText('지금은 진입보다 확인이 먼저예요')).toBeTruthy();
    expect(getByLabelText(/1순위 삼성전자, 조건 확인 전 대기/)).toBeTruthy();
    expect(getByText('RSI 70 미만', { includeHiddenElements: true })).toBeTruthy();
    expect(queryByText('+10%', { includeHiddenElements: true })).toBeNull();
  });
});
