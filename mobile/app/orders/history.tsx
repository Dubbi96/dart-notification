import React from 'react';
import { View, Text, ScrollView, StyleSheet, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useTheme } from '@theme';
import { spacing } from '@theme/spacing';
import { EmptyState } from '@components/common/StateView';
import { emptyStateCopy } from '@components/common/emptyStateCopy';
import { PaperTradingNotice } from '@components/orders/PaperTradingNotice';

export default function OrderHistoryScreen() {
  const { colors, typography: typo } = useTheme();

  return (
    <SafeAreaView
      style={[styles.container, { backgroundColor: colors.background }]}
      accessibilityLabel="주문 이력 화면"
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
        <Text style={[typo.h3, { color: colors.text }]}>주문 이력</Text>
        <View style={styles.backButton} />
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.scrollContent}
      >
        {/* DAR-108(#9): 실주문 미도입 정직 표기 + 거래내역은 모의 매매 성적표로 동선 연결(가드). */}
        <PaperTradingNotice
          description="실주문 이력은 모의운용 검증 이후(M11·M12) 제공됩니다. 지금까지의 매매 기록은 모의운용 거래내역에서 확인하세요."
          actions={[
            { label: '모의 거래내역 보기', onPress: () => router.replace('/portfolio/trade-history') },
            { label: '모의운용', onPress: () => router.replace('/(tabs)/portfolio') },
          ]}
        />
        <EmptyState
          {...emptyStateCopy.ordersHistoryEmpty}
          description="주문이 승인되거나 거절되면 여기에 이력이 쌓입니다."
        />
      </ScrollView>
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
});
