import React, { useCallback } from 'react';
import { View, TextInput, StyleSheet } from 'react-native';
import { Chip } from 'react-native-paper';
import { Feather } from '@expo/vector-icons';
import { useTheme, MAX_CHIP_FONT_SCALE } from '@theme';
import { spacing, radius } from '@theme/spacing';

export type SortKey = 'pnl' | 'urgency' | 'weight';

interface SortOption {
  key: SortKey;
  label: string;
  // DAR-472: 스크린리더가 읽는 정렬 방향 설명. 손익·비중은 순수 수치 내림차순이지만
  // 시급도순은 상태 우선순위(VIOLATED·EXPIRED 먼저) 기반이라 '내림차순'으로 읽으면 부정확
  // (실제 정렬: app/(tabs)/portfolio STATUS_ORDER → 동점 시 exitScore 내림차순). 실제 기준을 읽어준다.
  a11ySortDirection: string;
}

const SORT_OPTIONS: SortOption[] = [
  { key: 'pnl', label: '손익순', a11ySortDirection: '내림차순 정렬' },
  { key: 'urgency', label: '시급도순', a11ySortDirection: '시급한 종목 먼저' },
  { key: 'weight', label: '비중순', a11ySortDirection: '내림차순 정렬' },
];

// DAR-470: 정렬 방향 인디케이터. 세 정렬 모두 '높은/시급한 값이 위'로 정렬되어 ▼ 글리프를
// 병기해 탭 전에도 방향을 예측 가능하게 한다(손익·비중 = 큰 값 위, 시급도 = VIOLATED·EXPIRED 위).
// ▼ 는 장식이며 스크린리더는 accessibilityLabel(옵션별 a11ySortDirection)을 읽는다 —
// 글리프 단독 의미전달 금지(색·기호·텍스트 병행 규칙).
const DESCENDING_INDICATOR = '▼';

interface PositionSearchBarProps {
  value: string;
  onChangeText: (text: string) => void;
  sortKey: SortKey;
  onSortChange: (key: SortKey) => void;
}

export function PositionSearchBar({ value, onChangeText, sortKey, onSortChange }: PositionSearchBarProps) {
  const { colors, typography: typo } = useTheme();

  const makeSortHandler = useCallback(
    (key: SortKey) => () => onSortChange(key),
    [onSortChange],
  );

  return (
    <View style={styles.container}>
      <View style={[styles.inputRow, { borderColor: colors.border, borderRadius: radius.md, backgroundColor: colors.surface }]}>
        <Feather name="search" size={16} color={colors.textSecondary} />
        <TextInput
          value={value}
          onChangeText={onChangeText}
          placeholder="종목명·티커 검색"
          placeholderTextColor={colors.textSecondary}
          style={[typo.bodyMedium, styles.input, { color: colors.text }]}
          returnKeyType="search"
          autoCapitalize="none"
          autoCorrect={false}
        />
      </View>

      <View style={styles.chipRow}>
        {SORT_OPTIONS.map((opt) => {
          const selected = sortKey === opt.key;
          return (
            <Chip
              key={opt.key}
              compact
              mode={selected ? 'flat' : 'outlined'}
              // DAR-305: 고정 높이 칩 — OS 글꼴 확대 시 한글 받침 세로 클리핑 방지 배율 상한(DAR-174 정본).
              maxFontSizeMultiplier={MAX_CHIP_FONT_SCALE}
              onPress={makeSortHandler(opt.key)}
              accessibilityRole="button"
              accessibilityState={{ selected }}
              accessibilityLabel={`${opt.label}, ${opt.a11ySortDirection}`}
              style={[
                styles.sortChip,
                selected && { backgroundColor: colors.primary },
              ]}
              textStyle={[
                typo.small,
                { color: selected ? colors.primaryForeground : colors.textSecondary },
              ]}
            >
              {`${opt.label} ${DESCENDING_INDICATOR}`}
            </Chip>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
    gap: spacing.sm,
  },
  input: {
    flex: 1,
    padding: 0,
  },
  chipRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  sortChip: {
    // DAR-305: 고정 height → minHeight. 캡된 큰 글꼴에서도 칩이 늘어나 받침이 잘리지 않는다(평시 동일).
    minHeight: 28,
  },
});
