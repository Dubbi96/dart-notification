import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { HelpButton } from '@components/common/HelpButton';
import { useTheme } from '@theme';
import { radius, spacing } from '@theme/spacing';

import type { AosAllocationSummary } from '@app-types/allocation.types';
import type { InfoSheetSection } from '@components/common/InfoSheet';

interface Props {
  summary: AosAllocationSummary;
}

const LABELS = { SPGI: 'SPGI', VTI: 'VTI', SYSTEM_TRADING: '시스템' } as const;
const HELP_SECTIONS: InfoSheetSection[] = [
  {
    heading: '배분 계획',
    body: '시스템 트레이딩에서 결산한 확정이익을 나누는 계획입니다. 항목별 비중과 금액은 승인된 계획을 기준으로 표시합니다.',
  },
  {
    heading: '자금 분리와 실행 범위',
    body: '장기투자(SPGI·VTI)와 시스템 트레이딩 자금은 분리합니다. 이 화면은 계획 조회용이며 송금·환전·매수를 자동 실행하지 않습니다.',
  },
];

export function AllocationSummaryCard({ summary }: Props) {
  const { colors, typography: typo } = useTheme();
  const latest = summary.plans[0];
  if (!summary.policy && !latest) return null;

  return (
    <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      <View style={styles.titleRow}>
        <View style={styles.flex}>
          <Text style={[typo.h2, { color: colors.text }]}>확정이익 배분</Text>
          <Text style={[typo.caption, { color: colors.textSecondary }]}>
            조회 전용 · 자동 이체·매수 없음
          </Text>
        </View>
        <HelpButton title="확정이익 배분" sections={HELP_SECTIONS} />
      </View>
      {latest ? (
        <>
          <View style={styles.amountRow}>
            <Text style={[typo.caption, { color: colors.textSecondary }]}>최근 승인 배분액</Text>
            <Text style={[typo.h2, styles.amount, { color: colors.text }]}>
              {Math.round(Number(latest.distributableProfit)).toLocaleString('ko-KR')}원
            </Text>
          </View>
          <View style={styles.itemGrid}>
            {[...latest.items]
              .sort((left, right) => rank(left.destination) - rank(right.destination))
              .map((item) => (
                <View
                  key={item.destination}
                  style={[styles.item, { borderTopColor: colors.border }]}
                >
                  <Text style={[typo.caption, { color: colors.textSecondary }]}>
                    {LABELS[item.destination]} {Math.round(Number(item.weight) * 100)}%
                  </Text>
                  <Text style={[typo.bodyMedium, styles.itemAmount, { color: colors.text }]}>
                    {Math.round(Number(item.amount)).toLocaleString('ko-KR')}원
                  </Text>
                </View>
              ))}
          </View>
          <Text style={[typo.caption, { color: colors.textSecondary }]}>
            배분 기간 {formatPeriod(latest.periodStart, latest.periodEnd)}
          </Text>
        </>
      ) : (
        <View style={styles.amountRow}>
          <Text style={[typo.caption, styles.empty, { color: colors.textSecondary }]}>
            정책 v{summary.policy?.version} · 승인된 계획 없음
          </Text>
          <Text style={[typo.caption, { color: colors.text }]}>
            SPGI {Math.round(Number(summary.policy?.spgiWeight) * 100)}% · VTI{' '}
            {Math.round(Number(summary.policy?.vtiWeight) * 100)}% · 시스템{' '}
            {Math.round(Number(summary.policy?.systemTradingWeight) * 100)}%
          </Text>
        </View>
      )}
      <Text style={[typo.caption, { color: colors.textSecondary }]}>
        장기자금으로 트레이딩 손실 자동 보전 금지
      </Text>
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
  titleRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md },
  flex: { flex: 1, minWidth: 0 },
  amountRow: { gap: spacing.xs },
  amount: { flexShrink: 1 },
  itemGrid: { gap: spacing.sm },
  item: { minWidth: 0, borderTopWidth: StyleSheet.hairlineWidth, paddingTop: spacing.sm },
  itemAmount: { fontWeight: '700', marginTop: spacing.xs },
  empty: { paddingVertical: spacing.xs },
});
