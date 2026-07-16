import React from 'react';
import { View, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { useTheme } from '@theme';
import { spacing } from '@theme/spacing';
import { ScreenHeader } from '@components/common/ScreenHeader';
import { DetailSkeleton } from '@components/common/DetailSkeleton';
import { ApiErrorState, EmptyState } from '@components/common/StateView';
import { DisclaimerSection } from '@components/common/DisclaimerSection';
import { PriceMoveReasoningCard } from '@components/priceMove/PriceMoveReasoningCard';
import { usePriceMoveReasoning } from '@hooks/usePriceMoveReasoning';

// '왜 움직였나' 카드 화면 (DAR-524, Wave C/C2·P0).
//  - PRICE_MOVE 푸시 딥링크(/price-move/:refId, refId=<stockCode>-<YYYYMMDD>)로 진입.
//  - C1(DAR-522) price_move_reasonings 조회 소비 → 정직 3상태 분기(수용기준 1):
//      리즈닝(ANALYZED) / 무공시(NO_DISCLOSURE) / 로딩실패(query error). CAP_SKIPPED 는
//      카드 컴포넌트가 정직 고지로 처리.
//  - '투자권유 아님' 면책은 DisclaimerSection 으로 최하단 고정(수용기준 2).
//  - 콜드스타트 딥링크는 useNotificationSetup 의 pendingDeepLink 게이트가 처리(수용기준 3).
//  - 단일 상세 카드(리스트 아님) → ScrollView. 테마 토큰만·읽기 전용.

function handleBack() {
  if (router.canGoBack()) router.back();
  else router.replace('/');
}

export default function PriceMoveReasoningScreen() {
  const { refId } = useLocalSearchParams<{ refId: string }>();
  const { colors } = useTheme();
  const { data, isLoading, isError, error, refetch } = usePriceMoveReasoning(refId ?? '');

  const renderBody = () => {
    // refId 누락(비정상 진입) — 빈 상태로 정직 처리.
    if (!refId) {
      return (
        <EmptyState
          icon="help-circle"
          title="표시할 급변동 정보가 없습니다"
          description="알림을 다시 눌러 진입해 주세요."
        />
      );
    }

    if (isLoading) {
      return (
        <DetailSkeleton cards={[{ chip: true, lines: 3 }, { lines: 2 }]} />
      );
    }

    // 로딩실패(수용기준 1) — 네트워크/서버 오류·미생성 등은 재시도 동선과 함께 정직 분기.
    if (isError || !data) {
      return (
        <ApiErrorState
          error={error}
          title="원인 분석을 불러오지 못했습니다"
          description="잠시 후 다시 시도해 주세요."
          onRetry={refetch}
        />
      );
    }

    // 리즈닝(ANALYZED) / 무공시(NO_DISCLOSURE) / 스킵(CAP_SKIPPED) — 카드가 판별 분기.
    return (
      <View style={styles.content}>
        <PriceMoveReasoningCard reasoning={data} />
        <DisclaimerSection style={styles.disclaimer} />
      </View>
    );
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={['top']}>
      <ScreenHeader title="왜 움직였나" subtitle="관심종목 급변동 원인" onBack={handleBack} />
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {renderBody()}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
    padding: spacing.base,
  },
  content: {
    flex: 1,
  },
  disclaimer: {
    marginTop: spacing.xl,
  },
});
