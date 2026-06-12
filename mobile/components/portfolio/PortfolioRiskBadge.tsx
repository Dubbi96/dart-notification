import React, { useMemo } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '@theme';
import { spacing, radius } from '@theme/spacing';
import { pnlColor, formatPnlPercent } from '@utils/signalDisplay';

import type { PortfolioRiskSnapshot } from '@app-types/portfolio.types';

/**
 * 포트폴리오 리스크 배지 (DAR-163) — `GET /portfolio/risk/latest` 소비.
 *
 * 활성 포트폴리오 최신 스냅샷의 당일 손익(색상)·집중도(최대 종목 비중 %)·
 * 하드룰 위반 경고 칩을 한 줄로 노출한다. 스냅샷이 없으면(null) 아무것도
 * 렌더하지 않는다(빈상태 미표시) — 화면이 깨지지 않도록 한다.
 *
 * ★읽기 전용 표시 컴포넌트. Engine5 Risk 하드룰 산출 로직은 침범하지 않는다.
 * 색상 단독 의미전달 금지(접근성): 색상 + 아이콘 + 텍스트 레이블 병행.
 */

interface PortfolioRiskBadgeProps {
  snapshot: PortfolioRiskSnapshot | null | undefined;
  style?: object;
}

export function PortfolioRiskBadge({ snapshot, style }: PortfolioRiskBadgeProps) {
  const { colors, typography: typo } = useTheme();

  const a11yLabel = useMemo(() => {
    if (!snapshot) return '';
    const parts: string[] = [];
    if (snapshot.dailyPnlPct != null) {
      parts.push(`당일 손익 ${formatPnlPercent(snapshot.dailyPnlPct)}`);
    }
    parts.push(`최대 종목 비중 ${snapshot.topPositionPct.toFixed(0)}퍼센트`);
    if (snapshot.hardRuleBreached) {
      parts.push(`하드룰 위반${snapshot.hardRuleDetail ? `: ${snapshot.hardRuleDetail}` : ''}`);
    }
    return `포트폴리오 리스크 — ${parts.join(', ')}`;
  }, [snapshot]);

  if (!snapshot) return null;

  const hasDailyPnl = snapshot.dailyPnlPct != null;
  const dailyTone = hasDailyPnl ? pnlColor(snapshot.dailyPnlPct as number, colors) : colors.textSecondary;
  // 집중도: 40% 이상은 경고 톤으로 강조(단일 종목 과집중).
  const concentrated = snapshot.topPositionPct >= 40;
  const concentrationTone = concentrated ? colors.warning : colors.textSecondary;

  return (
    <View
      style={[styles.container, style]}
      accessible
      accessibilityLabel={a11yLabel}
    >
      <View style={styles.row}>
        {/* 당일 손익 */}
        <View style={[styles.chip, { backgroundColor: dailyTone + '1A', borderColor: dailyTone }]}>
          <Feather
            name={hasDailyPnl && (snapshot.dailyPnlPct as number) < 0 ? 'trending-down' : 'trending-up'}
            size={12}
            color={dailyTone}
          />
          <Text style={[typo.small, styles.chipLabel, { color: dailyTone }]}>
            당일 {hasDailyPnl ? formatPnlPercent(snapshot.dailyPnlPct as number) : '—'}
          </Text>
        </View>

        {/* 집중도(최대 종목 비중) */}
        <View style={[styles.chip, { backgroundColor: concentrationTone + '1A', borderColor: concentrationTone }]}>
          <Feather name="pie-chart" size={12} color={concentrationTone} />
          <Text style={[typo.small, styles.chipLabel, { color: concentrationTone }]}>
            집중도 {snapshot.topPositionPct.toFixed(0)}%
          </Text>
        </View>

        {/* 하드룰 위반 경고 */}
        {snapshot.hardRuleBreached ? (
          <View style={[styles.chip, { backgroundColor: colors.error + '1A', borderColor: colors.error }]}>
            <Feather name="alert-triangle" size={12} color={colors.error} />
            <Text style={[typo.small, styles.chipLabel, { color: colors.error }]}>
              하드룰 위반
            </Text>
          </View>
        ) : null}
      </View>

      {/* 하드룰 위반 상세(있을 때만) */}
      {snapshot.hardRuleBreached && snapshot.hardRuleDetail ? (
        <Text style={[typo.small, { color: colors.error, marginTop: spacing.xs }]}>
          {snapshot.hardRuleDetail}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: spacing.xs,
  },
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: spacing.xs,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: radius.sm,
    borderWidth: 1,
  },
  chipLabel: {
    fontWeight: '700',
    marginLeft: spacing.xs,
  },
});
