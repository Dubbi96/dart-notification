import { useQuery } from '@tanstack/react-query';
import { investorFlowService } from '@services/investor-flow.service';

import type { InvestorFlowResult, ShortSellingResult } from '@app-types/investor-flow.types';

/**
 * 수급(투자자별 매매동향)·공매도 조회 훅 (갭분석 W16) — 종목 차트 '수급 요약' 카드 연결.
 * 데이터는 EOD(장 마감 후 확정)라 폴링하지 않는다 — staleTime 을 넉넉히(30분) 잡아
 * 화면 재방문 시 불필요 재조회를 억제한다(useDailyCandles 규약과 일관).
 */

interface UseInvestorFlowOptions {
  /** 호출 자체를 막을 때 false(기본 true). 코드가 6자리가 아니면 자동 비활성. */
  enabled?: boolean;
  /** 조회 거래일 수(기본 20 — 20일 누적 요약 확보). */
  days?: number;
}

const EOD_STALE_TIME_MS = 30 * 60 * 1000;

/** 종목 투자자별 매매동향(외국인/기관/개인 순매수 + 5/20일 누적 요약). */
export function useInvestorFlow(
  stockCode: string | null | undefined,
  options?: UseInvestorFlowOptions,
) {
  const code = (stockCode ?? '').trim();
  const valid = /^\d{6}$/.test(code);
  const days = options?.days ?? 20;

  return useQuery<InvestorFlowResult>({
    queryKey: ['investor-flow', code, days],
    queryFn: () => investorFlowService.getInvestorFlow(code, days),
    enabled: valid && (options?.enabled ?? true),
    staleTime: EOD_STALE_TIME_MS,
  });
}

/** 종목 공매도 일별(거래량·거래비중·잔고비율 — 잔고 미가용 시 null). */
export function useShortSelling(
  stockCode: string | null | undefined,
  options?: UseInvestorFlowOptions,
) {
  const code = (stockCode ?? '').trim();
  const valid = /^\d{6}$/.test(code);
  const days = options?.days ?? 20;

  return useQuery<ShortSellingResult>({
    queryKey: ['short-selling', code, days],
    queryFn: () => investorFlowService.getShortSelling(code, days),
    enabled: valid && (options?.enabled ?? true),
    staleTime: EOD_STALE_TIME_MS,
  });
}
