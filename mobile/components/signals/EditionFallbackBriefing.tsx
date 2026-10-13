import React, { useCallback } from 'react';
import { View, Text, FlatList, StyleSheet, TouchableOpacity } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useTheme } from '@theme';
import { spacing, radius } from '@theme/spacing';
import { Card } from '@components/common/Card';

import type { FallbackBriefingItem } from '@app-types/signal.types';

// 빈 에디션 폴백 '오늘의 주요 공시 브리핑'(DAR-551 BE·DAR-552 FE). '판단'이 아니라 그
// 거래일 주요 공시 top5를 정직 카피(상위 EmptyState) 아래 별도 섹션으로 노출한다 —
// TradingSignal 카드와 다른 시각 언어(배지+한줄요약)를 써서 '판단'으로 오인되지 않게 한다.
// 소량(≤5) 임베디드 리스트라 nested FlatList + scrollEnabled=false 관례를 따른다
// (docs/mobile-design-rules.md R-18/R-19, DisclosureFiledFactsSection 동형).

const keyExtractor = (item: FallbackBriefingItem) => item.rcpNo;

interface RowProps {
  item: FallbackBriefingItem;
  onPress: (rcpNo: string) => void;
}

function BriefingRowBase({ item, onPress }: RowProps) {
  const { colors, typography: typo } = useTheme();
  const handlePress = useCallback(() => onPress(item.rcpNo), [onPress, item.rcpNo]);

  return (
    <TouchableOpacity
      activeOpacity={0.7}
      onPress={handlePress}
      accessibilityRole="button"
      accessibilityLabel={`${item.corpName} ${item.eventLabel}. ${item.summaryLine}`}
    >
      <Card style={styles.row} variant="elevated">
        <View style={styles.rowHeader}>
          <Text style={[typo.bodyMedium, styles.corpName, { color: colors.text }]}>
            {item.corpName}
          </Text>
          <Feather name="chevron-right" size={16} color={colors.textTertiary} />
        </View>
        <View style={[styles.badge, { backgroundColor: colors.surfaceSecondary }]}>
          <Text style={[typo.caption, { color: colors.textSecondary }]}>{item.eventLabel}</Text>
        </View>
        <Text style={[typo.body, styles.summary, { color: colors.textSecondary }]}>
          {item.summaryLine}
        </Text>
      </Card>
    </TouchableOpacity>
  );
}

const BriefingRow = React.memo(BriefingRowBase);

interface EditionFallbackBriefingProps {
  items: FallbackBriefingItem[];
}

function EditionFallbackBriefingBase({ items }: EditionFallbackBriefingProps) {
  const { colors, typography: typo } = useTheme();

  const handlePress = useCallback((rcpNo: string) => {
    router.push(`/disclosure/${rcpNo}`);
  }, []);

  const renderItem = useCallback(
    ({ item }: { item: FallbackBriefingItem }) => <BriefingRow item={item} onPress={handlePress} />,
    [handlePress],
  );

  if (items.length === 0) return null;

  return (
    <View style={styles.section} testID="edition-fallback-briefing">
      <View style={styles.header}>
        <Feather name="file-text" size={16} color={colors.primary} />
        <Text
          style={[typo.bodyMedium, styles.sectionTitle, { color: colors.text }]}
          accessibilityRole="header"
        >
          {`오늘의 주요 공시 ${items.length}건`}
        </Text>
      </View>
      <FlatList
        data={items}
        scrollEnabled={false}
        keyExtractor={keyExtractor}
        renderItem={renderItem}
        ItemSeparatorComponent={() => <View style={styles.separator} />}
      />
    </View>
  );
}

export const EditionFallbackBriefing = React.memo(EditionFallbackBriefingBase);

const styles = StyleSheet.create({
  section: {
    width: '100%',
    marginTop: spacing.xl,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacing.md,
  },
  sectionTitle: { flex: 1, minWidth: 0, marginLeft: spacing.xs },
  separator: {
    height: spacing.sm,
  },
  row: {
    minHeight: 48,
    padding: spacing.md,
  },
  rowHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  badge: {
    alignSelf: 'flex-start',
    maxWidth: '100%',
    marginTop: spacing.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: radius.sm,
  },
  corpName: {
    flex: 1,
    flexShrink: 1,
    minWidth: 0,
  },
  summary: {
    marginTop: spacing.sm,
  },
});
