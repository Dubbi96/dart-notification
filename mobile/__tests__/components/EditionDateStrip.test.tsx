import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { EditionDateStrip } from '@components/signals/EditionDateStrip';

// DAR-509: 날짜 스트립 렌더 스모크 — 오늘/어제/M.D 라벨 + 건수 + 합성 today + onSelect.
const editions = [
  { date: '20260717', count: 3, strongBuyCount: 1 },
  { date: '20260716', count: 2, strongBuyCount: 0 },
  { date: '20260714', count: 5, strongBuyCount: 2 },
];

describe('components/signals/EditionDateStrip', () => {
  it('오늘/어제/M.D 라벨과 건수를 렌더한다', () => {
    const { getByText } = render(
      <EditionDateStrip
        editions={editions}
        todayDate="20260717"
        selectedDate="20260717"
        onSelect={jest.fn()}
      />,
    );
    expect(getByText('오늘')).toBeTruthy();
    expect(getByText('어제')).toBeTruthy();
    expect(getByText('7.14')).toBeTruthy();
    expect(getByText('3')).toBeTruthy(); // 오늘 건수 dot
  });

  it('오늘 미발행이면 딤 오늘 칩을 합성해 진입점을 유지한다(빈 날 발명 아님)', () => {
    const pastOnly = [{ date: '20260716', count: 2, strongBuyCount: 0 }];
    const { getByText } = render(
      <EditionDateStrip
        editions={pastOnly}
        todayDate="20260717"
        selectedDate="20260716"
        onSelect={jest.fn()}
      />,
    );
    expect(getByText('오늘')).toBeTruthy(); // 합성 today 칩
    expect(getByText('어제')).toBeTruthy();
  });

  it('칩 탭 시 해당 날짜(YYYYMMDD)로 onSelect를 호출한다', () => {
    const onSelect = jest.fn();
    const { getByText } = render(
      <EditionDateStrip
        editions={editions}
        todayDate="20260717"
        selectedDate="20260717"
        onSelect={onSelect}
      />,
    );
    fireEvent.press(getByText('어제'));
    expect(onSelect).toHaveBeenCalledWith('20260716');
  });

  it('에디션도 오늘도 없으면 렌더하지 않는다(빈 스트립 방지)', () => {
    const { toJSON } = render(
      <EditionDateStrip editions={[]} todayDate={undefined} selectedDate={undefined} onSelect={jest.fn()} />,
    );
    expect(toJSON()).toBeNull();
  });

  // DAR-527: '놓친 호'(미열람) 뱃지 — unreadDates 멤버십으로만 표시(a11y '안 읽음').
  it('놓친 호(미열람) 날짜는 안읽음 뱃지를 표시한다', () => {
    const { getByLabelText, queryByLabelText } = render(
      <EditionDateStrip
        editions={editions}
        todayDate="20260717"
        selectedDate="20260717"
        onSelect={jest.fn()}
        unreadDates={new Set(['20260716'])}
      />,
    );
    // 어제(20260716) 칩 = 미열람 → '안 읽음' 라벨(스트립에서 유일 매칭).
    expect(getByLabelText(/안 읽음/)).toBeTruthy();
    // 오늘(선택·열람 중)은 뱃지 미표시.
    expect(queryByLabelText(/오늘 에디션.*안 읽음/)).toBeNull();
  });

  it('선택(열람 중)된 호는 unreadDates 에 있어도 뱃지를 표시하지 않는다', () => {
    const { queryByLabelText } = render(
      <EditionDateStrip
        editions={editions}
        todayDate="20260717"
        selectedDate="20260717"
        onSelect={jest.fn()}
        unreadDates={new Set(['20260717'])}
      />,
    );
    expect(queryByLabelText(/안 읽음/)).toBeNull();
  });

  it('unreadDates 가 비면(계열 OFF 정합) 어떤 칩도 안읽음 뱃지를 표시하지 않는다', () => {
    const { queryByLabelText } = render(
      <EditionDateStrip
        editions={editions}
        todayDate="20260717"
        selectedDate="20260717"
        onSelect={jest.fn()}
        unreadDates={new Set()}
      />,
    );
    expect(queryByLabelText(/안 읽음/)).toBeNull();
  });
});
