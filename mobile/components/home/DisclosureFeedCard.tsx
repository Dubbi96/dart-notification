import React, { useCallback, useMemo } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { router } from 'expo-router';
import { useTheme } from '@theme';
import { spacing, radius } from '@theme/spacing';
import { Card } from '@components/common/Card';
import { getTypeStyle, getTypeLabel } from '@utils/disclosureType';
import { formatYmdDots } from '@utils/datetime';

import type { Disclosure } from '@app-types/disclosure.types';

interface DisclosureFeedCardProps {
  item: Disclosure;
}

/**
 * 홈 공시 피드 카드(DAR-107 화면감사 #8).
 * FlatList 가상화/성능 규칙 준수:
 * - `React.memo`로 불필요 리렌더 차단(item 참조 안정 시 스킵).
 * - `onPress`·파생값은 `useCallback`/`useMemo`로 안정화(인라인 함수 제거).
 * - 정적 레이아웃은 `StyleSheet`, 테마 의존 색상만 동적 병합.
 */
function DisclosureFeedCardComponent({ item }: DisclosureFeedCardProps) {
  const { colors, typography: typo, isDark } = useTheme();

  const handlePress = useCallback(() => {
    router.push(`/disclosure/${item.rcpNo}`);
  }, [item.rcpNo]);

  const typeStyle = useMemo(
    () => getTypeStyle(item.disclosureType, isDark),
    [item.disclosureType, isDark],
  );

  const formattedDate = useMemo(
    () => formatYmdDots(item.rcpDt),
    [item.rcpDt],
  );

  return (
    <TouchableOpacity activeOpacity={0.7} onPress={handlePress}>
      <Card style={styles.disclosureCard} variant="elevated">
        <View style={styles.disclosureHeader}>
          <View style={[styles.typeBadge, { backgroundColor: typeStyle.bg }]}>
            <Text style={[typo.small, styles.typeBadgeText, { color: typeStyle.text }]}>
              {getTypeLabel(item.disclosureType)}
            </Text>
          </View>
          <Text style={[typo.small, { color: colors.textTertiary }]}>{formattedDate}</Text>
        </View>
        <Text
          style={[typo.bodyMedium, styles.reportName, { color: colors.text }]}
          numberOfLines={2}
        >
          {item.reportName}
        </Text>
        <Text
          style={[typo.caption, styles.corpName, { color: colors.textSecondary }]}
          numberOfLines={1}
        >
          {item.corpName}
        </Text>
      </Card>
    </TouchableOpacity>
  );
}

export const DisclosureFeedCard = React.memo(DisclosureFeedCardComponent);

const styles = StyleSheet.create({
  disclosureCard: {
    marginBottom: 0,
  },
  disclosureHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  typeBadge: {
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: radius.sm,
  },
  typeBadgeText: {
    fontWeight: '600',
  },
  reportName: {
    marginTop: spacing.sm,
  },
  corpName: {
    marginTop: spacing.xs,
  },
});
