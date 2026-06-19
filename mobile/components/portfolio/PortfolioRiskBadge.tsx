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
      {/* DAR-356 1순위: 하드룰 위반 — 전폭 솔리드 경보 배너(최상단·아이콘+솔리드 배경).
          빠른 글랜스에서 최고우선 경보를 절대 놓치지 않도록 칩 나열에서 분리·승격한다. */}
      {snapshot.hardRuleBreached ? (
        <View
          style={[styles.alertBanner, { backgroundColor: colors.error }]}
          accessibilityRole="alert"
        >
          <Feather name="alert-triangle" size={16} color={colors.onColor} />
          <View style={styles.alertBody}>
            <Text style={[typo.captionMedium, styles.alertTitle, { color: colors.onColor }]}>
              하드룰 위반 — 즉시 점검 필요
            </Text>
            {snapshot.hardRuleDetail ? (
              <Text style={[typo.small, { color: colors.onColor }]} numberOfLines={2}>
                {snapshot.hardRuleDetail}
              </Text>
            ) : null}
          </View>
        </View>
      ) : null}

      {/* DAR-356 2순위: 당일 손익 · 집중도 1줄 압축('당일 -2.1% · 최대종목 45%'). */}
      <View style={styles.metricsRow}>
        <Feather
          name={hasDailyPnl && (snapshot.dailyPnlPct as number) < 0 ? 'trending-down' : 'trending-up'}
          size={13}
          color={dailyTone}
        />
        <Text style={[typo.small, styles.metricLabel, { color: dailyTone }]}>
          당일 {hasDailyPnl ? formatPnlPercent(snapshot.dailyPnlPct as number) : '—'}
        </Text>
        <Text style={[typo.small, styles.metricSep, { color: colors.textSecondary }]}>·</Text>
        <Feather name="pie-chart" size={13} color={concentrationTone} />
        <Text style={[typo.small, styles.metricLabel, { color: concentrationTone }]}>
          최대종목 {snapshot.topPositionPct.toFixed(0)}%
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: spacing.sm,
  },
  alertBanner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    paddingHorizontal: spacing.base,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
  },
  alertBody: {
    flex: 1,
    gap: 2,
  },
  alertTitle: {
    fontWeight: '700',
  },
  metricsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: spacing.xs,
  },
  metricLabel: {
    fontWeight: '700',
  },
  metricSep: {
    marginHorizontal: spacing.xs,
  },
});
