import { useEffect, useMemo, useState } from 'react';
import { AppState } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import {
  loadDeviceEditionReceipt,
  saveDeviceEditionReceipt,
} from '@services/deviceDecisionCache.service';
import { evaluateEditionOnDevice } from '@utils/deviceRuleDecision';
import { kstEditionDate } from '@utils/signalTerms';
import { useAosMobileControl } from '@hooks/useAosMobileControl';
import { useAuthStore } from '@stores/authStore';

import type { TradingSignal } from '@app-types/signal.types';

function inputSignature(signals: readonly TradingSignal[]): string {
  // source/createdAt/조건 문구도 계산 및 설명의 입력이다. 일부 필드만 키에 넣으면
  // 서버가 정정한 근거를 이전 receipt와 함께 표시할 수 있다.
  return JSON.stringify(signals);
}

/** 계산은 기기에서 실행하고, 현재 평가의 통제 상태만 인증된 read-only API로 확인한다. */
export function useDeviceRuleDecision(
  editionDate: string | undefined,
  signals: readonly TradingSignal[],
) {
  const [now, setNow] = useState(() => Date.now());
  const [foreground, setForeground] = useState(() => AppState.currentState === 'active');
  const authenticated = useAuthStore((state) => state.isAuthenticated && !state.isGuest);
  const historical = !!editionDate && editionDate < kstEditionDate(now);
  const controlsEnabled =
    authenticated && foreground && !!editionDate && !historical && signals.length > 0;
  const controls = useAosMobileControl(controlsEnabled);
  const refreshControls = controls.refetch;
  useEffect(() => {
    // 앱 foreground에서만 만료 여부를 재평가한다. 백그라운드 상시 실행이 아니다.
    const tick = () => {
      if (AppState.currentState !== 'active') return;
      setNow(Date.now());
      if (controlsEnabled) void refreshControls();
    };
    const interval = setInterval(tick, 60_000);
    const subscription = AppState.addEventListener('change', (state) => {
      setForeground(state === 'active');
      if (state === 'active') {
        setNow(Date.now());
        if (authenticated && !!editionDate && !historical && signals.length > 0)
          void refreshControls();
      }
    });
    return () => {
      clearInterval(interval);
      subscription.remove();
    };
  }, [authenticated, controlsEnabled, editionDate, historical, refreshControls, signals.length]);
  // 응답은 직전 minute tick보다 늦게 도착할 수 있다. 실제 로컬 수신시각을 포함해
  // 방금 받은 정상 응답을 최대 1분간 '미래 응답'으로 오인하지 않게 한다.
  const evaluationTime = Math.max(now, controls.dataUpdatedAt || 0);
  const controlAge = evaluationTime - Date.parse(controls.data?.asOf ?? '');
  const controlFresh =
    controlsEnabled && !controls.isError && controlAge >= 0 && controlAge <= 60_000;
  const killSwitchState = !controlFresh
    ? 'UNKNOWN'
    : controls.data?.killSwitch === null
      ? 'CLEAR'
      : controls.data?.killSwitch
        ? 'ACTIVE'
        : 'UNKNOWN';
  // Axios 응답의 실제 HTTP status만 사용한다. 서버 문구나 임의 statusCode를 권한으로 해석하지 않는다.
  const controlStatus = (controls.error as { response?: { status?: number } } | null)?.response
    ?.status;
  const controlNotice =
    !editionDate || historical || signals.length === 0
      ? undefined
      : !authenticated
        ? '현재 진입 계획은 로그인 후 통제 상태를 확인해야 볼 수 있어요. 과거 판단과 모의 검증은 계속 이용할 수 있어요.'
        : controls.isError && controlStatus === 401
          ? '로그인이 만료되어 통제 상태를 확인할 수 없어요. 다시 로그인하기 전까지 현재 진입 계획을 보류해요.'
          : controls.isError && controlStatus === 403
            ? '현재 계정에는 통제 상태 조회 권한이 없어요. 관리자 권한 확인 전까지 현재 진입 계획을 보류해요.'
            : killSwitchState === 'UNKNOWN'
              ? '통제 상태를 확인하지 못해 현재 진입 계획을 보류했어요. 네트워크 연결과 운영 상태를 확인해 주세요.'
              : killSwitchState === 'ACTIVE'
                ? '진입 중단 통제가 확인되어 현재 진입 계획을 보류했어요. 통제 해제 요청만으로는 다시 진입하지 않아요.'
                : undefined;
  const signature = useMemo(() => inputSignature(signals), [signals]);
  const query = useQuery({
    queryKey: [
      'signals',
      'device-rule-decision-v2',
      editionDate,
      signature,
      historical ? 'HISTORICAL' : evaluationTime,
      historical ? null : killSwitchState,
    ],
    queryFn: () =>
      evaluateEditionOnDevice(
        signals,
        editionDate!,
        historical
          ? undefined
          : {
              evaluatedAt: new Date(evaluationTime).toISOString(),
              scope: 'CURRENT',
              killSwitchState,
            },
      ),
    enabled: !!editionDate && signals.length > 0,
    staleTime: Infinity,
    gcTime: 5 * 60 * 1000,
    retry: false,
  });

  useEffect(() => {
    if (!editionDate || !query.data) return;
    // 저장소 오류가 평가 결과를 무효화하거나 unhandled rejection을 만들지 않는다.
    void saveDeviceEditionReceipt(editionDate, query.data).catch(() => undefined);
  }, [editionDate, query.data]);

  return { ...query, controlNotice };
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
