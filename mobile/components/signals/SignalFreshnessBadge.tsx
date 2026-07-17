import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useTheme, MAX_CHIP_FONT_SCALE } from '@theme';
import { spacing, radius } from '@theme/spacing';
import { getSignalDateStatus, getSignalFreshness } from '@utils/signalFreshness';

// 신호 신선도 배지(DAR-326) — 점수 게이지 하단·신호카드에 일관 표기.
// '만료(재평가 필요)' / '오래됨(조건 재확인)' 만 노출하고 신선 신호엔 미표시(노이즈 방지).
// 판정 로직은 utils/signalFreshness(SSOT)·여기는 테마 색상 매핑 + 렌더만 담당.
// reduce-motion 무관(정적), Feather clock/alert-triangle, 테마 토큰 색상만 사용.
// DAR-506: 상세 변형의 'N시간 전 평가' 상대시간 단독 표기를 폐기하고 절대 발생일(M/D)을 병기한다
// (절대일 상시 병기 규약). 공시 접수일 우선·지연/만료 날짜 배지는 공용 SignalDateBadge 가 담당한다.

interface SignalFreshnessBadgeProps {
  /** ISO 8601 — 신호 생성/평가 시각 */
  createdAt?: string | null;
  /** ISO 8601 — 신호 만료 시각 */
  expiresAt?: string | null;
  /**
   * 'card' = 카드용 압축 인라인 칩(라벨만). 'detail' = 상세 점수 게이지 하단(경과 시간 동반).
   */
  variant?: 'card' | 'detail';
  style?: object;
}

function SignalFreshnessBadgeBase({
  createdAt,
  expiresAt,
  variant = 'card',
  style,
}: SignalFreshnessBadgeProps) {
  const { colors, typography: typo } = useTheme();
  const freshness = getSignalFreshness({ createdAt, expiresAt });

  // 신선(또는 판단 불가)이면 미표시 — 정직 폴백(억지 경고 없음).
  if (!freshness.show) return null;

  const toneColor = freshness.tone === 'alert' ? colors.error : colors.warning;

  // DAR-506: 상세에선 절대 발생일(M/D)을 동반 노출('… · 6/18') — 'N시간 전' 상대시간 단독 폐기.
  // 카드는 압축 라벨만. 날짜 파생은 getSignalDateStatus(SSOT) 재사용(공시 없으면 createdAt 폴백).
  const dateStatus = variant === 'detail' ? getSignalDateStatus({ createdAt, expiresAt }) : null;
  const fullLabel = dateStatus?.show
    ? `${freshness.label} · ${dateStatus.dateText}`
    : freshness.label;

  return (
    <View
      style={[
        styles.badge,
        variant === 'detail' ? styles.detailBadge : styles.cardBadge,
        {
          backgroundColor: colors.surfaceSecondary,
          borderColor: toneColor,
        },
        style,
      ]}
      accessibilityRole="text"
      accessibilityLabel={`신호 신선도: ${fullLabel}`}
    >
      <Feather name={freshness.icon} size={variant === 'detail' ? 14 : 12} color={toneColor} />
      <Text
        style={[typo.small, { color: toneColor, flexShrink: 1, minWidth: 0 }]}
        numberOfLines={1}
        maxFontSizeMultiplier={MAX_CHIP_FONT_SCALE}
        ellipsizeMode="tail"
      >
        {fullLabel}
      </Text>
    </View>
  );
}

export const SignalFreshnessBadge = React.memo(SignalFreshnessBadgeBase);

const styles = StyleSheet.create({
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: spacing.xs,
    borderWidth: 1,
    borderRadius: radius.full,
  },
  cardBadge: {
    paddingVertical: 2,
    paddingHorizontal: spacing.sm,
    minHeight: 22,
  },
  detailBadge: {
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.sm,
    minHeight: 26,
  },
});
