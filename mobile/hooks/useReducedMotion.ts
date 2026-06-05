import { useEffect, useState } from 'react';
import { AccessibilityInfo } from 'react-native';

// 접근성 '동작 줄이기'(reduce motion) 감지(기획 §11 모션 폴백 의무).
// RN 내장 AccessibilityInfo만 사용 — Expo Go 호환, reanimated 의존 없음.
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    let mounted = true;
    AccessibilityInfo.isReduceMotionEnabled().then((enabled) => {
      if (mounted) setReduced(enabled);
    });
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduced);
    return () => {
      mounted = false;
      sub.remove();
    };
  }, []);

  return reduced;
}
