import React from 'react';
import { StyleSheet, type ViewStyle } from 'react-native';
import { Chip } from 'react-native-paper';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '@theme';
import { spacing } from '@theme/spacing';
import { pnlColor } from '@utils/signalDisplay';

// 등락률 칩(기획 §12 P2-B). 색 단독 의미 금지 — 색 + 부호 + 방향 아이콘 병행.
// 정적 표시(깜빡임/펄스 금지), 테마 토큰만 사용. FOMO 연출 금지.

interface PriceChangeChipProps {
  /** 손익률(%) 예: +2.04 또는 -3.21 */
  value: number;
  /** 절대 금액(표시 선택) */
  amount?: number;
  style?: ViewStyle;
}

export function PriceChangeChip({ value, amount, style }: PriceChangeChipProps) {
  const { colors, typography: typo } = useTheme();

  const iconName = value > 0 ? 'trending-up' : value < 0 ? 'trending-down' : 'minus';
  const isNeutral = value === 0;
  // 보합(0%)은 surfaceSecondary 틴트 위에서 textSecondary 대비가 AA(4.5:1) 미만으로 떨어진다.
  // surface 배경 + 헤어라인 보더로 칩 형태를 유지하면서 대비를 AA로 확보한다(DAR-148).
  const chipBg =
    value > 0 ? colors.successSurface : value < 0 ? colors.errorSurface : colors.surface;
  const textColor = pnlColor(value, colors);
  const sign = value > 0 ? '+' : '';
  const directionWord = value > 0 ? '상승' : value < 0 ? '하락' : '보합';
  const amountText =
    amount !== undefined ? ` (${amount > 0 ? '+' : ''}${amount.toLocaleString('ko-KR')}원)` : '';

  return (
    <Chip
      compact
      mode="flat"
      style={[
        styles.chip,
        { backgroundColor: chipBg },
        isNeutral && { borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border },
        style,
      ]}
      textStyle={[typo.small, { color: textColor, fontWeight: '700' }]}
      icon={({ size }) => <Feather name={iconName} size={size} color={textColor} />}
      accessibilityLabel={`수익률 ${Math.abs(value).toFixed(2)}% ${directionWord}${amountText}`}
    >
      {`${sign}${value.toFixed(2)}%${amountText}`}
    </Chip>
  );
}

const styles = StyleSheet.create({
  chip: {
    height: 26,
    paddingHorizontal: spacing.xs,
  },
});
