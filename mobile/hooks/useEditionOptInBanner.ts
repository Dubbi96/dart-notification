import { useState, useEffect, useCallback } from 'react';
import * as SecureStore from 'expo-secure-store';

// DAR-547: 신호탭 에디션 옵트인 배너 1회성 dismiss 상태 훅.
// 닫기(X) 또는 인라인 켜기('알림 받기') 후에는 다시 노출하지 않는다(재강요 금지·1회성 규약).
// useSignalsCoachmark 와 동일한 SecureStore 단일키 패턴(키만 교체) — Expo Go 제약상 보안저장소만 사용.
const KEY = 'editionOptInBannerDismissed';

export function useEditionOptInBanner() {
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
