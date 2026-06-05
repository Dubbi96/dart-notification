import React from 'react';
import { View, Text, ActivityIndicator, StyleSheet } from 'react-native';
import { useTheme } from '@theme';
import { spacing } from '@theme/spacing';

// 무한스크롤 리스트 푸터 통일 컴포넌트 (DAR-45 §1).
// - 다음 페이지 로딩 중: 스피너
// - 끝 도달(더 불러올 페이지 없음 + 항목 존재): "마지막 공시입니다" 종료 표시
// 홈/전체공시 FlatList의 ListFooterComponent를 이 컴포넌트로 통일한다.

interface InfiniteListFooterProps {
  isFetchingNextPage: boolean;
  hasNextPage: boolean;
  itemCount: number;
  /** 끝 도달 시 표시할 문구 (기본: "마지막 공시입니다") */
  endLabel?: string;
}

export function InfiniteListFooter({
  isFetchingNextPage,
  hasNextPage,
  itemCount,
  endLabel = '마지막 공시입니다',
}: InfiniteListFooterProps) {
  const { colors, typography: typo } = useTheme();

  if (isFetchingNextPage) {
    return <ActivityIndicator style={styles.spinner} color={colors.primary} />;
  }

  // 항목이 있고 더 이상 불러올 페이지가 없을 때만 종료 표시.
  if (!hasNextPage && itemCount > 0) {
    return (
      <View style={styles.endContainer}>
        <Text style={[typo.small, { color: colors.textTertiary }]}>{endLabel}</Text>
      </View>
    );
  }

  return null;
}

const styles = StyleSheet.create({
  spinner: {
    paddingVertical: spacing.lg,
  },
  endContainer: {
    paddingVertical: spacing.lg,
    alignItems: 'center',
  },
});
