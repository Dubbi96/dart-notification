import React, { useMemo } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '@theme';
import { spacing, radius } from '@theme/spacing';

import type { StockRiskStatus } from '@app-types/stock-status.types';

/**
 * 종목 위험 배지 (DAR-99) — 관리종목·거래정지·상폐위험.
 *
 * ★안전 1차 방어선(손실 회피). KRX 데이터마켓 승인 전까지 DART 공시 폴백으로 도출한
 * 근사값이므로 '근사값 (DART 공시 기반)' 라벨을 필수로 병기한다(KRX 정밀 실시간 아님 명시).
 *
 * 표시 규칙:
 *  - 거래정지   ← isHalted        (error)
 *  - 상폐위험   ← isDelistingRisk (error)
 *  - 관리종목   ← isManagement 이며 상폐위험 아님(감사의견 등) (warning)
 *  - 위험 없음 시 아무것도 렌더하지 않는다(빈상태 미표시).
 *
 * 색상 단독 의미전달 금지(접근성): 색상 + 아이콘 + 텍스트 레이블 병행.
 */

interface RiskBadge {
  key: string;
  label: string;
  icon: keyof typeof Feather.glyphMap;
  /** true = 심각(error 톤) / false = 경고(warning 톤) */
  severe: boolean;
}

function deriveBadges(status: StockRiskStatus | undefined | null): RiskBadge[] {
  if (!status) return [];
  const badges: RiskBadge[] = [];
  if (status.isHalted) {
    badges.push({ key: 'halted', label: '거래정지', icon: 'slash', severe: true });
  }
  if (status.isDelistingRisk) {
    badges.push({ key: 'delisting', label: '상폐위험', icon: 'alert-octagon', severe: true });
  }
  // 상폐위험으로 이미 표기된 관리종목은 중복 표기하지 않는다(감사의견 등 그 외 관리종목 사유만).
  if (status.isManagement && !status.isDelistingRisk) {
    badges.push({ key: 'management', label: '관리종목', icon: 'alert-triangle', severe: false });
  }
  return badges;
}

/**
 * 위험상태 접근성 요약 문자열 (DAR-99). 카드가 no-hide-descendants 로 자식 a11y 를
 * 가릴 때, 카드 자체 accessibilityLabel 에 위험을 합성하기 위한 짧은 요약. 위험 없으면 null.
 */
export function summarizeRiskStatus(status: StockRiskStatus | undefined | null): string | null {
  const badges = deriveBadges(status);
  if (badges.length === 0) return null;
  return `위험: ${badges.map((b) => b.label).join(', ')} (근사값, DART 공시 기반)`;
}

interface RiskStatusBadgesProps {
  status: StockRiskStatus | undefined | null;
  /** 카드 인라인용 압축 모드(작은 배지·짧은 라벨). 기본 false(상세 화면). */
  compact?: boolean;
  style?: object;
}

export function RiskStatusBadges({ status, compact = false, style }: RiskStatusBadgesProps) {
  const { colors, typography: typo } = useTheme();
  const badges = useMemo(() => deriveBadges(status), [status]);

  if (badges.length === 0) return null;

  const approxLabel = compact ? '근사값(DART)' : '근사값 (DART 공시 기반)';

  return (
    <View
      style={[styles.container, style]}
      accessible
      accessibilityLabel={`종목 위험상태: ${badges.map((b) => b.label).join(', ')}. 근사값, DART 공시 기반 도출.`}
    >
      <View style={styles.badgeRow}>
        {badges.map((b) => {
          const tone = b.severe ? colors.error : colors.warning;
          return (
            <View
              key={b.key}
              style={[
                styles.badge,
                compact && styles.badgeCompact,
                { backgroundColor: tone + '22', borderColor: tone },
              ]}
            >
              <Feather name={b.icon} size={compact ? 11 : 13} color={tone} />
              <Text
                style={[
                  compact ? typo.small : typo.captionMedium,
                  { color: tone, fontWeight: '700', marginLeft: spacing.xs },
                ]}
              >
                {b.label}
              </Text>
            </View>
          );
        })}
      </View>

      {/* ★근사값 라벨 필수 — KRX 정밀 실시간 아님(DART 공시 기반 도출) */}
      <View style={styles.approxRow}>
        <Feather name="info" size={compact ? 10 : 12} color={colors.textTertiary} />
        <Text style={[typo.small, { color: colors.textTertiary, marginLeft: spacing.xs, flex: 1 }]}>
          {approxLabel}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: spacing.xs,
  },
  badgeRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: spacing.xs,
  },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: radius.sm,
    borderWidth: 1,
  },
  badgeCompact: {
    paddingHorizontal: spacing.xs + 2,
    paddingVertical: 2,
  },
  approxRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
});
