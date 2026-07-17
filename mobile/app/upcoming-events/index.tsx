import React, { useCallback } from 'react';
import { View, Text, FlatList, StyleSheet, type ListRenderItem } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { useTheme } from '@theme';
import { spacing } from '@theme/spacing';
import { ScreenHeader } from '@components/common/ScreenHeader';
import { EmptyState, ApiErrorState } from '@components/common/StateView';
import { SkeletonList } from '@components/common/SkeletonCard';
import { emptyStateCopy } from '@components/common/emptyStateCopy';
import { UpcomingEventRow } from '@components/upcomingEvents/UpcomingEventRow';
import { useUpcomingEvents } from '@hooks/useUpcomingEvents';
import { useAuthStore } from '@stores/authStore';

import type { UpcomingEventItem } from '@app-types/upcomingEvent.types';

// DAR-541: 예정 이벤트 캘린더 전체 화면 — 홈 섹션(UpcomingEventsSection)이 5건으로 자른
// 관심기업 공시 파생 일정을 전부(서버 90일 윈도) D-day 순으로 보여준다.
// 정직 규약(DAR-538 계승): 서버가 추출 확실 날짜만 내려주므로 목록은 이미 D-day 오름차순
// 정렬돼 있고, 없으면 발명 대신 '예정된 이벤트가 없어요' 정직 빈 상태를 표시한다.
// 오늘/임박(0~3일)은 행의 D-day 칩이 warning 톤으로 강조(UpcomingEventRow 단일 정의).
// 각 행 탭 → 근거 공시 상세(/disclosure/:rcpNo) 딥링크로 날짜를 직접 검증할 수 있다.

// rcpNo(14자리)+kind+date 조합으로 한 공시가 복수 이벤트를 파생해도 충돌 없는 안정 키.
const keyExtractor = (item: UpcomingEventItem) => `${item.rcpNo}|${item.kind}|${item.date}`;

export default function UpcomingEventsScreen() {
  const { colors, typography: typo } = useTheme();
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const { data, isLoading, isError, error, refetch, isRefetching } = useUpcomingEvents({
    enabled: isAuthenticated,
  });

  const items = data?.items ?? [];

  const renderItem = useCallback<ListRenderItem<UpcomingEventItem>>(
    ({ item, index }) => <UpcomingEventRow item={item} isLast={index === items.length - 1} />,
    [items.length],
  );

  const goSignIn = useCallback(() => {
    useAuthStore.getState().clearAuth();
    router.push('/auth/sign-in');
  }, []);

  const renderBody = () => {
    // 게스트: 관심기업 기반이라 로그인 유도(쿼리는 비활성 상태).
    if (!isAuthenticated) {
      const copy = emptyStateCopy.upcomingEventsGuest;
      return (
        <EmptyState
          icon={copy.icon}
          title={copy.title}
          description={copy.description}
          actionLabel={copy.actionLabel}
          onAction={goSignIn}
        />
      );
    }
    if (isLoading) {
      return <SkeletonList variant="disclosure" count={6} />;
    }
    if (isError) {
      return <ApiErrorState error={error} onRetry={() => refetch()} />;
    }
    if (items.length === 0) {
      const copy = emptyStateCopy.upcomingEventsEmpty;
      return <EmptyState icon={copy.icon} title={copy.title} description={copy.description} />;
    }
    return (
      <FlatList
        data={items}
        renderItem={renderItem}
        keyExtractor={keyExtractor}
        refreshing={isRefetching}
        onRefresh={() => refetch()}
        initialNumToRender={12}
        contentContainerStyle={styles.listContent}
        showsVerticalScrollIndicator={false}
        ListHeaderComponent={
          <Text style={[typo.small, styles.honestNote, { color: colors.textSecondary }]}>
            관심기업 공시에서 확인된 일정만 표시해요 · 가까운 순
          </Text>
        }
      />
    );
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={['top']}>
      <ScreenHeader title="예정 이벤트" onBack={() => router.back()} />
      <View style={[styles.body, { backgroundColor: colors.background }]}>{renderBody()}</View>
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
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing['2xl'],
  },
  honestNote: {
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
  },
});
