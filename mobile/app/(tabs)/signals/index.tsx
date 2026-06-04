import React, { useState, useCallback } from 'react';
import { View, Text, FlatList, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { SegmentedButtons } from 'react-native-paper';
import { router } from 'expo-router';
import { useTheme } from '@theme';
import { spacing } from '@theme/spacing';
import { BuyScoreCard } from '@components/signals/BuyScoreCard';
import { ExitScoreCard } from '@components/signals/ExitScoreCard';
import { DisclaimerSection } from '@components/common/DisclaimerSection';
import { LoadingState, EmptyState, ErrorState } from '@components/common/StateView';
import { useBuySignals, useExitSignals } from '@hooks/useSignals';

import type { TradingSignal, ExitSignal } from '@app-types/signal.types';

type SubTab = 'buy' | 'sell';

export default function SignalsScreen() {
  const { colors, typography: typo } = useTheme();
  const [subTab, setSubTab] = useState<SubTab>('buy');

  const buyQuery = useBuySignals();
  const exitQuery = useExitSignals();

  const handleBuyPress = useCallback((signal: TradingSignal) => {
    router.push(`/signals/${signal.id}`);
  }, []);

  const handleExitPress = useCallback((signal: ExitSignal) => {
    router.push(`/signals/${signal.id}`);
  }, []);

  const renderBuy = useCallback(
    ({ item }: { item: TradingSignal }) => <BuyScoreCard signal={item} onPress={handleBuyPress} />,
    [handleBuyPress],
  );

  const renderExit = useCallback(
    ({ item }: { item: ExitSignal }) => <ExitScoreCard signal={item} onPress={handleExitPress} />,
    [handleExitPress],
  );

  const activeQuery = subTab === 'buy' ? buyQuery : exitQuery;

  const renderBody = () => {
    if (activeQuery.isLoading) {
      return <LoadingState message="신호를 불러오는 중…" />;
    }
    if (activeQuery.isError) {
      return (
        <ErrorState
          title="신호를 불러오지 못했습니다."
          description="잠시 후 다시 시도해 주세요."
          onRetry={activeQuery.refetch}
        />
      );
    }

    if (subTab === 'buy') {
      const data = buyQuery.data ?? [];
      return (
        <FlatList
          data={data}
          renderItem={renderBuy}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          ListEmptyComponent={
            <EmptyState
              icon="zap"
              title="현재 조건에 맞는 매수 신호가 없습니다."
              description="관심 종목을 추가하면 매수 신호를 알려드려요."
              actionLabel="관심 종목 추가"
              onAction={() => router.push('/settings-detail/watchlist')}
            />
          }
          ListFooterComponent={data.length > 0 ? <DisclaimerSection style={styles.disclaimer} /> : null}
        />
      );
    }

    const data = exitQuery.data ?? [];
    return (
      <FlatList
        data={data}
        renderItem={renderExit}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.listContent}
        showsVerticalScrollIndicator={false}
        ListEmptyComponent={
          <EmptyState
            icon="check-circle"
            title="매도 신호 없음"
            description="모든 포지션이 정상입니다."
          />
        }
        ListFooterComponent={data.length > 0 ? <DisclaimerSection style={styles.disclaimer} /> : null}
      />
    );
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={['top']}>
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <Text style={[typo.h2, { color: colors.text }]}>신호</Text>
      </View>

      <View style={styles.tabs}>
        <SegmentedButtons
          value={subTab}
          onValueChange={(v) => setSubTab(v as SubTab)}
          buttons={[
            { value: 'buy', label: '매수', icon: 'trending-up' },
            { value: 'sell', label: '매도', icon: 'trending-down' },
          ]}
        />
      </View>

      <View style={styles.body}>{renderBody()}</View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
  },
  tabs: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
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
