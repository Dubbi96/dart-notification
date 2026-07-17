import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { router } from 'expo-router';
import UpcomingEventsScreen from '../../app/upcoming-events/index';
import { useUpcomingEvents } from '@hooks/useUpcomingEvents';

// DAR-541: 예정 이벤트 전체 화면 — D-day 정렬 렌더·오늘/임박 칩·공시 딥링크·정직 빈 상태·게스트 로그인 유도.
// 서버가 D-day 오름차순 정렬해 내려주므로(백엔드 deriver localeCompare(date)) 화면은 그 순서를 그대로 렌더한다.

jest.mock('@hooks/useUpcomingEvents', () => ({
  useUpcomingEvents: jest.fn(),
  UPCOMING_EVENTS_KEY: ['upcoming-events'],
}));

jest.mock('expo-router', () => ({ router: { push: jest.fn(), back: jest.fn() } }));
const mockRouter = router as unknown as { push: jest.Mock; back: jest.Mock };

// 관심기업 기반 화면 — 인증 상태를 테스트별로 토글(getState().clearAuth 도 제공).
const mockAuth = { isAuthenticated: true, clearAuth: jest.fn() };
jest.mock('@stores/authStore', () => ({
  useAuthStore: Object.assign((selector: (s: typeof mockAuth) => unknown) => selector(mockAuth), {
    getState: () => mockAuth,
  }),
}));

// SafeAreaView 는 네이티브 의존 없이 children 통과(결정론).
jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: ({ children }: { children: React.ReactNode }) => children,
  SafeAreaProvider: ({ children }: { children: React.ReactNode }) => children,
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));

const mockUseUpcomingEvents = useUpcomingEvents as unknown as jest.Mock;

function queryResult(overrides: Record<string, unknown>) {
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

// 서버가 내려준 순서(D-day 오름차순): D-Day → D-2(임박) → D-40(비임박)
const ITEMS = [
  {
    kind: 'SUBSCRIPTION',
    label: '유상증자 청약일',
    date: '2026-07-17',
    dDay: 0,
    corpCode: 'C1',
    corpName: '알파전자',
    stockCode: '000001',
    rcpNo: '20260717000001',
    eventType: 'RIGHTS_OFFERING',
  },
  {
    kind: 'NEW_SHARES_LISTING',
    label: '신주 상장 예정일',
    date: '2026-07-19',
    dDay: 2,
    corpCode: 'C2',
    corpName: '베타바이오',
    stockCode: '000002',
    rcpNo: '20260717000002',
    eventType: 'LISTING',
  },
  {
    kind: 'DIVIDEND_RECORD',
    label: '배당 기준일',
    date: '2026-08-26',
    dDay: 40,
    corpCode: 'C3',
    corpName: '감마화학',
    stockCode: '000003',
    rcpNo: '20260717000003',
    eventType: 'DIVIDEND',
  },
];

describe('app/upcoming-events (예정 이벤트 전체 화면)', () => {
  beforeEach(() => {
    mockRouter.push.mockClear();
    mockRouter.back.mockClear();
    mockAuth.isAuthenticated = true;
  });

  it('이벤트가 있으면 D-day 순서대로 렌더하고 오늘/임박 D-day 칩을 표시한다', () => {
    mockUseUpcomingEvents.mockReturnValue(queryResult({ data: { baseDate: '2026-07-17', days: 90, items: ITEMS } }));
    const { getByText } = render(<UpcomingEventsScreen />);

    // 세 이벤트 모두 렌더 + D-day 칩 표기(오늘=D-Day, 임박=D-2, 비임박=D-40).
    expect(getByText('알파전자')).toBeTruthy();
    expect(getByText('베타바이오')).toBeTruthy();
    expect(getByText('감마화학')).toBeTruthy();
    expect(getByText('D-Day')).toBeTruthy();
    expect(getByText('D-2')).toBeTruthy();
    expect(getByText('D-40')).toBeTruthy();
  });

  it('행을 탭하면 근거 공시 상세로 딥링크한다', () => {
    mockUseUpcomingEvents.mockReturnValue(queryResult({ data: { baseDate: '2026-07-17', days: 90, items: ITEMS } }));
    const { getByText } = render(<UpcomingEventsScreen />);

    fireEvent.press(getByText('알파전자'));
    expect(mockRouter.push).toHaveBeenCalledWith('/disclosure/20260717000001');
  });

  it('이벤트가 없으면 정직한 빈 상태(발명 금지)를 노출한다', () => {
    mockUseUpcomingEvents.mockReturnValue(queryResult({ data: { baseDate: '2026-07-17', days: 90, items: [] } }));
    const { getByText, queryByText } = render(<UpcomingEventsScreen />);

    expect(getByText('예정된 이벤트가 없어요')).toBeTruthy();
    expect(queryByText('D-Day')).toBeNull();
  });

  it('게스트는 로그인 유도 빈 상태를 노출하고 CTA가 로그인 화면으로 이동한다', () => {
    mockAuth.isAuthenticated = false;
    mockUseUpcomingEvents.mockReturnValue(queryResult({ data: undefined }));
    const { getByText } = render(<UpcomingEventsScreen />);

    expect(getByText('로그인하고 예정 일정을 확인하세요')).toBeTruthy();
    fireEvent.press(getByText('로그인'));
    expect(mockRouter.push).toHaveBeenCalledWith('/auth/sign-in');
  });

  it('에러 시 재시도 가능한 에러 상태를 노출한다(빈 백지 금지)', () => {
    const refetch = jest.fn();
    mockUseUpcomingEvents.mockReturnValue(
      queryResult({ isError: true, error: new Error('boom'), refetch }),
    );
    const { getByText } = render(<UpcomingEventsScreen />);
    // ApiErrorState → ErrorState 는 일반 에러에 '재시도' 버튼을 노출한다.
    expect(getByText('재시도')).toBeTruthy();
  });
});
