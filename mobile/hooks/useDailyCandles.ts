import { useQuery } from '@tanstack/react-query';
import { marketQuoteService } from '@services/market-quote.service';

import type { CandleSeriesResult } from '@app-types/market-quote.types';

/**
 * 일봉 구간 프리셋(DAR-384) — 최근 N 거래일을 limit 으로 환산해 조회한다. 구간(from/to) 대신
 * limit-only 를 쓰는 이유: 백엔드가 newest-first 로 최근 N 거래일을 반환하므로 디바이스 환경 시계
 * 괴리에 무관하게 '최근 데이터'를 안정적으로 받는다(환경시계 의존 회피).
 * 한국 정규장 ≈ 연 245 거래일 기준 근사치(상한 1000=서버 MAX_CANDLE_LIMIT).
 */
export type DailyRangePreset = '3M' | '1Y' | 'ALL';

export const DAILY_RANGE_LIMITS: Record<DailyRangePreset, number> = {
  '3M': 66, // ≈ 3개월 거래일
  '1Y': 250, // ≈ 1년 거래일
  ALL: 1000, // 서버 페이지 상한(≈ 4년) — 더 깊으면 페이지네이션 별도
};

export const DEFAULT_DAILY_RANGE: DailyRangePreset = '1Y';

interface UseDailyCandlesOptions {
  /** 호출 자체를 막을 때 false(기본 true). 코드가 없거나 6자리가 아니면 자동 비활성. */
  enabled?: boolean;
  /** 구간 프리셋(기본 1Y). 최근 N 거래일 limit 으로 환산. */
  range?: DailyRangePreset;
}

/**
 * 단일 종목 일봉(딥히스토리) 조회 훅 (DAR-384). 전용 종목 차트(app/stock/[stockCode]) 일봉 탭 연결.
 * 백엔드 GET /market-data/candles?resolution=1d → KRX 일봉 StockDailyPrice(source=EOD) 캐노니컬.
 * 일봉은 EOD(장 마감 후 확정)라 폴링하지 않는다. range·code 로 안정적 queryKey 구성.
 */
export function useDailyCandles(
  stockCode: string | null | undefined,
  options?: UseDailyCandlesOptions,
) {
  const code = (stockCode ?? '').trim();
  const valid = /^\d{6}$/.test(code);
  const range = options?.range ?? DEFAULT_DAILY_RANGE;
  const limit = DAILY_RANGE_LIMITS[range];

  const query = useQuery<CandleSeriesResult>({
    queryKey: ['daily-candles', code, range],
    queryFn: () => marketQuoteService.getDailyCandles(code, { limit }),
    enabled: valid && (options?.enabled ?? true),
    // 일봉은 장 마감 후 확정 — 5분 신선이면 충분(불필요 재조회 억제).
    staleTime: 5 * 60 * 1000,
  });

  const result = query.data;
  return {
    result,
    candles: result?.candles ?? [],
    source: result?.source,
    // 서버 조회 시각(ISO) — 환경 시계 괴리 고지에 사용. 없으면 빈 문자열.
    asOf: result?.asOf ?? '',
    ...query,
  };
}
