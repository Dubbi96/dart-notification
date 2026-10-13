import React, { useEffect, useState } from 'react';
import { Animated, StyleSheet, Text } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '@theme';
import { spacing } from '@theme/spacing';
import { useNetworkStatus } from '@hooks/useNetworkStatus';
import { useReducedMotion } from '@hooks/useReducedMotion';

// DAR-173: 전역 오프라인 인지 배너. 네트워크 단절 시 상단에서 슬라이드인.
// 단절을 무표식으로 두면 캐시 옛값을 '정상'으로 오인 → colors.warning(Surface) 배너로 명시.
// 별도 행을 차지해 큰 글자 안내문이 헤더·뒤로 가기 버튼을 덮지 않는다.
// 색 단독 의미 금지: wifi-off 아이콘(형태) + 평문 병기. pointerEvents='none'으로 터치 비차단.
// 훅은 항상 유지하고 온라인이면 행을 제거한다.
export function OfflineBanner() {
  const { isOffline } = useNetworkStatus();
  const { colors, typography: typo } = useTheme();
  const insets = useSafeAreaInsets();
  // lazy init: 컴포넌트 수명 동안 안정적인 단일 Animated.Value(SkeletonCard 패턴, ref 접근 회피).
  const [anim] = useState(() => new Animated.Value(0));
  // 접근성 '동작 줄이기' 시 슬라이드/페이드 생략하고 즉시 표시/숨김(§11 모션 폴백, ScoreGauge 패턴).
  const reducedMotion = useReducedMotion();

  useEffect(() => {
    if (reducedMotion) {
      // duration 없이 최종 상태로 스냅 — 등장/퇴장 모션 제거, 표시 여부는 동일.
      anim.setValue(isOffline ? 1 : 0);
      return;
    }
    const animation = Animated.timing(anim, {
      toValue: isOffline ? 1 : 0,
      duration: 220,
      useNativeDriver: true,
    });
    animation.start();
    return () => animation.stop();
  }, [isOffline, anim, reducedMotion]);

  if (!isOffline) return null;

  return (
    <Animated.View
      accessible
      accessibilityLiveRegion="polite"
      pointerEvents="none"
      accessibilityRole="alert"
      accessibilityElementsHidden={!isOffline}
      importantForAccessibility={isOffline ? 'yes' : 'no-hide-descendants'}
      accessibilityLabel="오프라인 상태입니다. 표시된 데이터는 마지막으로 받은 값일 수 있습니다."
      style={[
        styles.container,
        {
          paddingTop: insets.top + spacing.xs,
          backgroundColor: colors.warningSurface,
          borderBottomColor: colors.warning,
          opacity: anim,
          transform: [
            {
              translateY: anim.interpolate({
                inputRange: [0, 1],
                outputRange: [-12, 0],
              }),
            },
          ],
        },
      ]}
    >
      <Feather name="wifi-off" size={14} color={colors.warning} />
      <Text style={[typo.caption, styles.text, { color: colors.text, minWidth: 0 }]}>
        오프라인 — 인터넷 연결이 없어 마지막으로 받은 데이터를 표시합니다
      </Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexShrink: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    paddingBottom: spacing.xs,
    paddingHorizontal: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  text: {
    flexShrink: 1,
    fontWeight: '600',
  },
});
