import { useMemo } from 'react';
import { Platform } from 'react-native';
import * as Haptics from 'expo-haptics';

// 시맨틱 햅틱 래퍼(DAR-172).
// 호출부는 의미 레벨(light/medium/success/warning)만 사용하고
// ImpactFeedbackStyle/NotificationFeedbackType 같은 매직값은 노출하지 않는다.
//
// 환경 가드:
// - 햅틱 미지원 플랫폼(web 등)에서는 no-op.
// - expo-haptics는 fire-and-forget Promise를 반환하며 시뮬레이터/미지원 기기에서
//   reject할 수 있으므로 모든 호출을 try/catch + Promise rejection 흡수로 감싼다.
export interface Haptics_ {
  /** 가벼운 탭(선택·토글 등 일상적 확인) */
  light: () => void;
  /** 중간 강도(중요 액션 트리거) */
  medium: () => void;
  /** 성공 알림(관심기업 추가 등 긍정 완료) */
  success: () => void;
  /** 경고 알림(주문 승인·Kill Switch 등 위험·되돌리기 어려운 액션) */
  warning: () => void;
}

const HAPTICS_SUPPORTED = Platform.OS === 'ios' || Platform.OS === 'android';

function run(fire: () => Promise<void>): void {
  if (!HAPTICS_SUPPORTED) return;
  try {
    // 결과를 기다리지 않고 rejection만 무해하게 흡수(촉각 피드백은 best-effort).
    fire().catch(() => {});
  } catch {
    // 동기 throw(미지원 환경)도 무시.
  }
}

export function useHaptics(): Haptics_ {
  return useMemo<Haptics_>(
    () => ({
      light: () => run(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)),
      medium: () => run(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)),
      success: () =>
        run(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)),
      warning: () =>
        run(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning)),
    }),
    [],
  );
}
