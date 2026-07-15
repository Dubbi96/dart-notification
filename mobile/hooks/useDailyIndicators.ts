import { useQuery } from '@tanstack/react-query';
import { marketQuoteService } from '@services/market-quote.service';
import { DAILY_RANGE_LIMITS, DEFAULT_DAILY_RANGE, type DailyRangePreset } from './useDailyCandles';

import type { IndicatorSeriesResult } from '@app-types/market-quote.types';

interface UseDailyIndicatorsOptions {
  /** 호출 자체를 막을 때 false(기본 true). 코드가 없거나 6자리가 아니면 자동 비활성. */
  enabled?: boolean;
  /** 구간 프리셋(기본 1Y) — 일봉(useDailyCandles)과 동일 limit 환산으로 tradeDate 조인 정합. */
  range?: DailyRangePreset;
}

/**
 * 단일 종목 기술지표(EOD 파생) 조회 훅 (W13 데이터 자산 표면 개방).
 * 백엔드 GET /market-data/indicators → TechnicalIndicator(MA/RSI/MACD/볼린저 등) — 일봉 차트
 * MA20/MA60·볼린저 오버레이 데이터. 일봉과 동일 구간 프리셋 limit 을 써서 캔들과 조인한다.
 * 지표는 EOD 파생(장 마감 후 확정)이라 폴링하지 않는다(useDailyCandles 와 동일 계약).
 * ★정직: latestTradeDate(지표 기준일)를 그대로 노출 — 화면이 T+1 stale 배지를 반드시 병기.
 */
export function useDailyIndicators(
  stockCode: string | null | undefined,
  options?: UseDailyIndicatorsOptions,
) {
  const code = (stockCode ?? '').trim();
  const valid = /^\d{6}$/.test(code);
  const range = options?.range ?? DEFAULT_DAILY_RANGE;
  const limit = DAILY_RANGE_LIMITS[range];

  const query = useQuery<IndicatorSeriesResult>({
    queryKey: ['daily-indicators', code, range],
    queryFn: () => marketQuoteService.getDailyIndicators(code, { limit }),
    enabled: valid && (options?.enabled ?? true),
    // EOD 파생 지표 — 5분 신선이면 충분(불필요 재조회 억제, 일봉과 동일).
    staleTime: 5 * 60 * 1000,
  });

  const result = query.data;
  return {
    result,
    points: result?.points ?? [],
    source: result?.source,
    // ★지표 기준일(YYYYMMDD) — stale 정직 고지 배지용. 미가용 시 null.
    latestTradeDate: result?.latestTradeDate ?? null,
    asOf: result?.asOf ?? '',
    ...query,
  };
}
