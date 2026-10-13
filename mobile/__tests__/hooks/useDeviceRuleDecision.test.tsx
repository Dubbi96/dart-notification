import React from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import { act, cleanupAsync, renderHook, waitFor } from '@testing-library/react-native/pure';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useDeviceRuleDecision } from '@hooks/useDeviceRuleDecision';
import { useAosMobileControl } from '@hooks/useAosMobileControl';
import { saveDeviceEditionReceipt } from '@services/deviceDecisionCache.service';
import { evaluateEditionOnDevice, type DeviceEditionDecision } from '@utils/deviceRuleDecision';

import type { TradingSignal } from '@app-types/signal.types';

let mockAuthenticated = true;
let mockGuest = false;
jest.mock('@stores/authStore', () => ({
  useAuthStore: (selector: (state: { isAuthenticated: boolean; isGuest: boolean }) => unknown) =>
    selector({ isAuthenticated: mockAuthenticated, isGuest: mockGuest }),
}));
jest.mock('@hooks/useAosMobileControl', () => ({ useAosMobileControl: jest.fn() }));
jest.mock('@utils/deviceRuleDecision', () => ({ evaluateEditionOnDevice: jest.fn() }));
jest.mock('@services/deviceDecisionCache.service', () => ({
  saveDeviceEditionReceipt: jest.fn(),
  loadDeviceEditionReceipt: jest.fn(),
}));

const mockControls = useAosMobileControl as jest.Mock;
const mockEvaluate = evaluateEditionOnDevice as jest.MockedFunction<typeof evaluateEditionOnDevice>;
const mockSave = saveDeviceEditionReceipt as jest.MockedFunction<typeof saveDeviceEditionReceipt>;
const NOW = Date.parse('2026-10-13T10:00:00.000Z');
const signal: TradingSignal = {
  id: 'safety-test',
  corpCode: 'SYNTHETIC',
  corpName: '합성 테스트',
  grade: 'BUY',
  buyScore: 72,
  createdAt: '2026-10-13T09:00:00.000Z',
  riskFlags: [],
  entryConditions: [{ id: 'entry', label: '조건', required: true, met: true }],
  referencePrice: {
    tradeDate: '20261013',
    closePrice: 10_000,
    highPrice: 10_100,
    lowPrice: 9_900,
    source: 'STOCK_DAILY_PRICE',
  },
};
const decision: DeviceEditionDecision = {
  decisions: [],
  readyCount: 0,
  checkCount: 0,
  riskCount: 0,
  unavailableCount: 0,
  headline: '합성 평가 결과',
  description: '테스트',
};

describe('useDeviceRuleDecision', () => {
  let client: QueryClient;
  let listener: (state: AppStateStatus) => void;
  const refetch = jest.fn().mockResolvedValue({});
  let controlResult: {
    data?: { asOf: string; killSwitch?: unknown };
    dataUpdatedAt: number;
    isError: boolean;
    error?: unknown;
    refetch: typeof refetch;
  };

  beforeEach(() => {
    jest.useFakeTimers({ doNotFake: ['queueMicrotask', 'nextTick'] });
    jest.setSystemTime(NOW);
    mockAuthenticated = true;
    mockGuest = false;
    Object.defineProperty(AppState, 'currentState', {
      configurable: true,
      value: 'active',
      writable: true,
    });
    jest.spyOn(AppState, 'addEventListener').mockImplementation((_event, callback) => {
      listener = callback;
      return { remove: jest.fn() };
    });
    client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
    controlResult = {
      data: { asOf: new Date(NOW).toISOString(), killSwitch: null },
      dataUpdatedAt: NOW,
      isError: false,
      refetch,
    };
    mockControls.mockImplementation(() => controlResult);
    mockEvaluate.mockResolvedValue(decision);
    mockSave.mockResolvedValue(undefined);
  });

  afterEach(async () => {
    await waitFor(() => expect(client.isFetching()).toBe(0));
    await cleanupAsync();
    client.clear();
    jest.clearAllTimers();
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  function wrapper({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  }

  async function flush() {
    await act(async () => {
      await Promise.resolve();
      jest.advanceTimersByTime(1);
    });
  }

  it('수신 시각이 직전 tick보다 늦어도 정상 통제 응답을 즉시 사용한다', async () => {
    controlResult.data = { asOf: new Date(NOW + 2_000).toISOString(), killSwitch: null };
    controlResult.dataUpdatedAt = NOW + 2_100;
    renderHook(() => useDeviceRuleDecision('20261013', [signal]), { wrapper });
    await waitFor(() => expect(mockEvaluate).toHaveBeenCalled());
    expect(mockEvaluate).toHaveBeenLastCalledWith([signal], '20261013', {
      scope: 'CURRENT',
      evaluatedAt: new Date(NOW + 2_100).toISOString(),
      killSwitchState: 'CLEAR',
    });
  });

  it.each([
    { data: undefined, isError: false },
    { data: { asOf: new Date(NOW).toISOString() }, isError: false },
    { data: { asOf: 'invalid', killSwitch: null }, isError: false },
    { data: { asOf: new Date(NOW - 60_001).toISOString(), killSwitch: null }, isError: false },
    { data: { asOf: new Date(NOW).toISOString(), killSwitch: null }, isError: true },
  ])('누락·오류·기한 초과 통제 응답은 UNKNOWN: %p', async (override) => {
    controlResult = { ...controlResult, ...override };
    renderHook(() => useDeviceRuleDecision('20261013', [signal]), { wrapper });
    await waitFor(() => expect(mockEvaluate).toHaveBeenCalled());
    expect(mockEvaluate.mock.calls.at(-1)?.[2]?.killSwitchState).toBe('UNKNOWN');
  });

  it('Kill 해제 요청 영수증을 해제 완료로 해석하지 않는다', async () => {
    controlResult.data!.killSwitch = { command: 'DEACTIVATE_REQUEST' };
    renderHook(() => useDeviceRuleDecision('20261013', [signal]), { wrapper });
    await waitFor(() => expect(mockEvaluate).toHaveBeenCalled());
    expect(mockEvaluate.mock.calls.at(-1)?.[2]?.killSwitchState).toBe('ACTIVE');
  });

  it.each([
    [401, '로그인이 만료'],
    [403, '통제 상태 조회 권한이 없어요'],
    [503, '네트워크 연결과 운영 상태'],
  ])('HTTP %s의 실제 원인을 알리고 통제 차단은 유지한다', async (status, expected) => {
    controlResult.isError = true;
    controlResult.error = { response: { status } };
    const { result } = renderHook(() => useDeviceRuleDecision('20261013', [signal]), { wrapper });
    await waitFor(() => expect(mockEvaluate).toHaveBeenCalled());
    expect(result.current.controlNotice).toContain(expected);
    expect(mockEvaluate.mock.calls.at(-1)?.[2]?.killSwitchState).toBe('UNKNOWN');
  });

  it('네트워크 오류 메시지의 403 문구를 HTTP 권한 오류로 오인하지 않는다', async () => {
    controlResult.isError = true;
    controlResult.error = { message: '403 in text only', statusCode: 403 };
    const { result } = renderHook(() => useDeviceRuleDecision('20261013', [signal]), { wrapper });
    await flush();
    expect(result.current.controlNotice).toContain('네트워크 연결과 운영 상태');
    expect(result.current.controlNotice).not.toContain('권한');
  });

  it('로그인하지 않은 현재 평가에는 로그인 안내만 보여준다', async () => {
    mockAuthenticated = false;
    controlResult.isError = true;
    controlResult.error = { response: { status: 403 } };
    const { result } = renderHook(() => useDeviceRuleDecision('20261013', [signal]), { wrapper });
    await flush();
    expect(result.current.controlNotice).toContain('로그인 후 통제 상태');
    expect(mockControls).toHaveBeenLastCalledWith(false);
  });

  it('과거 에디션에는 현재 통제 권한 오류를 표시하지 않는다', async () => {
    controlResult.isError = true;
    controlResult.error = { response: { status: 403 } };
    const { result } = renderHook(() => useDeviceRuleDecision('20261012', [signal]), { wrapper });
    await flush();
    expect(result.current.controlNotice).toBeUndefined();
  });

  it('최신 정상 통제 응답에는 차단 안내가 없다', async () => {
    const { result } = renderHook(() => useDeviceRuleDecision('20261013', [signal]), { wrapper });
    await flush();
    expect(result.current.controlNotice).toBeUndefined();
  });

  it.each([false, true])(
    '비로그인 또는 guest=%s 상태에서는 캐시가 있어도 CLEAR가 되지 않는다',
    async (guest) => {
      mockAuthenticated = guest;
      mockGuest = guest;
      renderHook(() => useDeviceRuleDecision('20261013', [signal]), { wrapper });
      await waitFor(() => expect(mockEvaluate).toHaveBeenCalled());
      expect(mockControls).toHaveBeenLastCalledWith(false);
      expect(mockEvaluate.mock.calls.at(-1)?.[2]?.killSwitchState).toBe('UNKNOWN');
    },
  );

  it('foreground minute마다 통제를 재조회하고 오래된 응답은 즉시 UNKNOWN 처리한다', async () => {
    renderHook(() => useDeviceRuleDecision('20261013', [signal]), { wrapper });
    await flush();
    await act(async () => {
      jest.advanceTimersByTime(60_001);
    });
    expect(refetch).toHaveBeenCalledTimes(1);
    await act(async () => {
      jest.advanceTimersByTime(60_000);
    });
    expect(mockEvaluate.mock.calls.at(-1)?.[2]?.killSwitchState).toBe('UNKNOWN');
  });

  it('background에서는 폴링하지 않고 resume 때 시각과 통제를 새로 확인한다', async () => {
    renderHook(() => useDeviceRuleDecision('20261013', [signal]), { wrapper });
    await flush();
    act(() => {
      AppState.currentState = 'background';
      listener('background');
    });
    await act(async () => {
      jest.advanceTimersByTime(120_000);
    });
    expect(refetch).not.toHaveBeenCalled();
    act(() => {
      AppState.currentState = 'active';
      listener('active');
    });
    await flush();
    expect(refetch).toHaveBeenCalledTimes(1);
    expect(mockEvaluate.mock.calls.at(-1)?.[2]?.killSwitchState).toBe('UNKNOWN');
  });

  it('정정된 조건 문구·가격 출처·만료시각은 이전 평가 캐시를 재사용하지 않는다', async () => {
    const { rerender } = renderHook<
      ReturnType<typeof useDeviceRuleDecision>,
      { input: TradingSignal }
    >(({ input }) => useDeviceRuleDecision('20261012', [input]), {
      wrapper,
      initialProps: { input: signal },
    });
    await flush();
    const initialCount = mockEvaluate.mock.calls.length;
    const corrected = {
      ...signal,
      expiresAt: '2026-10-14T00:00:00.000Z',
      summary: '정정 공시',
      entryConditions: [{ ...signal.entryConditions[0], label: '정정된 조건' }],
      referencePrice: { ...signal.referencePrice!, source: 'CORRECTED_SOURCE' as never },
    };
    rerender({ input: corrected });
    await flush();
    expect(mockEvaluate).toHaveBeenCalledTimes(initialCount + 1);
    expect(mockEvaluate).toHaveBeenLastCalledWith([corrected], '20261012', undefined);
    rerender({ input: { ...corrected } });
    await flush();
    expect(mockEvaluate).toHaveBeenCalledTimes(initialCount + 1);
  });

  it('KST 자정 후 같은 에디션은 과거 재현으로 전환한다', async () => {
    jest.setSystemTime(new Date('2026-10-13T14:59:30.000Z'));
    renderHook(() => useDeviceRuleDecision('20261013', [signal]), { wrapper });
    await flush();
    await act(async () => {
      jest.advanceTimersByTime(60_000);
    });
    await flush();
    expect(mockEvaluate).toHaveBeenLastCalledWith([signal], '20261013', undefined);
    expect(mockControls).toHaveBeenLastCalledWith(false);
  });

  it('과거 평가에는 통제 조회나 매분 재평가를 추가하지 않는다', async () => {
    renderHook(() => useDeviceRuleDecision('20261012', [signal]), { wrapper });
    await flush();
    const count = mockEvaluate.mock.calls.length;
    await act(async () => {
      jest.advanceTimersByTime(120_000);
    });
    expect(refetch).not.toHaveBeenCalled();
    expect(mockEvaluate).toHaveBeenCalledTimes(count);
    expect(mockEvaluate).toHaveBeenLastCalledWith([signal], '20261012', undefined);
  });

  it('로컬 영수증 저장 실패는 평가 결과를 숨기지 않는다', async () => {
    mockSave.mockRejectedValue(new Error('synthetic storage failure'));
    const { result } = renderHook(() => useDeviceRuleDecision('20261012', [signal]), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toBe(decision);
    expect(mockSave).toHaveBeenCalled();
  });
});
