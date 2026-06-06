import React from 'react';
import { View, Text, ScrollView, StyleSheet, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useTheme } from '@theme';
import { spacing } from '@theme/spacing';
import { EmptyState } from '@components/common/StateView';
import { emptyStateCopy } from '@components/common/emptyStateCopy';
import { DisclaimerSection } from '@components/common/DisclaimerSection';
import { PaperTradingNotice } from '@components/orders/PaperTradingNotice';

export default function OrderPendingScreen() {
  const { colors, typography: typo } = useTheme();

  return (
    <SafeAreaView
      style={[styles.container, { backgroundColor: colors.background }]}
      accessibilityLabel="주문 승인 대기 화면"
    >
      <View style={[styles.header, { borderBottomColor: colors.borderLight }]}>
        <TouchableOpacity
          onPress={() => router.back()}
          style={styles.backButton}
          accessibilityLabel="뒤로 가기"
          accessibilityRole="button"
        >
          <Feather name="chevron-left" size={26} color={colors.text} />
        </TouchableOpacity>
        <Text style={[typo.h3, { color: colors.text }]}>주문 승인 대기</Text>
        <View style={styles.backButton} />
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.scrollContent}
      >
        {/* DAR-108(#9): 실주문 미도입 정직 표기 + 모의운용 동선 안내(가드). */}
        <PaperTradingNotice
          description="Risk 체크를 통과한 실주문 승인 기능은 모의운용 검증 이후(M11·M12) 도입됩니다. 지금은 모의운용에서 신호를 확인하세요."
          actions={[
            { label: '모의운용 보기', onPress: () => router.replace('/(tabs)/portfolio') },
            { label: '모의 거래내역', onPress: () => router.replace('/portfolio/trade-history') },
          ]}
        />
        <EmptyState
          {...emptyStateCopy.ordersPendingEmpty}
          description="Risk 체크를 통과한 주문 안건이 생기면 여기서 확인하고 직접 승인하세요."
        />
      </ScrollView>

      {/* 투자자문 아님 면책 — 화면 최하단 고정 */}
      <DisclaimerSection style={styles.disclaimer} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.base,
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
  },
  backButton: {
    width: 44,
    height: 44,
    justifyContent: 'center',
    alignItems: 'center',
  },
  scrollContent: {
    flexGrow: 1,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.xl,
    gap: spacing.lg,
  },
  disclaimer: {
    margin: spacing.base,
  },
});
