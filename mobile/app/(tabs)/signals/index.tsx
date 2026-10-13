import React, { useRef, useState } from 'react';
import { FlatList, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams, useScrollToTop } from 'expo-router';

import { BuyEditionView } from '@components/signals/BuyEditionView';
import { GuestSignalPreview } from '@components/signals/GuestSignalPreview';
import { DeviceRuleCheckSheet } from '@components/signals/DeviceRuleCheckSheet';
import { Button } from '@components/common/Button';
import { useAuthStore } from '@stores/authStore';
import { useTheme } from '@theme';
import { spacing } from '@theme/spacing';

import type { TradingSignal } from '@app-types/signal.types';

/**
 * AOS 모바일의 첫 화면. 종목 탐색·전략 비교·매도 피드를 한 화면에 겹치지 않고
 * `종합 의견 → 실행 플랜 → 근거 상세` 한 흐름만 제공한다.
 */
export default function SignalsScreen() {
  const { colors, typography: typo } = useTheme();
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const [showCheck, setShowCheck] = useState(false);
  const { date: dateParam } = useLocalSearchParams<{ date?: string }>();
  const focusDate =
    typeof dateParam === 'string' && /^\d{8}$/.test(dateParam) ? dateParam : undefined;
  const listRef = useRef<FlatList<TradingSignal>>(null);
  useScrollToTop(listRef);

  return (
    <SafeAreaView
      style={[styles.container, { backgroundColor: colors.background }]}
      edges={['top']}
    >
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <View style={styles.titleRow}>
          <Text style={[typo.h2, styles.title, { color: colors.text }]}>오늘의 판단</Text>
          <Button title="기기 점검" variant="secondary" size="sm" onPress={() => setShowCheck(true)} />
        </View>
        <Text style={[typo.caption, styles.subtitle, { color: colors.textSecondary }]}>
          종가 기반 모의 계획 · 자동 실주문 꺼짐
        </Text>
      </View>

      {isAuthenticated ? (
        <BuyEditionView listRef={listRef} focusDate={focusDate} />
      ) : (
        <GuestSignalPreview
          secondaryLabel="공시 둘러보기"
          onSecondary={() => router.push('/disclosures')}
        />
      )}
      {showCheck ? <DeviceRuleCheckSheet visible onClose={() => setShowCheck(false)} /> : null}
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
  subtitle: {
    marginTop: spacing.xs,
  },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  title: { flex: 1, minWidth: 0 },
});
