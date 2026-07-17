import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { ColdStartOnboarding } from '@components/home/ColdStartOnboarding';
import { WATCHLIST_KEY } from '@hooks/useWatchlist';
import { watchlistService } from '@services/watchlist.service';
import { companyService } from '@services/company.service';

// 콜드스타트 온보딩 e2e(수용기준 1, DAR-537): 관심 0 → 추천 선택 → 등록 → 관심 캐시 반영.
// 캐시 meta.total > 0 이 되는 순간 홈의 파생 기본 탭(hasWatchlist → 'watchlist')이 관심 피드로
// 전환된다(app/(tabs)/home/index.tsx UXR-10(A-4) 파생 로직) — 여기서는 그 입력(캐시 반영)까지 검증.

jest.mock('@services/company.service', () => ({
  companyService: {
    getPopular: jest.fn(),
    search: jest.fn(),
    getByCorpCode: jest.fn(),
  },
}));

jest.mock('@services/watchlist.service', () => ({
  watchlistService: {
    getList: jest.fn(),
    add: jest.fn(),
    remove: jest.fn(),
    markViewed: jest.fn(),
  },
}));

// 오프라인 쓰기 가드(useGuardedMutation → useNetInfo)는 온라인으로 고정한다.
jest.mock('@react-native-community/netinfo', () => ({
  useNetInfo: () => ({ isConnected: true, isInternetReachable: true }),
}));

const POPULAR = [
  { corpCode: 'P1', corpName: '삼성전자', stockCode: '005930', market: 'KOSPI' },
  { corpCode: 'P2', corpName: 'SK하이닉스', stockCode: '000660', market: 'KOSPI' },
  { corpCode: 'P3', corpName: '현대차', stockCode: '005380', market: 'KOSPI' },
];

// P1(삼성전자)은 인기 풀과 중복 — 칩은 1회만 렌더돼야 한다(중복 유도 금지의 데이터판).
const ACTIVE = [
  { corpCode: 'P1', corpName: '삼성전자' },
  { corpCode: 'A1', corpName: '카카오' },
];

function renderCard(props?: Partial<React.ComponentProps<typeof ColdStartOnboarding>>) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  // 콜드스타트 전제: 관심기업 0 (홈 노출 게이트 watchlistCount === 0 과 동일 상태)
  queryClient.setQueryData(WATCHLIST_KEY, { data: [], meta: { total: 0 } });
  const onSearch = jest.fn();
  const onSkip = jest.fn();
  const onComplete = jest.fn();
  const utils = render(
    <QueryClientProvider client={queryClient}>
      <ColdStartOnboarding
        activeCompanies={ACTIVE}
        onSearch={onSearch}
        onSkip={onSkip}
        onComplete={onComplete}
        {...props}
      />
    </QueryClientProvider>,
  );
  return { ...utils, queryClient, onSearch, onSkip, onComplete };
}

describe('components/home/ColdStartOnboarding', () => {
  beforeEach(() => {
    (companyService.getPopular as jest.Mock).mockResolvedValue(POPULAR);
    (watchlistService.getList as jest.Mock).mockResolvedValue({ data: [], meta: { total: 0 } });
    (watchlistService.add as jest.Mock).mockImplementation((corpCode: string, corpName: string) =>
      Promise.resolve({
        id: `id-${corpCode}`,
        userId: 'u1',
        corpCode,
        corpName,
        stockCode: null,
        market: null,
        lastDisclosureDate: null,
        newDisclosureCount: 0,
        createdAt: '2026-07-17T00:00:00.000Z',
      }),
    );
  });

  it('인기+활발 추천을 중복 없이 렌더한다(동일 corpCode 칩 1회)', async () => {
    const { findByText, getAllByText, getByText } = renderCard();

    await findByText('SK하이닉스');
    expect(getAllByText('삼성전자')).toHaveLength(1); // 인기·활발 중복 → 1회
    expect(getByText('카카오')).toBeTruthy(); // 활발 풀 유입
  });

  it('관심 0 → 3개 선택 → 등록: add 3회 호출·관심 캐시 total 3 반영·onComplete(해제) 호출', async () => {
    const { findByText, getByText, queryClient, onComplete } = renderCard();

    fireEvent.press(await findByText('삼성전자'));
    fireEvent.press(getByText('SK하이닉스'));
    fireEvent.press(getByText('현대차'));

    fireEvent.press(getByText('3개 등록하기'));

    await waitFor(() => expect(onComplete).toHaveBeenCalledTimes(1));
    expect(watchlistService.add).toHaveBeenCalledTimes(3);
    expect(watchlistService.add).toHaveBeenCalledWith('P1', '삼성전자');
    expect(watchlistService.add).toHaveBeenCalledWith('P2', 'SK하이닉스');
    expect(watchlistService.add).toHaveBeenCalledWith('P3', '현대차');

    // 피드 반영의 입력: 관심 캐시 total 0 → 3 (홈 파생 탭이 'watchlist' 로 전환되는 조건)
    const cache = queryClient.getQueryData<{ data: unknown[]; meta: { total: number } }>(
      WATCHLIST_KEY,
    );
    expect(cache?.meta.total).toBe(3);
    expect(cache?.data).toHaveLength(3);
  });

  it('선택 0개면 등록 CTA 대신 비강요 안내를 노출한다(강요 금지)', async () => {
    const { findByText, queryByText } = renderCard();

    await findByText('삼성전자');
    expect(queryByText(/개 등록하기/)).toBeNull();
    expect(await findByText('지금 선택하지 않아도 언제든 추가할 수 있어요')).toBeTruthy();
  });

  it('건너뛰기 탭 → onSkip 만 호출(등록 없음)', async () => {
    const { findByLabelText, onSkip } = renderCard();

    fireEvent.press(await findByLabelText('온보딩 건너뛰기'));
    expect(onSkip).toHaveBeenCalledTimes(1);
    expect(watchlistService.add).not.toHaveBeenCalled();
  });

  it('직접 검색 링크 → onSearch 호출(검색 연결)', async () => {
    const { findByLabelText, onSearch } = renderCard();

    fireEvent.press(await findByLabelText('기업 직접 검색'));
    expect(onSearch).toHaveBeenCalledTimes(1);
  });

  it('추천 풀이 모두 비면 검색 폴백 안내를 노출한다(온보딩 비차단)', async () => {
    (companyService.getPopular as jest.Mock).mockResolvedValue([]);
    const { findByText } = renderCard({ activeCompanies: [] });

    expect(
      await findByText('추천 종목을 불러오지 못했어요. 아래 검색으로 직접 추가할 수 있어요.'),
    ).toBeTruthy();
  });

  it('일부 등록 실패 시에도 성공분은 반영하고 onComplete 를 호출한다(allSettled 규약)', async () => {
    (watchlistService.add as jest.Mock).mockImplementation((corpCode: string, corpName: string) =>
      corpCode === 'P2'
        ? Promise.reject(new Error('server error'))
        : Promise.resolve({
            id: `id-${corpCode}`,
            userId: 'u1',
            corpCode,
            corpName,
            stockCode: null,
            market: null,
            lastDisclosureDate: null,
            newDisclosureCount: 0,
            createdAt: '2026-07-17T00:00:00.000Z',
          }),
    );
    const { findByText, getByText, onComplete } = renderCard();

    fireEvent.press(await findByText('삼성전자'));
    fireEvent.press(getByText('SK하이닉스'));
    fireEvent.press(getByText('2개 등록하기'));

    await waitFor(() => expect(onComplete).toHaveBeenCalledTimes(1));
    expect(watchlistService.add).toHaveBeenCalledTimes(2);
  });
});
