import { useQuery } from '@tanstack/react-query';
import { marketQuoteService } from '@services/market-quote.service';

import type { MinuteCandle } from '@app-types/market-quote.types';

/**
 * KRX 정규장(평일 09:00–15:30 KST)이 열려 있는지 — 장중 폴링 게이트용 (DAR-354).
 * 디바이스 시계(now)를 KST 벽시계로 환산(UTC+9)해 판정한다. 환경 시계가 실제와 어긋나면
 * 폴링 캐던스도 함께 어긋나므로, 표시 레이어에서 환경시계 괴리를 별도 고지한다.
 */
function isKrxMarketOpen(now: Date): boolean {
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  const day = kst.getUTCDay(); // 0 일 ~ 6 토 (KST 기준)
  if (day === 0 || day === 6) return false;
  const minutes = kst.getUTCHours() * 60 + kst.getUTCMinutes();
  return minutes >= 9 * 60 && minutes <= 15 * 60 + 30;
}

interface UseMinuteCandlesOptions {
  /** 호출 자체를 막을 때 false(기본 true). 코드가 없거나 6자리가 아니면 자동으로 비활성. */
  enabled?: boolean;
  /** 장중일 때만 1분 주기 폴링(기본 false). 장 마감/주말이면 폴링하지 않는다. */
  pollWhileMarketOpen?: boolean;
}

/**
 * 단일 종목 당일 분봉 조회 훅 (DAR-354). company 상세 인트라데이 차트에 연결.
 * 6자리 코드만 정규화해 안정적 queryKey 를 만든다(['minute-candles', code]).
 * 장중 폴링 옵션을 켜면 KRX 정규장 시간에만 1분 주기로 재조회한다(장외/주말 폴링 0).
 */
export function useMinuteCandles(
  stockCode: string | null | undefined,
  options?: UseMinuteCandlesOptions,
) {
  const code = (stockCode ?? '').trim();
  const valid = /^\d{6}$/.test(code);
  const pollWhileMarketOpen = options?.pollWhileMarketOpen ?? false;

  const query = useQuery<MinuteCandle[]>({
    queryKey: ['minute-candles', code],
    queryFn: () => marketQuoteService.getMinuteCandles(code),
    enabled: valid && (options?.enabled ?? true),
    // 분봉은 1분 캔들 — 1분 신선이면 충분. 장중 폴링과 일관.
    staleTime: 60 * 1000,
    // 장중에만 폴링(refetchInterval 함수가 매 틱 장개장 여부 재판정). 장외/주말이면 false.
    refetchInterval: pollWhileMarketOpen
      ? () => (isKrxMarketOpen(new Date()) ? 60 * 1000 : false)
      : false,
  });

  return { candles: query.data ?? [], ...query };
}
