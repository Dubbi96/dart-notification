import React, { useMemo, useCallback } from 'react';
import { View, Text, FlatList, TouchableOpacity, StyleSheet } from 'react-native';
import { Surface, Chip } from 'react-native-paper';
import { useTheme } from '@theme';
import { spacing, radius } from '@theme/spacing';
import { ScoreGauge } from '@components/common/ScoreGauge';
import {
  exitActionColor,
  exitActionLabel,
  formatPnlPercent,
  pnlColor,
  thesisStatusColor,
  thesisStatusLabel,
} from '@utils/signalDisplay';

import type { Position } from '@app-types/portfolio.types';

const STATUS_ORDER: Record<Position['thesisStatus'], number> = {
  VIOLATED: 0,
  EXPIRED: 1,
  WATCHING: 2,
  ACTIVE: 3,
};

interface TodayCheckSlotProps {
  positions: Position[];
  onPress?: (position: Position) => void;
}

const CARD_WIDTH = 220;

export function TodayCheckSlot({ positions, onPress }: TodayCheckSlotProps) {
  const { colors, typography: typo } = useTheme();

  const curated = useMemo(() => {
    const filtered = positions.filter(
      (p) =>
        p.exitScore !== undefined ||
        p.thesisStatus === 'VIOLATED' ||
        p.thesisStatus === 'EXPIRED',
    );
    return filtered
      .sort(
        (a, b) =>
          (STATUS_ORDER[a.thesisStatus] - STATUS_ORDER[b.thesisStatus]) ||
          ((b.exitScore ?? 0) - (a.exitScore ?? 0)),
      )
      .slice(0, 5);
  }, [positions]);

  const renderCard = useCallback(
    ({ item }: { item: Position }) => {
      const statusColor = thesisStatusColor(item.thesisStatus, colors);
      const accessLabel = `${item.corpName} ${formatPnlPercent(item.pnlPercent)} ${
        item.exitAction ? exitActionLabel(item.exitAction) : thesisStatusLabel(item.thesisStatus)
      }`;

      return (
        <TouchableOpacity
          onPress={() => onPress?.(item)}
          activeOpacity={0.8}
          accessibilityRole="button"
          accessibilityLabel={accessLabel}
          style={styles.cardWrapper}
        >
          <Surface elevation={2} style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <View style={styles.cardHeader}>
              <Text style={[typo.bodyMedium, styles.cardTitle, { color: colors.text }]} numberOfLines={1}>
                {item.corpName}
              </Text>
              {item.exitAction ? (
                <Chip
                  compact
                  mode="flat"
                  style={[styles.actionChip, { backgroundColor: colors.surfaceSecondary }]}
                  textStyle={[typo.small, styles.actionChipText, { color: exitActionColor(item.exitAction, colors) }]}
                >
                  {exitActionLabel(item.exitAction)}
                </Chip>
              ) : null}
            </View>

            <Text style={[typo.captionMedium, { color: pnlColor(item.pnlPercent, colors), marginTop: spacing.xs }]}>
              {formatPnlPercent(item.pnlPercent)}
            </Text>

            {item.exitScore !== undefined ? (
              <ScoreGauge
                score={item.exitScore}
                kind="exit"
                accessibilityHidden
              />
            ) : (
              <View
                style={[
                  styles.urgencyBar,
                  { backgroundColor: statusColor },
                ]}
              />
            )}

            <Text
              style={[typo.small, { color: colors.textSecondary, marginTop: spacing.xs }]}
              numberOfLines={1}
            >
              {item.checkReason ?? thesisStatusLabel(item.thesisStatus)}
            </Text>
          </Surface>
        </TouchableOpacity>
      );
    },
    [colors, typo, onPress],
  );

  if (curated.length === 0) return null;

  return (
    <View style={styles.container}>
      <View style={styles.sectionHeader}>
        <Text style={[typo.bodyMedium, styles.sectionTitle, { color: colors.text }]} numberOfLines={1}>
          오늘 점검할 포지션
        </Text>
        <Chip
          compact
          mode="flat"
          style={[styles.criterionChip, { backgroundColor: colors.surfaceSecondary }]}
          textStyle={[typo.small, styles.criterionChipText, { color: colors.textSecondary }]}
        >
          Exit Score 순
        </Chip>
      </View>
      <FlatList
        data={curated}
        renderItem={renderCard}
        keyExtractor={(item) => item.id}
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.listContent}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginBottom: spacing.lg,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.sm,
    gap: spacing.sm,
  },
  sectionTitle: {
    flexShrink: 1,
  },
  criterionChip: {
    minHeight: 24,
    flexShrink: 0,
  },
  criterionChipText: {
    flexShrink: 0,
  },
  listContent: {
    gap: spacing.sm,
  },
  cardWrapper: {
    width: CARD_WIDTH,
  },
  card: {
    borderRadius: radius.lg,
    borderWidth: 1,
    padding: spacing.base,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  actionChip: {
    height: 24,
  },
  actionChipText: {
    fontWeight: '700',
  },
  cardTitle: {
    flex: 1,
  },
  urgencyBar: {
    height: 4,
    borderRadius: 2,
    marginTop: spacing.sm,
  },
});
