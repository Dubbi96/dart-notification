import React, { useCallback } from 'react';
import { View, Text, FlatList, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { useTheme } from '@theme';
import { spacing } from '@theme/spacing';
import { PhilosophyMasterCard } from '@components/philosophy/PhilosophyMasterCard';
import { DisclaimerSection } from '@components/common/DisclaimerSection';
import { ScreenHeader } from '@components/common/ScreenHeader';
import { LoadingState, EmptyState, ApiErrorState } from '@components/common/StateView';
import { usePhilosophies } from '@hooks/usePhilosophies';
import type { Philosophy } from '@app-types/philosophy.types';

// 투자거장 화면(DAR-54) — 4종 철학 카드(버핏·린치·그린블라트·드러켄밀러).
// 게스트 열람 가능(백엔드 OptionalJwtAuthGuard). 교육·발견 가치 — 면책 상시.

export default function PhilosophyMastersScreen() {
  const { colors, typography: typo } = useTheme();
  const { data, isLoading, isError, error, refetch, isRefetching } = usePhilosophies();

  const handlePress = useCallback((philosophyId: string) => {
    router.push(`/philosophy/${philosophyId}`);
  }, []);

  const renderItem = useCallback(
    ({ item }: { item: Philosophy }) => (
      <PhilosophyMasterCard philosophy={item} onPress={handlePress} />
    ),
    [handlePress],
  );

  const renderBody = () => {
    if (isLoading) return <LoadingState message="투자거장 철학을 불러오는 중…" />;
    if (isError) {
      return (
        <ApiErrorState
          error={error}
          title="철학을 불러오지 못했습니다."
          description="잠시 후 다시 시도해 주세요."
          onRetry={refetch}
        />
      );
    }
    const list = data ?? [];
    return (
      <FlatList
        data={list}
        renderItem={renderItem}
        keyExtractor={(item) => item.philosophyId}
        contentContainerStyle={styles.listContent}
        showsVerticalScrollIndicator={false}
        removeClippedSubviews={false}
        initialNumToRender={8}
        maxToRenderPerBatch={8}
        windowSize={7}
        onRefresh={refetch}
        refreshing={isRefetching}
        ListHeaderComponent={
          <Text style={[typo.caption, { color: colors.textSecondary, marginBottom: spacing.md }]}>
            유명 투자자의 공개 자료(저서·주주서한·강연)를 구조화한 철학입니다. 각 거장의 핵심 원칙과
            체크리스트로 종목을 점검해 보세요. 투자 권유가 아닌 참고 정보입니다.
          </Text>
        }
        ListEmptyComponent={
          <EmptyState
            icon="book-open"
            title="등록된 철학이 없습니다."
            description="철학 시드가 준비되면 여기에 표시됩니다."
          />
        }
        ListFooterComponent={list.length > 0 ? <DisclaimerSection style={styles.disclaimer} /> : null}
      />
    );
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={['top']}>
      {/* 공용 ScreenHeader(L-5a A-1): 자체 헤더(Ionicons chevron-back + 좌측 제목) 드리프트 제거. */}
      <ScreenHeader title="투자거장" onBack={() => router.back()} />
      <View style={styles.body}>{renderBody()}</View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  body: {
    flex: 1,
  },
  listContent: {
    padding: spacing.lg,
    gap: spacing.md,
    flexGrow: 1,
  },
  disclaimer: {
    marginTop: spacing.lg,
  },
});
