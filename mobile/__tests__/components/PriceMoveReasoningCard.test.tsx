import React from 'react';
import { render } from '@testing-library/react-native';
import { PriceMoveReasoningCard } from '@components/priceMove/PriceMoveReasoningCard';
import { useDisclosureReactionStats } from '@hooks/useDisclosures';

import type { PriceMoveReasoning } from '@app-types/priceMove.types';

// DAR-524: '왜 움직였나' 카드 3상태(+CAP_SKIPPED) 분기 검증(수용기준 1).
//   재사용하는 DisclosureReactionSection 의 훅만 모킹(로딩 스켈레톤)하고 카드는 실제 렌더.
jest.mock('@hooks/useDisclosures', () => ({ useDisclosureReactionStats: jest.fn() }));
const mockUseReaction = useDisclosureReactionStats as unknown as jest.Mock;

function base(overrides: Partial<PriceMoveReasoning>): PriceMoveReasoning {
  return {
    refId: '000200-20260717',
    stockCode: '000200',
    corpCode: 'C002',
    corpName: '테스트전자',
    tradeDate: '20260717',
    changePct: 6.2,
    rcpNo: '20260717000001',
    status: 'ANALYZED',
    createdAt: '2026-07-17T06:00:00.000Z',
    resultJson: { status: 'ANALYZED', eventType: 'UNKNOWN', cause: '', evidence: [], eventLinkage: 'WEAK', caveat: '' },
    ...overrides,
  };
}

describe('components/priceMove/PriceMoveReasoningCard', () => {
  beforeEach(() => {
    // 유사공시 통계 섹션은 로딩 상태로 고정(카드 자체 분기만 검증).
    mockUseReaction.mockReturnValue({
      data: undefined,
      isLoading: true,
      isError: false,
      error: null,
      refetch: jest.fn(),
    });
  });

  it('ANALYZED — 원인 해석·등락폭·근거·유사공시 섹션을 렌더한다', () => {
    const reasoning = base({
      status: 'ANALYZED',
      changePct: 6.2,
      rcpNo: '20260717000001',
      resultJson: {
        status: 'ANALYZED',
        eventType: 'SUPPLY_CONTRACT',
        cause: '대규모 공급계약 공시가 상승을 이끈 것으로 보입니다.',
        evidence: ['공급계약 규모가 시가총액 대비 큼', '유사공시 D+5 평균 +4%'],
        eventLinkage: 'STRONG',
        caveat: '상관관계일 뿐 인과를 단정할 수 없습니다.',
      },
    });
    const { getByText, getByLabelText } = render(<PriceMoveReasoningCard reasoning={reasoning} />);

    expect(getByText('대규모 공급계약 공시가 상승을 이끈 것으로 보입니다.')).toBeTruthy();
    expect(getByText('공급계약 규모가 시가총액 대비 큼')).toBeTruthy();
    expect(getByText('연관성 강함')).toBeTruthy();
    expect(getByText('+6.2%')).toBeTruthy();
    expect(getByText('상관관계일 뿐 인과를 단정할 수 없습니다.')).toBeTruthy();
    // 유사공시 통계 섹션(rcpNo 키) 재사용 — 로딩 스켈레톤이 마운트됐음을 확인.
    expect(getByLabelText('과거 유사공시 반응 불러오는 중')).toBeTruthy();
  });

  it('ANALYZED 이지만 rcpNo 없으면 유사공시 섹션을 렌더하지 않는다', () => {
    const reasoning = base({
      status: 'ANALYZED',
      rcpNo: null,
      resultJson: {
        status: 'ANALYZED',
        eventType: 'UNKNOWN',
        cause: '원인 해석 본문',
        evidence: [],
        eventLinkage: 'UNCLEAR',
        caveat: '',
      },
    });
    const { queryByLabelText, getByText } = render(<PriceMoveReasoningCard reasoning={reasoning} />);
    expect(getByText('원인 해석 본문')).toBeTruthy();
    expect(queryByLabelText('과거 유사공시 반응 불러오는 중')).toBeNull();
  });

  it('NO_DISCLOSURE — 48시간 무공시 정직 카피를 렌더한다(분석 위장 금지)', () => {
    const reasoning = base({
      status: 'NO_DISCLOSURE',
      rcpNo: null,
      resultJson: {
        status: 'NO_DISCLOSURE',
        label: '관련 공시 없음(48h)',
        message: '테스트전자 +6.2% — 관련 공시 없음(48h)',
      },
    });
    const { getByText } = render(<PriceMoveReasoningCard reasoning={reasoning} />);
    expect(getByText('최근 48시간 관련 공시 없음')).toBeTruthy();
  });

  it('CAP_SKIPPED — 오늘 분석 한도 도달 정직 고지를 렌더한다', () => {
    const reasoning = base({
      status: 'CAP_SKIPPED',
      rcpNo: null,
      resultJson: { status: 'CAP_SKIPPED', message: '오늘 예산 소진' },
    });
    const { getByText } = render(<PriceMoveReasoningCard reasoning={reasoning} />);
    expect(getByText('오늘 원인 분석 한도에 도달했습니다')).toBeTruthy();
  });
});
