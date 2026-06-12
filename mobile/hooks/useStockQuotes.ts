import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { marketQuoteService } from '@services/market-quote.service';

import type { StockQuoteMap } from '@app-types/market-quote.types';

/**
 * 다건 종목 최신 시세 조회 훅 (DAR-158). 워치리스트·신호·종목 상세의 가격 배지에 연결한다.
 * 6자리 코드만 정규화·중복 제거·정렬해 안정적 queryKey 를 만든다(동일 종목셋 캐시 공유).
 * queryKey: ['stock-quotes', sortedCodesCsv]
 */
export function useStockQuotes(stockCodes: Array<string | null | undefined>) {
  const codes = useMemo(() => {
    const set = new Set<string>();
    for (const c of stockCodes) {
      const t = (c ?? '').trim();
      if (/^\d{6}$/.test(t)) set.add(t);
    }
    return Array.from(set).sort();
  }, [stockCodes]);

  const query = useQuery<StockQuoteMap>({
    queryKey: ['stock-quotes', codes.join(',')],
    queryFn: () => marketQuoteService.getQuotes(codes),
    enabled: codes.length > 0,
    // 일봉은 EOD 1회, 실시간 캐시는 분 단위. 화면 배지는 1분 신선이면 충분.
    staleTime: 60 * 1000,
  });

  return { quotes: query.data ?? {}, ...query };
}
