import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { EmptyState } from '@components/common/StateView';

// 빈 상태 뷰 렌더 스모크(RNTL) — 카피 테이블(emptyStateCopy)과 함께 빈 화면 회귀를 가드.
describe('components/common/StateView — EmptyState', () => {
  it('타이틀·설명을 렌더한다', () => {
    const { getByText } = render(
      <EmptyState
        icon="star"
        title="아직 관심 기업이 없어요"
        description="검색해서 추가해 보세요"
      />,
    );

    expect(getByText('아직 관심 기업이 없어요')).toBeTruthy();
    expect(getByText('검색해서 추가해 보세요')).toBeTruthy();
  });

  it('actionLabel+onAction 이 있으면 액션 버튼이 렌더되고 탭 시 호출된다', () => {
    const onAction = jest.fn();
    const { getByText, rerender, queryByText } = render(
      <EmptyState title="빈 상태" actionLabel="다시 불러오기" onAction={onAction} />,
    );

    fireEvent.press(getByText('다시 불러오기'));
    expect(onAction).toHaveBeenCalledTimes(1);

    // onAction 미지정이면 라벨이 있어도 버튼을 렌더하지 않는다(빈 버튼 방지).
    rerender(<EmptyState title="빈 상태" actionLabel="다시 불러오기" />);
    expect(queryByText('다시 불러오기')).toBeNull();
  });
});
