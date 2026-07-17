import React, { useCallback } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Surface } from 'react-native-paper';
import { Feather } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useTheme, MAX_CHIP_FONT_SCALE } from '@theme';
import { spacing, radius } from '@theme/spacing';
import { ymdToMonthDay } from '@utils/editionSummary';
import { formatDday, ddayA11yLabel, isImminentDday, ymdToKoreanMonthDay } from '@utils/dday';
import { useUpcomingEvents } from '@hooks/useUpcomingEvents';

import type { UpcomingEventItem } from '@app-types/upcomingEvent.types';

// DAR-538: 공시발 예정 이벤트 캘린더 v1 — 관심기업 공시에서 추출된 미래 일정
// (배당 기준일·유상증자 청약일·신주 상장 예정일 등)을 D-day 로 보여준다.
// 정직 규약: 서버가 추출 확실 날짜만 내려준다(발명 금지). 이 섹션은 표시할 이벤트가
// 없으면 스스로 사라진다(MarketIndexBadge 패턴) — 게스트·로딩·에러·빈 목록 모두 미표시.
// 각 행은 근거 공시 원문으로 딥링크해 사용자가 날짜를 직접 검증할 수 있게 한다.

const MAX_ITEMS = 5;

interface UpcomingEventsSectionProps {
  /** 로그인 여부 — 관심기업 기반이라 게스트는 미표시(쿼리 비활성). */
  isAuthenticated: boolean;
}

function UpcomingEventRow({ item, isLast }: { item: UpcomingEventItem; isLast: boolean }) {
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

export function UpcomingEventsSection({ isAuthenticated }: UpcomingEventsSectionProps) {
  const { colors, typography: typo } = useTheme();
  const { data } = useUpcomingEvents({ enabled: isAuthenticated });

  const items = data?.items ?? [];
  // 표시할 이벤트가 없으면 섹션 자체를 렌더하지 않는다(게스트·로딩·에러 포함).
  // 홈 위계를 지키면서, '일정 없음'이라는 빈 카드 노이즈도 만들지 않는다.
  if (!isAuthenticated || items.length === 0) return null;

  const visible = items.slice(0, MAX_ITEMS);
  const truncatedCount = items.length - visible.length;

  return (
    <View style={styles.container}>
      <View style={styles.heading}>
        <View style={styles.headingText}>
          <Text style={[typo.bodyMedium, { color: colors.text }]}>예정 이벤트</Text>
          <Text style={[typo.small, { color: colors.textSecondary }]}>
            관심기업 공시로 확인된 일정만 표시해요
          </Text>
        </View>
      </View>
      <Surface
        elevation={0}
        style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}
      >
        {visible.map((item, index) => (
          <UpcomingEventRow
            key={`${item.rcpNo}|${item.kind}|${item.date}`}
            item={item}
            isLast={index === visible.length - 1 && truncatedCount === 0}
          />
        ))}
        {truncatedCount > 0 ? (
          <Text style={[typo.small, styles.truncatedNote, { color: colors.textTertiary }]}>
            가까운 {MAX_ITEMS}건만 표시 · 외 {truncatedCount}건
          </Text>
        ) : null}
      </Surface>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingTop: spacing.lg,
  },
  heading: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    marginBottom: spacing.md,
  },
  headingText: {
    flex: 1,
    gap: 2,
  },
  card: {
    marginHorizontal: spacing.lg,
    borderRadius: radius.lg,
    borderWidth: 1,
    paddingHorizontal: spacing.base,
  },
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
  truncatedNote: {
    textAlign: 'center',
    paddingVertical: spacing.sm,
  },
});
