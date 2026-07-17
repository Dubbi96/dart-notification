import React, { useCallback, useMemo } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { router } from 'expo-router';
import { useTheme, MAX_CHIP_FONT_SCALE } from '@theme';
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

  const formattedDate = useMemo(() => formatYmdDots(item.rcpDt), [item.rcpDt]);

  // DAR-446(A-HOME-6): 카드 전체를 단일 버튼으로 읽히도록 요약 a11y 라벨을 구성한다.
  // 내부 텍스트(유형/날짜/보고서명/기업명)는 no-hide-descendants 로 묶어 중복 읽기를 막는다.
  const accessibilityLabel = useMemo(
    () =>
      `${item.corpName}, ${getTypeLabel(item.disclosureType)}, ${item.reportName}, ${formattedDate}, 공시 상세 보기`,
    [item.corpName, item.disclosureType, item.reportName, formattedDate],
  );

  return (
    <TouchableOpacity
      activeOpacity={0.7}
      onPress={handlePress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      testID="disclosure-feed-card"
    >
      <Card style={styles.disclosureCard} variant="elevated">
        <View style={styles.disclosureBody} importantForAccessibility="no-hide-descendants">
          <View style={styles.disclosureHeader}>
            <View style={[styles.typeBadge, { backgroundColor: typeStyle.bg }]}>
              <Text
                style={[typo.small, styles.typeBadgeText, { color: typeStyle.text }]}
                maxFontSizeMultiplier={MAX_CHIP_FONT_SCALE}
              >
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
            style={[
              typo.caption,
              styles.corpName,
              { color: colors.textSecondary, flexShrink: 1, minWidth: 0 },
            ]}
            numberOfLines={1}
            ellipsizeMode="tail"
          >
            {item.corpName}
          </Text>
        </View>
      </Card>
    </TouchableOpacity>
  );
}

export const DisclosureFeedCard = React.memo(DisclosureFeedCardComponent);

const styles = StyleSheet.create({
  disclosureCard: {
    marginBottom: 0,
  },
  // A-HOME-6: a11y 그룹핑 래퍼 — 레이아웃 영향 없는 패스스루 블록(자식 중복 읽기 차단).
  disclosureBody: {
    width: '100%',
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
