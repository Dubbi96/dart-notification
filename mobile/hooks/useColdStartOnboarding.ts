import { useState, useEffect, useCallback } from 'react';
import * as SecureStore from 'expo-secure-store';

// 콜드스타트 온보딩 1회성 상태 훅 — DAR-537.
// 홈의 첫 관심기업 온보딩 카드(FirstWatchCoachmark 승격형)의 노출/해제 상태.
// 건너뛰기 또는 등록 완료(1개 이상 성공) 후에는 다시 노출하지 않는다.
// useFirstWatchCoachmark(DAR-65)와 동일한 SecureStore 단일키 패턴 — 키가 서로 독립이라
// 이 카드를 건너뛰어도 기존 코치마크의 1회성 규약(firstWatchCoachDismissed)은 그대로 유지된다.
const KEY = 'coldStartOnboardingDismissed';

export function useColdStartOnboarding() {
  // null = 로딩(아직 미확인), false = 미해제(노출 가능), true = 해제(숨김)
  const [dismissed, setDismissed] = useState<boolean | null>(null);

  useEffect(() => {
    let active = true;
    SecureStore.getItemAsync(KEY)
      .then((v) => {
        if (active) setDismissed(v === 'true');
      })
      .catch(() => {
        if (active) setDismissed(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const dismiss = useCallback(() => {
    setDismissed(true); // 낙관적 즉시 숨김
    SecureStore.setItemAsync(KEY, 'true').catch(() => {
      // 영속화 실패해도 이번 세션 노출은 막는다(비차단).
    });
  }, []);

  return { dismissed, dismiss };
}
