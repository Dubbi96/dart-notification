import React, { useCallback } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useTheme, MAX_CHIP_FONT_SCALE } from '@theme';
import { spacing, radius } from '@theme/spacing';
import { ymdToMonthDay } from '@utils/editionSummary';
import { formatDday, ddayA11yLabel, isImminentDday, ymdToKoreanMonthDay } from '@utils/dday';

import type { UpcomingEventItem } from '@app-types/upcomingEvent.types';

// DAR-541: 예정 이벤트 행 — 홈 섹션(UpcomingEventsSection)과 전체 화면
// (app/upcoming-events)이 공유하는 단일 정의(이중 정의·표기 드리프트 방지).
// D-day 값은 서버(baseDate 기준)가 계산한 것을 그대로 표시한다(시계 이원화 금지).
// 각 행은 근거 공시 원문으로 딥링크해 사용자가 날짜를 직접 검증할 수 있게 한다.

interface UpcomingEventRowProps {
  item: UpcomingEventItem;
  /** 카드/리스트 마지막 행이면 하단 구분선을 그리지 않는다. */
  isLast: boolean;
}

function UpcomingEventRowBase({ item, isLast }: UpcomingEventRowProps) {
  const { colors, typography: typo } = useTheme();
  const handlePress = useCallback(() => {
    router.push(`/disclosure/${item.rcpNo}`);
  }, [item.rcpNo]);

  const imminent = isImminentDday(item.dDay);
  const dateLabel = ymdToMonthDay(item.date);
  const dateSpoken = ymdToKoreanMonthDay(item.date);

  return (
    <TouchableOpacity
      onPress={handlePress}
      activeOpacity={0.7}
      style={[
        styles.row,
        !isLast && {
          borderBottomWidth: StyleSheet.hairlineWidth,
          borderBottomColor: colors.borderLight,
        },
      ]}
      accessibilityRole="button"
      accessibilityLabel={`${item.corpName} ${item.label}${
        dateSpoken ? ` ${dateSpoken}` : ''
      }, ${ddayA11yLabel(item.dDay)}, 근거 공시 열기`}
    >
      <View
        style={[
          styles.ddayChip,
          { backgroundColor: imminent ? colors.warningSurface : colors.surfaceSecondary },
        ]}
      >
        <Text
          style={[
            typo.captionMedium,
            { color: imminent ? colors.warning : colors.primary, fontWeight: '700' },
          ]}
          numberOfLines={1}
          maxFontSizeMultiplier={MAX_CHIP_FONT_SCALE}
        >
          {formatDday(item.dDay)}
        </Text>
      </View>
      <View style={styles.rowText}>
        <Text style={[typo.bodyMedium, { color: colors.text }]} numberOfLines={1}>
          {item.corpName}
        </Text>
        <Text style={[typo.small, { color: colors.textSecondary }]} numberOfLines={1}>
          {item.label}
        </Text>
      </View>
      {dateLabel ? (
        <Text style={[typo.captionMedium, { color: colors.textSecondary }]} numberOfLines={1}>
          {dateLabel}
        </Text>
      ) : null}
      <Feather name="chevron-right" size={16} color={colors.textTertiary} />
    </TouchableOpacity>
  );
}

// 부모 리렌더(리스트 스크롤·상위 상태 변화) 시 item/isLast 불변이면 행 재렌더를 막는다.
export const UpcomingEventRow = React.memo(UpcomingEventRowBase);

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.md,
    minHeight: 44,
  },
  ddayChip: {
    minWidth: 52,
    alignItems: 'center',
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: radius.full,
  },
  rowText: {
    flex: 1,
    gap: 2,
  },
});
