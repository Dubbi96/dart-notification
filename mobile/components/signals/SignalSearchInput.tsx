import React, { useCallback } from 'react';
import { View, TextInput, StyleSheet, TouchableOpacity } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '@theme';
import { spacing, radius } from '@theme/spacing';

// 신호 탭 종목 검색 입력(DAR-117) — "특정 종목의 매수·매도 신호 보기" 동선.
// 검색어는 SignalExplorer의 corpName/ticker 클라이언트 필터에 연동된다(서버 키워드 검색 미존재).

interface SignalSearchInputProps {
  value: string;
  onChangeText: (text: string) => void;
}

function SignalSearchInputBase({ value, onChangeText }: SignalSearchInputProps) {
  const { colors, typography: typo } = useTheme();
  const handleClear = useCallback(() => onChangeText(''), [onChangeText]);

  return (
    <View style={styles.wrap}>
      <View style={[styles.searchBar, { backgroundColor: colors.surface, borderColor: colors.borderLight }]}>
        <Feather name="search" size={18} color={colors.textTertiary} />
        <TextInput
          style={[typo.body, styles.input, { color: colors.text }]}
          placeholder="종목명·티커 검색"
          placeholderTextColor={colors.textTertiary}
          value={value}
          onChangeText={onChangeText}
          returnKeyType="search"
          autoCapitalize="none"
          autoCorrect={false}
          accessibilityLabel="신호 종목 검색"
          accessibilityHint="종목명 또는 티커로 매수·매도 신호를 검색하세요"
        />
        {value.length > 0 ? (
          <TouchableOpacity
            onPress={handleClear}
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
            accessibilityRole="button"
            accessibilityLabel="검색어 지우기"
          >
            <Feather name="x-circle" size={18} color={colors.textTertiary} />
          </TouchableOpacity>
        ) : null}
      </View>
    </View>
  );
}

export const SignalSearchInput = React.memo(SignalSearchInputBase);

const styles = StyleSheet.create({
  wrap: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
  },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.base,
    height: 46,
    borderRadius: radius.full,
    borderWidth: 1,
  },
  input: {
    flex: 1,
    paddingVertical: 0,
  },
});
