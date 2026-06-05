import React, { useEffect, useState } from 'react';
import { View, StyleSheet, Animated, type DimensionValue } from 'react-native';
import { useTheme } from '@theme';
import { spacing, radius } from '@theme/spacing';

// 스켈레톤 공통 컴포넌트 — 기획 ux-detail-plan.md §2-1, §2-3.
// 레이아웃 구조가 예측 가능한 리스트·카드(공시 피드/신호 피드/포트폴리오)에 사용.
// pulse 애니메이션 1.5s (opacity 0.4→1→0.4), 색상 surfaceSecondary.

type SkeletonVariant = 'disclosure' | 'buyScore';

const PULSE_DURATION = 750; // 0.4→1, 1→0.4 각 750ms = 1.5s 1사이클

function usePulse() {
  // lazy init: 컴포넌트 수명 동안 안정적인 단일 Animated.Value 보관
  const [opacity] = useState(() => new Animated.Value(0.4));

  useEffect(() => {
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
  }, [opacity]);

  return opacity;
}

interface BarProps {
  width: DimensionValue;
  height: number;
  opacity: Animated.Value;
  style?: object;
}

function Bar({ width, height, opacity, style }: BarProps) {
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
        <Bar width={60} height={20} opacity={opacity} />
        <Bar width={80} height={12} opacity={opacity} />
      </View>
      <Bar width="100%" height={16} opacity={opacity} style={{ marginTop: spacing.sm }} />
      <Bar width="75%" height={16} opacity={opacity} style={{ marginTop: spacing.xs }} />
      <Bar width="30%" height={12} opacity={opacity} style={{ marginTop: spacing.sm }} />
    </View>
  );
}

function BuyScoreSkeleton({ opacity }: { opacity: Animated.Value }) {
  const { colors } = useTheme();
  return (
    <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.borderLight }]}>
      <View style={styles.row}>
        <View style={styles.rowLeft}>
          <Bar width={24} height={24} opacity={opacity} />
          <Bar width={100} height={16} opacity={opacity} style={{ marginLeft: spacing.sm }} />
        </View>
        <Bar width={56} height={24} opacity={opacity} />
      </View>
      <Bar width="100%" height={10} opacity={opacity} style={{ marginTop: spacing.base }} />
      <Bar width="90%" height={12} opacity={opacity} style={{ marginTop: spacing.base }} />
      <Bar width="60%" height={12} opacity={opacity} style={{ marginTop: spacing.xs }} />
      <View style={styles.dotsRow}>
        <Bar width={52} height={20} opacity={opacity} />
        <Bar width={52} height={20} opacity={opacity} />
        <Bar width={52} height={20} opacity={opacity} />
      </View>
    </View>
  );
}

export function SkeletonCard({ variant }: { variant: SkeletonVariant }) {
  const opacity = usePulse();
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
