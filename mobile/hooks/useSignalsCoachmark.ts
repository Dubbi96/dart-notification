import { useState, useEffect, useCallback } from 'react';
import * as SecureStore from 'expo-secure-store';

// 신호 탭 첫 진입 코치마크 1회성 상태 훅 — W1 잔여(6/27 UI/UX 감사).
// dismiss(닫기) 후에는 다시 노출하지 않는다.
// useFirstWatchCoachmark 와 동일한 SecureStore 단일키 패턴(키만 교체).
const KEY = 'signalsCoachDismissed';

export function useSignalsCoachmark() {
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
