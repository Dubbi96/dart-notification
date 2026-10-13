import React from 'react';
import { render } from '@testing-library/react-native';
import { Feather } from '@expo/vector-icons';
import { DisclaimerSection } from '@components/common/DisclaimerSection';

jest.mock('@expo/vector-icons', () => ({ Feather: () => null }));

it('단일 경고 아이콘을 사용하고 모든 면책 본문과 위험 맥락을 유지한다', () => {
  const notes = [
    '표시 가격은 해당 에디션 시점의 종가를 기준으로 기기에서 계산한 Shadow 계획이며 실주문이 아닙니다.',
    '시장가 갭으로 진입 구간을 벗어나면 계획을 적용하지 않습니다.',
  ];
  const { getByText, queryByText, UNSAFE_getAllByType } = render(
    <DisclaimerSection contextNotes={notes} />,
  );
  const icons = UNSAFE_getAllByType(Feather);
  expect(icons).toHaveLength(1);
  expect(icons[0].props.name).toBe('alert-triangle');
  expect(getByText('투자자문 아님')).toBeTruthy();
  expect(queryByText(/^⚠/)).toBeNull();
  for (const note of notes) expect(getByText(note)).toBeTruthy();
  expect(
    getByText(
      '이 서비스의 모든 분석·신호·점수는 AI 및 통계 모델이 생성한 참고 정보입니다. ' +
        '특정 종목의 매수·매도를 권유하지 않으며, 투자 결정 및 손실·이익의 책임은 ' +
        '전적으로 투자자 본인에게 있습니다.',
    ),
  ).toBeTruthy();
});
