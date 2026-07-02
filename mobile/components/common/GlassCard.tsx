import React from 'react';
import { View, StyleSheet, type ViewStyle } from 'react-native';
import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import { radius } from '@theme/spacing';
import { useTheme } from '@theme';

interface GlassCardProps {
  children: React.ReactNode;
  style?: ViewStyle;
  intensity?: number;
  variant?: 'default' | 'iridescent';
}

// L-5b(E-2): 글래스 연출 장식 팔레트 — 반투명 오버레이 전용이라 colors.ts(불투명 표면 토큰)와
// 분리해 이 컴포넌트의 상수층에서 관리한다. 테마(Teal) 개편 시 이 블록만 갱신하면 된다.
// 값은 기존 rgba 리터럴과 동일 — 시각 결과 변화 없음.
const GLASS = {
  // 무지개 홀로그램 스윕(좌상 → 우하)
  iridescentSweep: [
    'rgba(255, 100, 180, 0.12)',
    'rgba(160, 120, 255, 0.10)',
    'rgba(80, 200, 255, 0.12)',
    'rgba(100, 255, 200, 0.10)',
    'rgba(255, 220, 100, 0.08)',
    'rgba(255, 140, 120, 0.10)',
  ],
  // 깊이감을 주는 보조 라이트 스트릭
  lightStreak: [
    'transparent',
    'rgba(255, 255, 255, 0.15)',
    'rgba(200, 230, 255, 0.08)',
    'transparent',
  ],
  // 상단 엣지 스펙큘러 하이라이트
  specularHighlight: [
    'rgba(255, 255, 255, 0.20)',
    'rgba(255, 255, 255, 0.05)',
    'transparent',
  ],
  // 프로스트 보더(다크 인지 분기)
  border: {
    light: 'rgba(255, 255, 255, 0.45)',
    dark: 'rgba(255, 255, 255, 0.12)',
  },
} as const;

export function GlassCard({
  children,
  style,
  intensity = 25,
  variant = 'iridescent',
}: GlassCardProps) {
  const { isDark } = useTheme();

  return (
    <View style={[styles.container, style]}>
      {/* Base blur layer */}
      <BlurView
        intensity={intensity}
        tint={isDark ? 'dark' : 'light'}
        style={StyleSheet.absoluteFill}
      />

      {/* Iridescent rainbow light refraction overlay */}
      {variant === 'iridescent' && (
        <>
          {/* Main holographic sweep - top-left to bottom-right */}
          <LinearGradient
            colors={GLASS.iridescentSweep}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={StyleSheet.absoluteFill}
          />

          {/* Secondary light streak - creates depth */}
          <LinearGradient
            colors={GLASS.lightStreak}
            start={{ x: 0.2, y: 0 }}
            end={{ x: 0.8, y: 1 }}
            style={StyleSheet.absoluteFill}
          />

          {/* Subtle specular highlight - top edge shine */}
          <LinearGradient
            colors={GLASS.specularHighlight}
            start={{ x: 0.3, y: 0 }}
            end={{ x: 0.7, y: 0.4 }}
            style={StyleSheet.absoluteFill}
          />
        </>
      )}

      {/* Glass frost border effect */}
      <View
        style={[
          StyleSheet.absoluteFill,
          styles.borderOverlay,
          { borderColor: isDark ? GLASS.border.dark : GLASS.border.light },
        ]}
      />

      {/* Content */}
      <View style={styles.content}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    borderRadius: radius.xl,
    overflow: 'hidden',
    position: 'relative',
  },
  borderOverlay: {
    borderWidth: 1,
    borderRadius: radius.xl,
  },
  content: {
    position: 'relative',
    zIndex: 1,
  },
});
