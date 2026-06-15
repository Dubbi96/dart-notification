import React, { useCallback } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Surface, Chip } from 'react-native-paper';
import { Feather } from '@expo/vector-icons';
import { useTheme, MAX_CHIP_FONT_SCALE } from '@theme';
import { spacing, radius } from '@theme/spacing';
import { PriceChangeChip } from '@components/common/PriceChangeChip';
import {
  thesisStatusColor,
  thesisStatusLabel,
  formatPnlPercent,
} from '@utils/signalDisplay';

import type { Position } from '@app-types/portfolio.types';

// 포지션 카드(기획 §3 SCR-PORTFOLIO). 손익률 색상 + ThesisStatus 배지.
// VIOLATED/EXPIRED 정렬 우선순위는 화면(리스트)에서 처리한다.

interface PositionCardProps {
  position: Position;
  onPress?: (position: Position) => void;
}

function PositionCardBase({ position, onPress }: PositionCardProps) {
  const { colors, typography: typo } = useTheme();
  const handlePress = useCallback(() => onPress?.(position), [onPress, position]);
  const statusColor = thesisStatusColor(position.thesisStatus, colors);

  return (
    <TouchableOpacity
      activeOpacity={0.8}
      onPress={handlePress}
      accessibilityRole="button"
      accessibilityLabel={`${position.corpName}, 손익 ${formatPnlPercent(
        position.pnlPercent,
      )}, Thesis 상태 ${thesisStatusLabel(position.thesisStatus)}`}
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
              style={[styles.statusChip, { backgroundColor: colors.surfaceSecondary }]}
              textStyle={[typo.small, { color: statusColor, fontWeight: '700' }]}
            >
              {thesisStatusLabel(position.thesisStatus)}
            </Chip>
          </View>
          <View style={styles.right}>
            {/* 등락률 칩(§12) — 색+부호+화살표 병행. 부모 카드가 손익을 합성 읽기 */}
            <PriceChangeChip value={position.pnlPercent} />
            <Feather name="chevron-right" size={18} color={colors.textTertiary} />
          </View>
        </View>
        {position.thesisStatus === 'VIOLATED' ? (
          <Text style={[typo.small, { color: colors.error, marginTop: spacing.xs }]}>매도 검토 필요</Text>
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
