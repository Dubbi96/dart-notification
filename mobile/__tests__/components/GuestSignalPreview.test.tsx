import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { GuestSignalPreview } from '@components/signals/GuestSignalPreview';
import { router } from 'expo-router';

jest.mock('@expo/vector-icons', () => ({ Feather: () => null }));
jest.mock('expo-router', () => ({ router: { push: jest.fn() } }));

describe('GuestSignalPreview', () => {
  it('모의 계획과 미연결 실거래를 설명하고 로그인을 선택할 때만 이동한다', () => {
    const { getByText, getByRole, getAllByRole } = render(<GuestSignalPreview />);
    expect(getByText(/모의 가격 계획을 보여드려요/)).toBeTruthy();
    expect(getByText(/실계좌 자동매매는 아직 연결되지 않았어요/)).toBeTruthy();
    expect(getByText(/로그인 없이 상단 ‘기기 점검’/)).toBeTruthy();
    expect(router.push).not.toHaveBeenCalled();
    expect(getAllByRole('button')).toHaveLength(1);
    fireEvent.press(getByRole('button', { name: '로그인하고 판단 보기' }));
    expect(router.push).toHaveBeenCalledWith('/auth/sign-in');
  });

  it('보조 액션은 로그인 이동과 독립적으로 실행한다', () => {
    const onSecondary = jest.fn();
    const { getByRole, getAllByRole } = render(
      <GuestSignalPreview secondaryLabel="공시 둘러보기" onSecondary={onSecondary} />,
    );
    expect(getAllByRole('button')).toHaveLength(2);
    fireEvent.press(getByRole('button', { name: '공시 둘러보기' }));
    expect(onSecondary).toHaveBeenCalledTimes(1);
    expect(router.push).not.toHaveBeenCalled();
  });

  it('보조 라벨 또는 콜백이 빠지면 동작하지 않는 버튼을 만들지 않는다', () => {
    const { queryByRole, rerender, getAllByRole } = render(
      <GuestSignalPreview secondaryLabel="공시 둘러보기" />,
    );
    expect(queryByRole('button', { name: '공시 둘러보기' })).toBeNull();
    rerender(<GuestSignalPreview onSecondary={jest.fn()} />);
    expect(getAllByRole('button')).toHaveLength(1);
  });
});
