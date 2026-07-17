import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useTheme, MAX_CHIP_FONT_SCALE } from '@theme';
import { spacing, radius } from '@theme/spacing';
import { getSignalDateStatus, type SignalDateInput } from '@utils/signalFreshness';

// 신호 날짜 배지(DAR-506) — 홈·에디션·explore 공용 SSOT.
// '절대 MM/DD 상시 병기 + 상태(오늘/어제/N일 전 · 지연 반영 · 만료)'를 한 규약으로 노출한다.
// 'N시간 전' 상대시간 단독 표기 폐기(정본 §3): 발생일(공시 접수일 우선)을 항상 함께 보여준다.
// 판정은 utils/signalFreshness.getSignalDateStatus(SSOT)가 전담하고, 여기는 테마 색 매핑 + 렌더만.
// reduce-motion 무관(정적), Feather calendar/clock/alert-triangle, 테마 토큰 색상만 사용.

interface SignalDateBadgeProps extends SignalDateInput {
  /**
   * 'card' = 카드용 압축 인라인 칩. 'detail' = 상세(살짝 큰 아이콘/패딩).
   */
  variant?: 'card' | 'detail';
  /** 결정론 테스트용 now 주입(기본 Date.now()). */
  now?: number;
  style?: object;
}

function SignalDateBadgeBase({
  createdAt,
  rcpDt,
  relatedDisclosureRcpNo,
  expiresAt,
  variant = 'card',
  now,
  style,
}: SignalDateBadgeProps) {
  const { colors, typography: typo } = useTheme();
  const status = getSignalDateStatus({ createdAt, rcpDt, relatedDisclosureRcpNo, expiresAt }, now);

  // 귀속 근거(공시 접수일/createdAt) 전무면 미표시 — 억지 날짜 표기 금지(정직 폴백).
  if (!status.show) return null;

  // 톤 → 테마 색: alert(만료)=error, warn(지연)=warning, muted(정상)=textSecondary.
  const toneColor =
    status.tone === 'alert'
      ? colors.error
      : status.tone === 'warn'
        ? colors.warning
        : colors.textSecondary;
  // 정상 상태는 경계선 없는 잔잔한 칩(노이즈 방지), 만료/지연만 톤 테두리로 시각 구분.
  // 정상 테두리는 배경과 동색(surfaceSecondary)으로 두어 색상 리터럴 없이 레이아웃을 고정한다.
  const borderColor = status.tone !== 'muted' ? toneColor : colors.surfaceSecondary;

  return (
    <View
      style={[
        styles.badge,
        variant === 'detail' ? styles.detailBadge : styles.cardBadge,
        {
          backgroundColor: colors.surfaceSecondary,
          borderColor,
        },
        style,
      ]}
      accessibilityRole="text"
      accessibilityLabel={status.accessibleText}
    >
      <Feather name={status.icon} size={variant === 'detail' ? 14 : 12} color={toneColor} />
      <Text
        style={[typo.small, { color: toneColor, flexShrink: 1, minWidth: 0 }]}
        numberOfLines={1}
        ellipsizeMode="tail"
        maxFontSizeMultiplier={MAX_CHIP_FONT_SCALE}
      >
        {status.label}
      </Text>
    </View>
  );
}

export const SignalDateBadge = React.memo(SignalDateBadgeBase);

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
