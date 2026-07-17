import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import { View, Text, FlatList, StyleSheet, TouchableOpacity } from 'react-native';
import { useTheme, MAX_CHIP_FONT_SCALE } from '@theme';
import { spacing, radius } from '@theme/spacing';
import { formatEditionChipLabel } from '@utils/editionDisplay';

import type { DailyEditionSummary } from '@app-types/signal.types';

// 에디션 날짜 스트립(DAR-509, 정본 §3 패턴 A) — 신호 매수 뷰 상단 '고정' 가로 스트립.
// '뉴스처럼 하루하루 넘겨보는' 브라우징의 축: 판단 존재일(최신순) + '오늘' 진입점을 칩으로 나열한다.
//
// 세로 에디션 리스트 '밖'에 고정 배치(제스처 축 분리 — 가로 스트립 vs 세로 리스트 충돌 방지, 정본 §3).
// Fabric(Android) 가로 FlatList 가드: contentContainer gap 미의존(DAR-319) → 칩별 marginRight 로 간격.
// keyExtractor=date(고유), getItemLayout+snapToInterval 로 고정폭 스냅 + 선택 칩 auto-center.
// 빈 날(오늘 미발행)은 딤 처리하고 건수 dot 미표시(억지 발명 금지 — 빈 사유는 상세에서 고지).

const CHIP_WIDTH = 64;
const CHIP_GAP = spacing.sm;
const ITEM_WIDTH = CHIP_WIDTH + CHIP_GAP;

interface StripChip {
  date: string;
  count: number;
  strongBuyCount: number;
  /** 판단 존재일인가 — false 는 합성된 '오늘(미발행)' 칩(딤). */
  hasEdition: boolean;
}

interface EditionDateStripProps {
  /** 판단 존재일 요약 목록(최신순, 빈 날 미포함) — useDailyEditions items. */
  editions: DailyEditionSummary[];
  /** 서버 기준 KST 오늘(YYYYMMDD) — '오늘' 진입 칩 합성·라벨 기준. */
  todayDate: string | null | undefined;
  /** 현재 선택된 에디션 날짜(YYYYMMDD). */
  selectedDate: string | undefined;
  /** 칩 탭 시 선택 변경 콜백. */
  onSelect: (date: string) => void;
  /**
   * DAR-527: '놓친 호'(미열람) 날짜 집합(YYYYMMDD). 이 집합에 든 칩에 뱃지를 표시한다.
   * 열람 기록·기준선·알림계열 OFF 게이팅은 상위(BuyEditionView)가 판정해 넘긴다(스트립은 표시만).
   */
  unreadDates?: ReadonlySet<string>;
}

function EditionDateStripBase({
  editions,
  todayDate,
  selectedDate,
  onSelect,
  unreadDates,
}: EditionDateStripProps) {
  const { colors, typography: typo } = useTheme();
  const listRef = useRef<FlatList<StripChip>>(null);

  const chips = useMemo<StripChip[]>(() => {
    const list: StripChip[] = editions.map((e) => ({
      date: e.date,
      count: e.count,
      strongBuyCount: e.strongBuyCount,
      hasEdition: true,
    }));
    // 오늘이 판단 존재일에 없으면(오늘 미발행) 선두에 딤 '오늘' 칩을 합성 — 뉴스 은유상
    // '오늘 자'를 항상 진입점으로 노출한다(빈 사유는 상세 에디션에서 4분기로 정직 고지).
    if (todayDate && !list.some((c) => c.date === todayDate)) {
      list.unshift({ date: todayDate, count: 0, strongBuyCount: 0, hasEdition: false });
    }
    return list;
  }, [editions, todayDate]);

  const selectedIndex = useMemo(
    () => chips.findIndex((c) => c.date === selectedDate),
    [chips, selectedDate],
  );

  // 선택 칩 auto-center — 좌우 플립·리셋 시 선택 칩을 가운데로. index 유효할 때만.
  useEffect(() => {
    if (selectedIndex < 0) return;
    const id = setTimeout(() => {
      listRef.current?.scrollToIndex({
        index: selectedIndex,
        viewPosition: 0.5,
        animated: true,
      });
    }, 0);
    return () => clearTimeout(id);
  }, [selectedIndex]);

  const getItemLayout = useCallback(
    (_data: ArrayLike<StripChip> | null | undefined, index: number) => ({
      length: ITEM_WIDTH,
      offset: ITEM_WIDTH * index,
      index,
    }),
    [],
  );

  const renderChip = useCallback(
    ({ item }: { item: StripChip }) => {
      const label = formatEditionChipLabel(item.date, todayDate);
      const isSelected = item.date === selectedDate;
      const hasCount = item.hasEdition && item.count > 0;
      const dotColor = item.strongBuyCount > 0 ? colors.primary : colors.textSecondary;
      // DAR-527: '놓친 호' 뱃지 — 미열람 판정은 상위에서 넘어온 집합 멤버십으로만 결정(count>0·기준선·
      // 알림계열 게이팅은 이미 상위에서 반영됨). 선택(열람 중)된 칩은 곧 열람 처리되므로 뱃지 미표시.
      const isUnread = !isSelected && !!unreadDates?.has(item.date);

      // 라벨 색: 선택=강조, 빈 날=딤(textTertiary), 그 외=text.
      const labelColor = isSelected
        ? colors.primaryForeground
        : item.hasEdition
          ? colors.text
          : colors.textTertiary;

      return (
        <TouchableOpacity
          activeOpacity={0.8}
          onPress={() => onSelect(item.date)}
          // testID: 날짜 스트립 칩 앵커(DAR-542 스모크 ② — 에디션 날짜 스트립 탭). 개별 칩은
          // index 로 구분(Maestro tapOn id+index). 선택 상태는 accessibilityState.selected 로 노출.
          testID="edition-date-chip"
          style={[
            styles.chip,
            isSelected
              ? { backgroundColor: colors.primary, borderColor: colors.primary }
              : { backgroundColor: colors.surface, borderColor: colors.borderLight },
          ]}
          accessibilityRole="button"
          accessibilityState={{ selected: isSelected }}
          accessibilityLabel={`${label.a11y} 에디션${
            hasCount ? `, 매수 신호 ${item.count}건` : ', 판단 없음'
          }${isUnread ? ', 안 읽음' : ''}${isSelected ? ', 선택됨' : ''}`}
        >
          {/* DAR-527: '놓친 호' 뱃지 — 칩 우상단 코너 dot(건수 dot 과 위치로 구분). 링으로 칩 배경과 분리. */}
          {isUnread ? (
            <View
              style={[
                styles.unreadBadge,
                { backgroundColor: colors.primary, borderColor: colors.surface },
              ]}
            />
          ) : null}
          <Text
            style={[
              typo.captionMedium,
              {
                color: labelColor,
                fontWeight: isSelected ? '700' : '500',
                flexShrink: 1,
                minWidth: 0,
              },
            ]}
            numberOfLines={1}
            maxFontSizeMultiplier={MAX_CHIP_FONT_SCALE}
            ellipsizeMode="tail"
          >
            {label.primary}
          </Text>
          <View style={styles.countRow}>
            {hasCount ? (
              <>
                <View
                  style={[
                    styles.dot,
                    { backgroundColor: isSelected ? colors.primaryForeground : dotColor },
                  ]}
                />
                <Text
                  style={[
                    typo.small,
                    { color: isSelected ? colors.primaryForeground : colors.textSecondary },
                  ]}
                  maxFontSizeMultiplier={MAX_CHIP_FONT_SCALE}
                >
                  {item.count}
                </Text>
              </>
            ) : (
              // 빈 날/미발행 — dot·건수 미표시(자리만 유지해 칩 높이 정렬).
              <Text
                style={[typo.small, { color: colors.textTertiary }]}
                maxFontSizeMultiplier={MAX_CHIP_FONT_SCALE}
              >
                ·
              </Text>
            )}
          </View>
        </TouchableOpacity>
      );
    },
    [colors, typo, todayDate, selectedDate, onSelect, unreadDates],
  );

  if (chips.length === 0) return null;

  return (
    <View
      testID="edition-date-strip"
      style={[
        styles.container,
        { borderBottomColor: colors.border, backgroundColor: colors.background },
      ]}
    >
      <FlatList
        ref={listRef}
        horizontal
        data={chips}
        renderItem={renderChip}
        keyExtractor={(item) => item.date}
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.listContent}
        getItemLayout={getItemLayout}
        snapToInterval={ITEM_WIDTH}
        snapToAlignment="start"
        decelerationRate="fast"
        // 선택 칩이 화면 밖이라 scrollToIndex 가 실패해도 근사 오프셋으로 폴백(백지·크래시 방지).
        onScrollToIndexFailed={(info) => {
          listRef.current?.scrollToOffset({
            offset: ITEM_WIDTH * info.index,
            animated: true,
          });
        }}
      />
    </View>
  );
}

export const EditionDateStrip = React.memo(EditionDateStripBase);

const styles = StyleSheet.create({
  container: {
    borderBottomWidth: 1,
    paddingVertical: spacing.sm,
  },
  listContent: {
    paddingHorizontal: spacing.lg,
  },
  chip: {
    width: CHIP_WIDTH,
    // DAR-319: 가로 FlatList 는 contentContainer gap 이 Fabric 에서 미적용될 수 있어 marginRight 로 간격.
    marginRight: CHIP_GAP,
    borderRadius: radius.lg,
    borderWidth: 1,
    paddingVertical: spacing.sm,
    alignItems: 'center',
    gap: 2,
  },
  countRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    minHeight: 16,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  // DAR-527: '놓친 호' 미열람 뱃지 — 칩 우상단 코너. 링(borderColor=surface)으로 칩 배경과 분리.
  unreadBadge: {
    position: 'absolute',
    top: 4,
    right: 4,
    width: 8,
    minHeight: 8,
    borderRadius: 4,
    borderWidth: 1.5,
  },
});
