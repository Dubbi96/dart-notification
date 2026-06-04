import React, { useCallback } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Surface, Chip, Banner } from 'react-native-paper';
import { Feather } from '@expo/vector-icons';
import { useTheme, type ThemeColors } from '@theme';
import { spacing, radius } from '@theme/spacing';
import { AiReferenceLabel } from '@components/common/AiReferenceLabel';
import { ScoreGauge } from '@components/common/ScoreGauge';
import {
  exitActionColor,
  exitActionLabel,
  pnlColor,
  formatPnlPercent,
} from '@utils/signalDisplay';

import type { ExitSignal, ExitReason } from '@app-types/signal.types';

// 매도 신호 카드(기획 §3 SCR-SIGNALS-EXIT).
// 매도 근거 kind별 아이콘 색상 매핑 + 권장 액션 배지 + 손익률.

interface ExitScoreCardProps {
  signal: ExitSignal;
  onPress?: (signal: ExitSignal) => void;
}

function reasonColor(kind: ExitReason['kind'], colors: ThemeColors): string {
  switch (kind) {
    case 'loss':
    case 'thesis':
      return colors.error;
    case 'chart':
      return colors.warning;
    case 'time':
      return colors.textSecondary;
  }
}

export function ExitScoreCard({ signal, onPress }: ExitScoreCardProps) {
  const { colors, typography: typo } = useTheme();
  const handlePress = useCallback(() => onPress?.(signal), [onPress, signal]);

  return (
    <TouchableOpacity
      activeOpacity={0.8}
      onPress={handlePress}
      accessibilityRole="button"
      accessibilityLabel={`${signal.corpName} 매도 신호, Exit Score ${signal.exitScore}, ${exitActionLabel(
        signal.action,
      )}`}
    >
      <Surface elevation={2} style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        <View style={styles.headerRow}>
          <Text style={[typo.bodyMedium, { color: colors.text, flex: 1 }]} numberOfLines={1}>
            {signal.corpName}
          </Text>
          <Chip
            compact
            mode="flat"
            style={[styles.actionChip, { backgroundColor: colors.surfaceSecondary }]}
            textStyle={[typo.small, { color: exitActionColor(signal.action, colors), fontWeight: '700' }]}
          >
            {exitActionLabel(signal.action)}
          </Chip>
        </View>

        <View style={styles.gaugeWrap}>
          <ScoreGauge score={signal.exitScore} kind="exit" statusText={exitActionLabel(signal.action)} />
        </View>

        {signal.reasons.length > 0 ? (
          <View style={styles.reasonList}>
            {signal.reasons.slice(0, 3).map((r) => (
              <View key={r.id} style={styles.reasonRow}>
                <Feather name="alert-circle" size={13} color={reasonColor(r.kind, colors)} />
                <Text style={[typo.small, { color: colors.textSecondary, flex: 1 }]}>{r.label}</Text>
              </View>
            ))}
          </View>
        ) : null}

        {signal.recommendedAction ? (
          <View style={styles.recommendRow}>
            <Text style={[typo.small, { color: colors.textSecondary }]}>권장</Text>
            <Chip
              compact
              mode="flat"
              style={[styles.recommendChip, { backgroundColor: colors.surfaceSecondary }]}
              textStyle={[typo.small, { color: colors.text }]}
            >
              {signal.recommendedAction}
            </Chip>
          </View>
        ) : null}

        {typeof signal.pnlPercent === 'number' ? (
          <Text style={[typo.small, { color: colors.textSecondary, marginTop: spacing.sm }]}>
            현재 손익:{' '}
            <Text style={[typo.captionMedium, { color: pnlColor(signal.pnlPercent, colors) }]}>
              {formatPnlPercent(signal.pnlPercent)}
            </Text>
          </Text>
        ) : null}

        {signal.blockRebuy ? (
          <Banner visible actions={[]} style={[styles.banner, { backgroundColor: colors.surfaceSecondary }]}>
            <Text style={[typo.small, { color: colors.error }]}>
              재매수 차단됨 — 이 종목은 일정 기간 재진입이 차단됩니다.
            </Text>
          </Banner>
        ) : null}

        <View style={styles.footerRow}>
          <AiReferenceLabel />
        </View>
      </Surface>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: radius.lg,
    borderWidth: 1,
    padding: spacing.base,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  actionChip: {
    height: 26,
  },
  gaugeWrap: {
    marginTop: spacing.md,
  },
  reasonList: {
    marginTop: spacing.sm,
    gap: spacing.xs,
  },
  reasonRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  recommendRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  recommendChip: {
    height: 26,
  },
  banner: {
    marginTop: spacing.sm,
    borderRadius: radius.md,
  },
  footerRow: {
    marginTop: spacing.md,
  },
});
