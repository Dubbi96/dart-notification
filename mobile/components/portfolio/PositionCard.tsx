import React, { useCallback } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Surface, Chip } from 'react-native-paper';
import { Feather } from '@expo/vector-icons';
import { useTheme, MAX_CHIP_FONT_SCALE } from '@theme';
import { spacing, radius } from '@theme/spacing';
import { PriceChangeChip } from '@components/common/PriceChangeChip';
import {
  thesisStatusColor,
  positionSystemAction,
  formatPnlPercent,
} from '@utils/signalDisplay';

import type { Position } from '@app-types/portfolio.types';

// 포지션 카드(기획 §3 SCR-PORTFOLIO). 손익률 색상 + 시스템 자동 동작 배지.
// VIOLATED/EXPIRED 정렬 우선순위는 화면(리스트)에서 처리한다.
//
// DAR-368: 모의투자는 **시스템 트레이딩 현황**이다 — 상태칩을 자동 동작 언어로 표기한다.
//  · 하드룰 손절·청산(EXIT) = '자동 매도 예정'(솔리드 강조 + 자동 실행 아이콘). 시스템이 다음
//    평가 시 자동 체결하므로 사용자 수동 매도가 불필요하다. 수동 점검을 암시하는 문구는 금지.
//  · 논거 훼손 등 소프트(VIOLATED) = '시스템 모니터링'(보조 표면). 자동 매도 전, 시스템이 자동
//    판단 중이며 역시 사용자 조치가 불필요하다 → 하드손절과 시각 구분.

interface PositionCardProps {
  position: Position;
  onPress?: (position: Position) => void;
}

function PositionCardBase({ position, onPress }: PositionCardProps) {
  const { colors, typography: typo } = useTheme();
  const handlePress = useCallback(() => onPress?.(position), [onPress, position]);
  const statusColor = thesisStatusColor(position.thesisStatus, colors);

  // DAR-368: 자동 동작 디스크립터(라벨·톤·a11y) — 표시 문구를 시스템 행동과 일치시킨다.
  const action = positionSystemAction(position);
  const isAutoSell = action.tone === 'auto-sell';
  const isMonitoring = action.tone === 'monitoring';
  // 자동 매도(하드룰 손절·청산)만 솔리드 경고색으로 강조 — 시스템이 실제로 체결을 예정함을 우선 노출.
  const chipBg = isAutoSell ? colors.error : colors.surfaceSecondary;
  const chipTextColor = isAutoSell ? colors.onColor : statusColor;

  return (
    <TouchableOpacity
      activeOpacity={0.8}
      onPress={handlePress}
      accessibilityRole="button"
      accessibilityLabel={`${position.corpName}, 손익 ${formatPnlPercent(
        position.pnlPercent,
      )}, ${action.a11yLabel}`}
    >
      <Surface elevation={1} style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        <View style={styles.row}>
          <View style={styles.left}>
            <Text style={[typo.bodyMedium, { color: colors.text }]} numberOfLines={1}>
              {position.corpName}
            </Text>
            <Chip
              compact
              mode="flat"
              // DAR-298: 고정 높이 상태칩 — OS 글꼴 확대 시 한글 받침 세로 클리핑 방지 배율 상한(DAR-174 정본).
              maxFontSizeMultiplier={MAX_CHIP_FONT_SCALE}
              style={[styles.statusChip, { backgroundColor: chipBg }]}
              textStyle={[typo.small, { color: chipTextColor, fontWeight: '700' }]}
              // DAR-368: 자동 매도='zap'(시스템 자동 실행), 모니터링='activity'(시스템 감시). 수동 alert 금지.
              icon={
                isAutoSell
                  ? ({ size }) => <Feather name="zap" size={size} color={chipTextColor} />
                  : isMonitoring
                    ? ({ size }) => <Feather name="activity" size={size} color={chipTextColor} />
                    : undefined
              }
            >
              {action.label}
            </Chip>
          </View>
          <View style={styles.right}>
            {/* 등락률 칩(§12) — 색+부호+화살표 병행. 부모 카드가 손익을 합성 읽기 */}
            <PriceChangeChip value={position.pnlPercent} />
            <Feather name="chevron-right" size={18} color={colors.textTertiary} />
          </View>
        </View>
        {/* DAR-368: 하드룰 손절은 Engine5가 자동 체결 — 수동 매도 불필요임을 정직하게 고지(예정 상태). */}
        {isAutoSell ? (
          <Text style={[typo.small, { color: colors.error, marginTop: spacing.xs }]}>
            시스템이 다음 평가 시 자동 매도 — 조치 불필요
          </Text>
        ) : null}
      </Surface>
    </TouchableOpacity>
  );
}

// FlatList renderItem 자식 — 부모 리렌더 시 불필요한 리렌더 차단(DAR-128 성능 스윕).
export const PositionCard = React.memo(PositionCardBase);

const styles = StyleSheet.create({
  card: {
    borderRadius: radius.lg,
    borderWidth: 1,
    padding: spacing.base,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  left: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    flex: 1,
  },
  statusChip: {
    // DAR-298: 고정 height → minHeight. 캡된 큰 글꼴에서도 칩이 늘어나 받침이 잘리지 않는다(평시 동일).
    minHeight: 24,
  },
  right: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
});
