import { useCallback, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useFocusEffect } from 'expo-router';
import { graduationService } from '@services/graduation.service';

// 졸업 게이트 측정 준실시간 폴링 훅 — DAR-67.
// 서버 일일 사이클이 갱신하는 누적 졸업지표를 홈 졸업 트래커에 자동 반영(준실시간).
// queryKey ['graduation-metrics'] — 캐시 무효화 단일 키. 백그라운드 폴링 중단(배터리/네트워크 절약).
// UXR-23/P-3: expo-router 탭은 방문 후 언마운트되지 않아 refetchInterval 이 다른 탭/스택
// 체류 중에도 세션 내내 돌았다 → 소비 화면(홈 탭)이 실제 포커스일 때만 구독·폴링한다
// (useFocusEffect 게이트 — company 상세 시세 폴링과 동일 idiom). 포커스 복귀 시
// 재구독되어 stale(>30s)이면 즉시 1회 재조회 후 45s 폴링을 재개한다.
const REFETCH_INTERVAL_MS = 45 * 1000;

export function useGraduationMetrics() {
  // 훅 내부 포커스 게이트 — 소비 컴포넌트가 속한 화면의 포커스를 추적한다.
  const [isFocused, setIsFocused] = useState(false);
  useFocusEffect(
    useCallback(() => {
      setIsFocused(true);
      return () => setIsFocused(false);
    }, []),
  );

  return useQuery({
    queryKey: ['graduation-metrics'],
    queryFn: () => graduationService.getMetrics(),
    refetchInterval: isFocused ? REFETCH_INTERVAL_MS : false,
    refetchIntervalInBackground: false,
    staleTime: 30 * 1000,
    retry: 1,
    // 비포커스 동안 관찰 자체를 끊어 interval 외 refetch(포그라운드 복귀 등)도 차단.
    subscribed: isFocused,
  });
}
