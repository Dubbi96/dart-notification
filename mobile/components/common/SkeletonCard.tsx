import React, { useEffect, useState } from 'react';
import { View, StyleSheet, Animated, type DimensionValue } from 'react-native';
import { useTheme } from '@theme';
import { spacing, radius } from '@theme/spacing';
import { useReducedMotion } from '@hooks/useReducedMotion';

// 스켈레톤 공통 컴포넌트 — 기획 ux-detail-plan.md §2-1, §2-3.
// 레이아웃 구조가 예측 가능한 리스트·카드(공시 피드/신호 피드/포트폴리오)에 사용.
// pulse 애니메이션 1.5s (opacity 0.4→1→0.4), 색상 surfaceSecondary.

type SkeletonVariant = 'disclosure' | 'buyScore';

const PULSE_DURATION = 750; // 0.4→1, 1→0.4 각 750ms = 1.5s 1사이클
// reduce-motion 시 펄스 루프를 멈추고 고정하는 정적 표면 불투명도(ScoreGauge 가드 패턴 정렬).
const STATIC_OPACITY = 1;

// 단일 pulse Animated.Value를 제공하는 공통 훅.
// 상세 화면 스켈레톤(DetailSkeleton)이 동일한 펄스 타이밍을 재사용하도록 export.
export function useSkeletonPulse() {
  // lazy init: 컴포넌트 수명 동안 안정적인 단일 Animated.Value 보관
  const [opacity] = useState(() => new Animated.Value(0.4));
  // 접근성 '동작 줄이기' 시 연속 펄스를 정적화(§11 모션 폴백, ScoreGauge와 동일 패턴).
  const reducedMotion = useReducedMotion();

  useEffect(() => {
    if (reducedMotion) {
      // 루프 중지·정적 표면. reduce-motion 토글에도 effect 재실행으로 즉시 반영.
      opacity.setValue(STATIC_OPACITY);
      return;
    }
    opacity.setValue(0.4);
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, {
          toValue: 1,
          duration: PULSE_DURATION,
          useNativeDriver: true,
        }),
        Animated.timing(opacity, {
          toValue: 0.4,
          duration: PULSE_DURATION,
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [opacity, reducedMotion]);

  return opacity;
}

interface BarProps {
  width: DimensionValue;
  height: number;
  opacity: Animated.Value;
  style?: object;
}

// 펄스 막대 1개. 외부 펄스(useSkeletonPulse)를 주입받아 상세 화면 스켈레톤에서도 재사용.
export function SkeletonBar({ width, height, opacity, style }: BarProps) {
  const { colors } = useTheme();
  return (
    <Animated.View
      style={[
        {
          width,
          height,
          opacity,
          backgroundColor: colors.surfaceSecondary,
          borderRadius: radius.sm,
        },
        style,
      ]}
    />
  );
}

function DisclosureSkeleton({ opacity }: { opacity: Animated.Value }) {
  const { colors } = useTheme();
  return (
    <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.borderLight }]}>
      <View style={styles.row}>
        <SkeletonBar width={60} height={20} opacity={opacity} />
        <SkeletonBar width={80} height={12} opacity={opacity} />
      </View>
      <SkeletonBar width="100%" height={16} opacity={opacity} style={{ marginTop: spacing.sm }} />
      <SkeletonBar width="75%" height={16} opacity={opacity} style={{ marginTop: spacing.xs }} />
      <SkeletonBar width="30%" height={12} opacity={opacity} style={{ marginTop: spacing.sm }} />
    </View>
  );
}

function BuyScoreSkeleton({ opacity }: { opacity: Animated.Value }) {
  const { colors } = useTheme();
  return (
    <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.borderLight }]}>
      <View style={styles.row}>
        <View style={styles.rowLeft}>
          <SkeletonBar width={24} height={24} opacity={opacity} />
          <SkeletonBar width={100} height={16} opacity={opacity} style={{ marginLeft: spacing.sm }} />
        </View>
        <SkeletonBar width={56} height={24} opacity={opacity} />
      </View>
      <SkeletonBar width="100%" height={10} opacity={opacity} style={{ marginTop: spacing.base }} />
      <SkeletonBar width="90%" height={12} opacity={opacity} style={{ marginTop: spacing.base }} />
      <SkeletonBar width="60%" height={12} opacity={opacity} style={{ marginTop: spacing.xs }} />
      <View style={styles.dotsRow}>
        <SkeletonBar width={52} height={20} opacity={opacity} />
        <SkeletonBar width={52} height={20} opacity={opacity} />
        <SkeletonBar width={52} height={20} opacity={opacity} />
      </View>
    </View>
  );
}

export function SkeletonCard({ variant }: { variant: SkeletonVariant }) {
  const opacity = useSkeletonPulse();
  return variant === 'buyScore' ? (
    <BuyScoreSkeleton opacity={opacity} />
  ) : (
    <DisclosureSkeleton opacity={opacity} />
  );
}

interface SkeletonListProps {
  variant: SkeletonVariant;
  count?: number;
}

// 리스트 자리 스켈레톤. 컨테이너에 progressbar 접근성 부여(§2-3).
export function SkeletonList({ variant, count = 5 }: SkeletonListProps) {
  return (
    <View
      style={styles.list}
      accessibilityRole="progressbar"
      accessibilityLabel="로딩 중"
    >
      {Array.from({ length: count }).map((_, i) => (
        <SkeletonCard key={i} variant={variant} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  list: {
    padding: spacing.lg,
    gap: spacing.md,
  },
  card: {
    padding: spacing.base,
    borderRadius: radius.lg,
    borderWidth: 1,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  rowLeft: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  dotsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-start',
    marginTop: spacing.base,
    gap: spacing.sm,
  },
});
