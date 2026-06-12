import { useCallback } from 'react';
import { Platform } from 'react-native';
import * as Haptics from 'expo-haptics';

/**
 * 가벼운 햅틱 피드백 훅 (DAR-175).
 *
 * 정보 시트 열기 같은 보조 상호작용에 light impact 한 번을 best-effort 로 발생시킨다.
 *  - 웹은 햅틱 미지원 → no-op.
 *  - 네이티브 호출 실패(미지원 기기·시뮬레이터 등)는 조용히 무시한다.
 *    햅틱은 보조 효과이므로 실패가 상호작용 흐름(시트 열림)을 막아서는 안 된다.
 */
export function useHaptics() {
  const light = useCallback(() => {
    if (Platform.OS === 'web') return;
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {
      // 햅틱 미지원·권한 등으로 실패해도 무시(보조 효과).
    });
  }, []);

  return { light };
}
