import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '@theme';
import { radius, spacing } from '@theme/spacing';

import type { AosAllocationSummary } from '@app-types/allocation.types';

interface Props {
  summary: AosAllocationSummary;
}

const LABELS = { SPGI: 'SPGI', VTI: 'VTI', SYSTEM_TRADING: '시스템' } as const;

export function AllocationSummaryCard({ summary }: Props) {
  const { colors, typography: typo } = useTheme();
  const latest = summary.plans[0];
  if (!summary.policy && !latest) return null;

  return (
    <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      <View style={styles.titleRow}>
        <View style={styles.flex}>
          <Text style={[typo.h3, { color: colors.text }]}>확정이익 배분</Text>
          <Text style={[typo.small, { color: colors.textSecondary }]}>
            50 · 30 · 20 계획 · 조회 전용
          </Text>
        </View>
        <Feather name="pie-chart" size={20} color={colors.primary} />
      </View>
      {latest ? (
        <>
          <View style={styles.amountRow}>
            <Text style={[typo.small, { color: colors.textSecondary }]}>최근 승인 배분액</Text>
            <Text
              style={[typo.h2, styles.amount, { color: colors.text }]}
              numberOfLines={1}
              adjustsFontSizeToFit
              minimumFontScale={0.75}
            >
              {Math.round(Number(latest.distributableProfit)).toLocaleString('ko-KR')}원
            </Text>
          </View>
          <View style={styles.itemGrid}>
            {[...latest.items]
              .sort((left, right) => rank(left.destination) - rank(right.destination))
              .map((item) => (
                <View
                  key={item.destination}
                  style={[styles.item, { backgroundColor: colors.background }]}
                >
                  <Text style={[typo.caption, { color: colors.textTertiary }]} numberOfLines={1}>
                    {LABELS[item.destination]} {Math.round(Number(item.weight) * 100)}%
                  </Text>
                  <Text
                    style={[typo.small, styles.itemAmount, { color: colors.text }]}
                    numberOfLines={1}
                    adjustsFontSizeToFit
                    minimumFontScale={0.72}
                  >
                    {Math.round(Number(item.amount)).toLocaleString('ko-KR')}원
                  </Text>
                </View>
              ))}
          </View>
          <Text style={[typo.caption, styles.basis, { color: colors.textTertiary }]}>
            승인 {formatPeriod(latest.periodStart, latest.periodEnd)} · 송금·환전·매수 자동 실행
            없음
          </Text>
        </>
      ) : (
        <Text style={[typo.small, styles.empty, { color: colors.textSecondary }]}>
          활성 정책 v{summary.policy?.version} · 승인된 배분 계획 없음
        </Text>
      )}
    </View>
  );
}

function formatPeriod(start: string, end: string): string {
  const format = (value: string) =>
    new Intl.DateTimeFormat('ko-KR', {
      year: '2-digit',
      month: '2-digit',
      day: '2-digit',
      timeZone: 'Asia/Seoul',
    }).format(new Date(value));
  return `${format(start)}–${format(end)}`;
}

function rank(destination: string): number {
  return destination === 'SPGI' ? 0 : destination === 'VTI' ? 1 : 2;
}

const styles = StyleSheet.create({
  card: { borderRadius: radius.lg, borderWidth: 1, padding: spacing.base, gap: spacing.md },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  flex: { flex: 1, minWidth: 0 },
  amountRow: { gap: spacing.xs },
  amount: { flexShrink: 1 },
  itemGrid: { flexDirection: 'row', gap: spacing.xs },
  item: { flex: 1, minWidth: 0, borderRadius: radius.md, padding: spacing.sm },
  itemAmount: { fontWeight: '700', marginTop: spacing.xs },
  basis: { lineHeight: 18 },
  empty: { paddingVertical: spacing.xs },
});
