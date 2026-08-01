import React from 'react';
import { render } from '@testing-library/react-native';

import UpcomingEventsScreen from '../../app/upcoming-events/index';

const mockRedirect = jest.fn(() => null);

jest.mock('expo-router', () => ({
  Redirect: (props: { href: string }) => mockRedirect(props),
}));

describe('legacy upcoming-events route', () => {
  beforeEach(() => jest.clearAllMocks());

  it('AOS 핵심 IA 밖의 별도 화면 대신 공시 근거 목록으로 이동한다', () => {
    render(<UpcomingEventsScreen />);
    expect(mockRedirect).toHaveBeenCalledWith({ href: '/disclosures' });
  });
});
