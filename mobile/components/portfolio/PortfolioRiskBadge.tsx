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
 * 활성 포트폴리오 최신 스냅샷의 당일 손익·집중도(최대 종목 비중 %)와
 * 하드룰 위반 경고를 자연 높이로 노출한다. 스냅샷이 없으면(null) 아무것도
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
  const dailyTone = hasDailyPnl
    ? pnlColor(snapshot.dailyPnlPct as number, colors)
    : colors.textSecondary;
  // 집중도: 40% 이상은 경고 톤으로 강조(단일 종목 과집중).
  const concentrated = snapshot.topPositionPct >= 40;
  const concentrationTone = concentrated ? colors.warning : colors.textSecondary;

  return (
    <View style={[styles.container, style]} accessible accessibilityLabel={a11yLabel}>
      {/* 하드룰 경보는 먼저 표시하며, 상세 사유를 말줄임하지 않는다. */}
      {snapshot.hardRuleBreached ? (
        <View
          style={[
            styles.alertBanner,
            { backgroundColor: colors.errorSurface, borderColor: colors.error },
          ]}
          accessibilityRole="alert"
        >
          <Feather name="alert-triangle" size={16} color={colors.error} />
          <View style={styles.alertBody}>
            <Text style={[typo.captionMedium, styles.alertTitle, { color: colors.text }]}>
              하드룰 위반 — 즉시 점검 필요
            </Text>
            {snapshot.hardRuleDetail ? (
              <Text style={[typo.caption, { color: colors.text }]}>{snapshot.hardRuleDetail}</Text>
            ) : null}
          </View>
        </View>
      ) : null}

      {/* 아이콘과 수치를 한 묶음으로 줄바꿈해 좁은 화면에서도 관계를 유지한다. */}
      <View style={styles.metricsRow}>
        <View style={styles.metric}>
          <Feather
            name={
              hasDailyPnl && (snapshot.dailyPnlPct as number) < 0 ? 'trending-down' : 'trending-up'
            }
            size={13}
            color={dailyTone}
          />
          <Text style={[typo.caption, styles.metricLabel, { color: colors.text }]}>
            당일 {hasDailyPnl ? formatPnlPercent(snapshot.dailyPnlPct as number) : '—'}
          </Text>
        </View>
        <View style={styles.metric}>
          <Feather name="pie-chart" size={13} color={concentrationTone} />
          <Text style={[typo.caption, styles.metricLabel, { color: colors.text }]}>
            최대종목 {snapshot.topPositionPct.toFixed(0)}%
          </Text>
        </View>
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
    borderWidth: 1,
  },
  alertBody: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  alertTitle: {
    fontWeight: '700',
  },
  metricsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: spacing.md,
  },
  metric: {
    flexDirection: 'row',
    alignItems: 'center',
    maxWidth: '100%',
    gap: spacing.xs,
  },
  metricLabel: {
    fontWeight: '700',
    flexShrink: 1,
  },
});
