import { useEffect, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';

import {
  loadDeviceEditionReceipt,
  saveDeviceEditionReceipt,
} from '@services/deviceDecisionCache.service';
import { evaluateEditionOnDevice } from '@utils/deviceRuleDecision';

import type { TradingSignal } from '@app-types/signal.types';

function inputSignature(signals: readonly TradingSignal[]): string {
  return signals
    .map((signal) =>
      [
        signal.id,
        signal.buyScore,
        signal.grade,
        signal.referencePrice?.tradeDate ?? 'NO_PRICE',
        signal.referencePrice?.closePrice ?? 'NO_PRICE',
        signal.riskFlags.map((flag) => flag.id).join(','),
        signal.entryConditions
          .filter((condition) => condition.required)
          .map((condition) => `${condition.id}:${condition.met ? 1 : 0}`)
          .join(','),
      ].join(':'),
    )
    .join('|');
}

/** 네트워크/DB 호출 없이 현재 앱 프로세스에서 공용 Rule Evaluator를 실행한다. */
export function useDeviceRuleDecision(
  editionDate: string | undefined,
  signals: readonly TradingSignal[],
) {
  const signature = useMemo(() => inputSignature(signals), [signals]);
  const query = useQuery({
    queryKey: ['signals', 'device-rule-decision', editionDate, signature],
    queryFn: () => evaluateEditionOnDevice(signals, editionDate!),
    enabled: !!editionDate && signals.length > 0,
    staleTime: Infinity,
    gcTime: 24 * 60 * 60 * 1000,
    retry: false,
  });

  useEffect(() => {
    if (!editionDate || !query.data) return;
    void saveDeviceEditionReceipt(editionDate, query.data);
  }, [editionDate, query.data]);

  return query;
}

/** 오프라인 재시작 시에도 마지막 receipt hash/version만 확인할 수 있는 경량 캐시. */
export function useLastDeviceEditionReceipt(editionDate: string | undefined) {
  return useQuery({
    queryKey: ['signals', 'device-rule-receipt-cache', editionDate],
    queryFn: () => loadDeviceEditionReceipt(editionDate!),
    enabled: !!editionDate,
    staleTime: Infinity,
    retry: false,
  });
}
