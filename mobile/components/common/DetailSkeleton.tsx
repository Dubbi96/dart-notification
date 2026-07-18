import React from 'react';
import { View, StyleSheet, type ViewStyle, type DimensionValue } from 'react-native';
import { useTheme } from '@theme';
import { spacing, radius } from '@theme/spacing';
import { SkeletonBar, useSkeletonPulse, useSkeletonWatchdog, SkeletonWatchdogFallback } from './SkeletonCard';

// 상세/탭 화면 로딩 스켈레톤(DAR-147) — 중앙 ActivityIndicator(LoadingState) 대체.
// 콘텐츠와 동일한 카드 골격을 미리 그려 로딩→콘텐츠 전환 시 레이아웃 점프를 제거한다.
// 리스트 스켈레톤(SkeletonCard/SkeletonList)과 펄스(useSkeletonPulse)를 공유해 일관성 확보.

// 본문 막대의 폭 패턴(자연스러운 텍스트 줄 흉내). 매직넘버 대신 토큰화.
const LINE_WIDTHS: DimensionValue[] = ['100%', '78%', '60%', '88%'];
const TITLE_BAR_WIDTH = 140;
const TITLE_BAR_HEIGHT = 20;
const CHIP_BAR_WIDTH = 56;
const CHIP_BAR_HEIGHT = 24;
const GAUGE_BAR_HEIGHT = 72;
const LINE_BAR_HEIGHT = 12;

export interface SkeletonCardSpec {
  // 제목 줄 오른쪽에 칩(등급/상태) 자리 표시 여부.
  chip?: boolean;
  // 점수 게이지 자리(큰 막대) 포함 여부.
  gauge?: boolean;
  // 본문 줄 개수(기본 3).
  lines?: number;
}

function SkeletonCardBlock({
  spec,
  opacity,
}: {
  spec: SkeletonCardSpec;
  opacity: ReturnType<typeof useSkeletonPulse>;
}) {
  const { colors } = useTheme();
  const lineCount = spec.lines ?? 3;
  return (
    <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.borderLight }]}>
      <View style={styles.titleRow}>
        <SkeletonBar width={TITLE_BAR_WIDTH} height={TITLE_BAR_HEIGHT} opacity={opacity} />
        {spec.chip ? (
          <SkeletonBar width={CHIP_BAR_WIDTH} height={CHIP_BAR_HEIGHT} opacity={opacity} />
        ) : null}
      </View>
      {spec.gauge ? (
        <SkeletonBar
          width="100%"
          height={GAUGE_BAR_HEIGHT}
          opacity={opacity}
          style={styles.gauge}
        />
      ) : null}
      {Array.from({ length: lineCount }).map((_, i) => (
        <SkeletonBar
          key={i}
          width={LINE_WIDTHS[i % LINE_WIDTHS.length]}
          height={LINE_BAR_HEIGHT}
          opacity={opacity}
          style={i === 0 ? styles.firstLine : styles.line}
        />
      ))}
    </View>
  );
}

interface DetailSkeletonProps {
  // 위에서 아래로 그릴 카드 골격 목록(콘텐츠 레이아웃에 맞춰 지정).
  cards: SkeletonCardSpec[];
  // 컨테이너 패딩/간격 override(예: 리스트 본문에 삽입 시).
  style?: ViewStyle;
  // DAR-560/R-21: 10초 워치독 만료 시 호출할 재시도. 상세 화면은 무피드백 무기한 로딩이 실사용자
  // 이탈로 이어진 실사고(company/[corpCode].tsx)라 필수 prop으로 강제한다.
  onRetry: () => void;
}

// 상세 화면 스켈레톤 셸. 단일 펄스를 모든 막대에 공유하고 progressbar 접근성을 부여(§2-3).
export function DetailSkeleton({ cards, style, onRetry }: DetailSkeletonProps) {
  const opacity = useSkeletonPulse();
  const timedOut = useSkeletonWatchdog(onRetry);

  if (timedOut) {
    return <SkeletonWatchdogFallback onRetry={onRetry} />;
  }

  return (
    <View
      style={[styles.container, style]}
      accessibilityRole="progressbar"
      accessibilityLabel="로딩 중"
    >
      {cards.map((spec, i) => (
        <SkeletonCardBlock key={i} spec={spec} opacity={opacity} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: spacing.lg,
    gap: spacing.md,
  },
  card: {
    padding: spacing.base,
    borderRadius: radius.lg,
    borderWidth: 1,
  },
  titleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  gauge: {
    marginTop: spacing.base,
  },
  firstLine: {
    marginTop: spacing.base,
  },
  line: {
    marginTop: spacing.sm,
  },
});
