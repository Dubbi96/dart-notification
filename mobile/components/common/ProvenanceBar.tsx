import React from 'react';
import { View, Text, StyleSheet, type ViewStyle } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { formatDistanceToNow } from 'date-fns';
import { ko } from 'date-fns/locale';
import { useTheme } from '@theme';
import { spacing } from '@theme/spacing';

// 출처·시점 상시 노출 바(기획 §7). "언제·무엇 기준" 데이터인지 항상 보이게 한다.
// 캐시된 구버전 데이터 식별 + stale 경고. 색상 단독 금지 — 아이콘 형태로도 stale 구분.

export interface ProvenanceItem {
  icon: 'clock' | 'database' | 'hash' | 'calendar';
  /** 예: '분석 2분 전', '시세 14:32 기준', '룰 v1.2' */
  label: string;
  /** true이면 warning 색상 + alert-circle 아이콘으로 승격 */
  stale?: boolean;
}

interface ProvenanceBarProps {
  items: ProvenanceItem[];
  style?: ViewStyle;
}

/** ISO 시각 → '2분 전' 같은 상대 표현(한국어). */
export function relativeTime(iso: string): string {
  return formatDistanceToNow(new Date(iso), { addSuffix: true, locale: ko });
}

/** 시세 신선도: 마지막 시세 시각으로부터 15분 초과 시 stale(§7). */
export function isPriceStale(priceAt: string | undefined): boolean {
  if (!priceAt) return false;
  const diffMin = (Date.now() - new Date(priceAt).getTime()) / 1000 / 60;
  return diffMin > 15;
}

export function ProvenanceBar({ items, style }: ProvenanceBarProps) {
  const { colors, typography: typo } = useTheme();
  const visible = items.filter((it) => it.label && it.label.trim().length > 0);
  if (visible.length === 0) return null;

  return (
    <View
      style={[styles.container, style]}
      accessibilityLabel={`데이터 출처 — ${visible
        .map((it) => `${it.label}${it.stale ? ' (오래됨)' : ''}`)
        .join(', ')}`}
    >
      {visible.map((item, idx) => {
        const stale = item.stale === true;
        const iconColor = stale ? colors.warning : colors.textSecondary;
        const iconName = stale ? 'alert-circle' : item.icon;
        return (
          <View key={`${item.icon}-${idx}-${item.label}`} style={styles.itemRow}>
            {idx > 0 ? (
              <Text style={[typo.small, styles.divider, { color: colors.textTertiary }]}>·</Text>
            ) : null}
            <Feather name={iconName} size={12} color={iconColor} />
            <Text
              style={[
                typo.small,
                { color: stale ? colors.warning : colors.textSecondary },
              ]}
            >
              {item.label}
            </Text>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
  },
  itemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  divider: {
    marginHorizontal: spacing.xs,
  },
});
