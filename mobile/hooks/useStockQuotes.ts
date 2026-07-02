import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { marketQuoteService } from '@services/market-quote.service';

import type { StockQuoteMap } from '@app-types/market-quote.types';

/** useStockQuotes 옵션(DAR-353). */
export interface UseStockQuotesOptions {
  /**
   * 자동 폴링 간격(ms). 기본 미설정(false=폴링 없음) — 종전 동작 유지.
   * 호출부가 화면 포커스 + 장중에만 켠다(배터리·비용 배려, 백그라운드 폴링은 비활성).
   * 백엔드 quote 는 실시간 우선이라 폴링 시 현재가가 갱신된다.
   * UXR-6/P-8: 함수형이면 React Query 가 매 폴링 틱·렌더마다 재평가한다 — 장 개장/마감
   * 경계를 렌더 시점 정적 값 없이 스스로 재판정한다(useMinuteCandles 패턴과 일관).
   */
  refetchInterval?: number | false | (() => number | false);
}

/**
 * 다건 종목 최신 시세 조회 훅 (DAR-158). 워치리스트·신호·종목 상세의 가격 배지/헤더에 연결한다.
 * 6자리 코드만 정규화·중복 제거·정렬해 안정적 queryKey 를 만든다(동일 종목셋 캐시 공유).
 * queryKey: ['stock-quotes', sortedCodesCsv]
 * DAR-353: 옵션 refetchInterval 로 라이브 자동갱신을 켤 수 있다(기본 off).
 */
export function useStockQuotes(
  stockCodes: Array<string | null | undefined>,
  options?: UseStockQuotesOptions,
) {
  const codes = useMemo(() => {
    const set = new Set<string>();
    for (const c of stockCodes) {
      const t = (c ?? '').trim();
      if (/^\d{6}$/.test(t)) set.add(t);
    }
    return Array.from(set).sort();
  }, [stockCodes]);

  const refetchInterval = options?.refetchInterval ?? false;

  const query = useQuery<StockQuoteMap>({
    queryKey: ['stock-quotes', codes.join(',')],
    queryFn: () => marketQuoteService.getQuotes(codes),
    enabled: codes.length > 0,
    // 일봉은 EOD 1회, 실시간 캐시는 분 단위. 화면 배지는 1분 신선이면 충분.
    staleTime: 60 * 1000,
    // DAR-353: 켜지면 간격마다 재요청(라이브 현재가). 백그라운드(앱 비활성)에선 폴링 중단.
    refetchInterval,
    refetchIntervalInBackground: false,
  });

  return { quotes: query.data ?? {}, ...query };
}
