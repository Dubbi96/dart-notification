import React, { useCallback } from 'react';
import { View, TextInput, StyleSheet } from 'react-native';
import { Chip } from 'react-native-paper';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '@theme';
import { spacing, radius } from '@theme/spacing';

export type SortKey = 'pnl' | 'urgency' | 'weight';

interface SortOption {
  key: SortKey;
  label: string;
}

const SORT_OPTIONS: SortOption[] = [
  { key: 'pnl', label: '손익순' },
  { key: 'urgency', label: '시급도순' },
  { key: 'weight', label: '비중순' },
];

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
              onPress={makeSortHandler(opt.key)}
              style={[
                styles.sortChip,
                selected && { backgroundColor: colors.primary },
              ]}
              textStyle={[
                typo.small,
                { color: selected ? colors.primaryForeground : colors.textSecondary },
              ]}
            >
              {opt.label}
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
    height: 28,
  },
});
