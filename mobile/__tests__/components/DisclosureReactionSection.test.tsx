import React from 'react';
import { render } from '@testing-library/react-native';
import { DisclosureReactionSection } from '@components/disclosure/DisclosureReactionSection';
import { useDisclosureReactionStats } from '@hooks/useDisclosures';

// DAR-512: '과거 유사공시 반응' 표준 섹션 — 3상태 정직 분기 검증.
//   정상(n≥30)·표본부족(n<30/미추출)·API실패 + n 상시 표기 + 면책 고정.
//   useDisclosureReactionStats(react-query)만 모킹, 컴포넌트는 실제 렌더(테마 기본 컨텍스트).
jest.mock('@hooks/useDisclosures', () => ({ useDisclosureReactionStats: jest.fn() }));

const mockUseReaction = useDisclosureReactionStats as unknown as jest.Mock;

const DISCLAIMER = '과거 통계이며 투자권유가 아닙니다';

function queryResult(overrides: Record<string, unknown>) {
  return {
    data: undefined,
    isLoading: false,
    isError: false,
    error: null,
    refetch: jest.fn(),
    ...overrides,
  };
}

function statsResponse(result: Record<string, unknown> | null) {
  return {
    rcpNo: '20260717000001',
    minSampleSize: 30,
    generatedAt: '2026-07-17T00:00:00.000Z',
    results: result ? [result] : [],
  };
}

describe('components/disclosure/DisclosureReactionSection', () => {
  it('로딩 중에는 스켈레톤(진행 표시)을 렌더한다', () => {
    mockUseReaction.mockReturnValue(queryResult({ isLoading: true }));
    const { getByLabelText } = render(<DisclosureReactionSection rcpNo="r1" />);
    expect(getByLabelText('과거 유사공시 반응 불러오는 중')).toBeTruthy();
  });

  it('API 실패 시 정직한 에러 + 재시도 동선을 노출한다', () => {
    mockUseReaction.mockReturnValue(
      queryResult({ isError: true, error: new Error('boom') }),
    );
    const { getByText } = render(<DisclosureReactionSection rcpNo="r1" />);
    expect(getByText('반응 통계를 불러오지 못했습니다')).toBeTruthy();
  });

  it('표본부족(n<30)은 정직 카피를 노출하고 n을 상시 표기하며 면책을 고정한다', () => {
    mockUseReaction.mockReturnValue(
      queryResult({
        data: statsResponse({
          eventType: 'SUPPLY_CONTRACT',
          sampleCount: 12,
          stats: null,
          reason: 'INSUFFICIENT_SAMPLE',
          period: { fromDate: '20240101', toDate: '20260101' },
          calculatedAt: '2026-07-16T00:00:00.000Z',
        }),
      }),
    );
    const { getByLabelText } = render(<DisclosureReactionSection rcpNo="r1" />);
    // 정직 카피 + n 상시 표기(합성 라벨에 '표본 12건'·honest copy 포함).
    expect(getByLabelText(/표본이 부족해 통계를 표시하지 않습니다/)).toBeTruthy();
    expect(getByLabelText(/표본 12건/)).toBeTruthy();
    // 면책 고정(정확 라벨 = FixedDisclaimer 단일 노드).
    expect(getByLabelText(DISCLAIMER)).toBeTruthy();
  });

  it('이벤트 미추출(results 빈 배열)도 표본 0건으로 정직 분기한다', () => {
    mockUseReaction.mockReturnValue(queryResult({ data: statsResponse(null) }));
    const { getByLabelText } = render(<DisclosureReactionSection rcpNo="r1" />);
    expect(getByLabelText(/표본이 부족해 통계를 표시하지 않습니다/)).toBeTruthy();
    expect(getByLabelText(/표본 0건/)).toBeTruthy();
    expect(getByLabelText(DISCLAIMER)).toBeTruthy();
  });

  it('정상(n≥30)은 N건·공시 후 5일 평균·승률 헤드라인과 면책을 노출한다', () => {
    mockUseReaction.mockReturnValue(
      queryResult({
        data: statsResponse({
          eventType: 'SUPPLY_CONTRACT',
          sampleCount: 42,
          stats: {
            d1: { avgReturn: 0.8, avgAbnormalReturn: 0.5, winRate: 0.55 },
            d5: { avgReturn: 2.34, avgAbnormalReturn: 1.2, winRate: 0.63 },
            d20: { avgReturn: -1.1, avgAbnormalReturn: -0.4, winRate: 0.48 },
          },
          reason: null,
          period: { fromDate: '20240101', toDate: '20260101' },
          calculatedAt: '2026-07-16T00:00:00.000Z',
        }),
      }),
    );
    const { getByLabelText } = render(<DisclosureReactionSection rcpNo="r1" />);
    // 합성 요약 라벨: 'N건 … 공시 후 5일 평균 수익률 +2.3% … 승률 63%'.
    expect(getByLabelText(/42건/)).toBeTruthy();
    expect(getByLabelText(/공시 후 5일 평균 수익률 \+2\.3%/)).toBeTruthy();
    expect(getByLabelText(/승률 63%/)).toBeTruthy();
    expect(getByLabelText(DISCLAIMER)).toBeTruthy();
  });
});
