import React, { useCallback, useState } from 'react';
import { StyleSheet, type ViewStyle } from 'react-native';
import { Chip } from 'react-native-paper';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '@theme';
import { spacing } from '@theme/spacing';
import { pnlColor } from '@utils/signalDisplay';
import { useHaptics } from '@hooks/useHaptics';
import { InfoSheet, type InfoSheetSection } from '@components/common/InfoSheet';

// 등락률 칩(기획 §12 P2-B). 색 단독 의미 금지 — 색 + 부호 + 방향 아이콘 병행.
// 정적 표시(깜빡임/펄스 금지), 테마 토큰만 사용. FOMO 연출 금지.
//
// 비대화형 개선 (DAR-175): 칩을 탭 가능한 버튼으로 만들고, 탭 시 색·부호 인코딩과 참고용 수치임을
// 설명하는 정보 시트(InfoSheet)로 연결한다. 탭 시 light 햅틱. disableInfo 로 옵트아웃 가능.

const PRICE_CHIP_INFO_SECTIONS: InfoSheetSection[] = [
  {
    icon: 'eye',
    heading: '색·부호·아이콘으로 방향 안내',
    body:
      '초록(+)·상승 아이콘은 상승/이익, 빨강(−)·하락 아이콘은 하락/손실, 회색(−)은 보합(변동 없음)을 ' +
      '뜻합니다. 색만으로 의미를 전달하지 않도록 부호와 방향 아이콘을 함께 표시합니다.',
  },
  {
    icon: 'info',
    heading: '참고용 수치',
    body:
      '표시되는 등락률은 참고용이며 실시간이 아닐 수 있습니다. 정확한 호가·체결가는 거래소·증권사 ' +
      '공식 정보로 확인하세요.',
  },
];

interface PriceChangeChipProps {
  /** 손익률(%) 예: +2.04 또는 -3.21 */
  value: number;
  /** 절대 금액(표시 선택) */
  amount?: number;
  /** true 면 탭 시 정보 시트를 열지 않고 정적으로 표시(기본 false). */
  disableInfo?: boolean;
  style?: ViewStyle;
}

export function PriceChangeChip({ value, amount, disableInfo = false, style }: PriceChangeChipProps) {
  const { colors, typography: typo } = useTheme();
  const { light } = useHaptics();
  const [sheetVisible, setSheetVisible] = useState(false);

  const openSheet = useCallback(() => {
    light();
    setSheetVisible(true);
  }, [light]);
  const closeSheet = useCallback(() => setSheetVisible(false), []);

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
  const valueLabel = `수익률 ${Math.abs(value).toFixed(2)}% ${directionWord}${amountText}`;

  return (
    <>
      <Chip
        compact
        mode="flat"
        onPress={disableInfo ? undefined : openSheet}
        style={[
          styles.chip,
          { backgroundColor: chipBg },
          isNeutral && { borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border },
          style,
        ]}
        textStyle={[typo.small, { color: textColor, fontWeight: '700' }]}
        icon={({ size }) => <Feather name={iconName} size={size} color={textColor} />}
        accessibilityLabel={disableInfo ? valueLabel : `${valueLabel}, 탭하면 등락률 표시 설명`}
      >
        {`${sign}${value.toFixed(2)}%${amountText}`}
      </Chip>

      {disableInfo ? null : (
        <InfoSheet
          visible={sheetVisible}
          onClose={closeSheet}
          title="등락률 표시 안내"
          sections={PRICE_CHIP_INFO_SECTIONS}
        />
      )}
    </>
  );
}

const styles = StyleSheet.create({
  chip: {
    height: 26,
    paddingHorizontal: spacing.xs,
  },
});
