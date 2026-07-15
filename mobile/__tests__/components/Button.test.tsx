import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { Button } from '@components/common/Button';

// 공통 Button 렌더 스모크(RNTL) — W15 ①은 순수 로직 위주, 컴포넌트는 최소 2~3개만.
describe('components/common/Button', () => {
  it('타이틀을 렌더하고 탭 시 onPress 를 1회 호출한다', () => {
    const onPress = jest.fn();
    const { getByText } = render(<Button title="계속하기" onPress={onPress} />);

    fireEvent.press(getByText('계속하기'));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('disabled 상태에서는 onPress 가 호출되지 않고 a11y 상태가 반영된다', () => {
    const onPress = jest.fn();
    const { getByRole } = render(<Button title="제출" onPress={onPress} disabled />);

    const button = getByRole('button');
    expect(button.props.accessibilityState.disabled).toBe(true);
    fireEvent.press(button);
    expect(onPress).not.toHaveBeenCalled();
  });

  it('loading 상태에서는 타이틀 텍스트 대신 스피너를 렌더한다(라벨은 유지)', () => {
    const { queryByText, getByRole } = render(
      <Button title="저장" onPress={jest.fn()} loading />,
    );

    expect(queryByText('저장')).toBeNull();
    expect(getByRole('button').props.accessibilityLabel).toBe('저장');
    expect(getByRole('button').props.accessibilityState.busy).toBe(true);
  });
});
