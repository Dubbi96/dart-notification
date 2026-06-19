import React, { useCallback } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Surface, Chip } from 'react-native-paper';
import { Feather } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';

import { useTheme, MAX_CHIP_FONT_SCALE } from '@theme';
import { spacing, radius } from '@theme/spacing';
import { DisclaimerSection } from '@components/common/DisclaimerSection';
import { ErrorState } from '@components/common/StateView';
import { DetailSkeleton } from '@components/common/DetailSkeleton';
import { CompanyHubLink } from '@components/company/CompanyHubLink';
import { usePosition, usePositionThesis } from '@hooks/usePortfolio';
import {
  thesisStatusColor,
  thesisStatusLabel,
  pnlColor,
  formatPnlPercent,
} from '@utils/signalDisplay';
import { isChartableTicker, navigateToStockChart } from '@utils/stockChartLink';

// 포지션 상세(기획 §3 SCR-PORTFOLIO 연계). API 미존재 시 graceful null 처리.
// 청산 룰 수치는 읽기 전용 — 탭 시 토스트.

export default function PositionDetailScreen() {
  const { portfolioId, positionId } = useLocalSearchParams<{
    portfolioId: string;
    positionId: string;
  }>();
  const { colors, typography: typo } = useTheme();
  const positionQuery = usePosition(positionId!);
  const thesisQuery = usePositionThesis(positionId!);

  const handleViewThesis = useCallback(() => {
    router.push(`/portfolio/${portfolioId}/position/${positionId}/thesis`);
  }, [portfolioId, positionId]);

  // DAR-363: 손익을 체감하는 바로 이 화면에서 해당 종목 실시간 차트로 1탭 진입.
  // position 변수는 아래에서 선언되므로 쿼리 데이터(상단 선언)를 직접 참조한다(TDZ 회피).
  const handleViewChart = useCallback(() => {
    navigateToStockChart(positionQuery.data?.ticker);
  }, [positionQuery.data?.ticker]);

  // 시세·논거 변동 데이터 갱신 — 포지션·Thesis 두 쿼리를 함께 새로고침.
  const handleRefresh = useCallback(() => {
    positionQuery.refetch();
    thesisQuery.refetch();
  }, [positionQuery, thesisQuery]);
  const isRefreshing = positionQuery.isRefetching || thesisQuery.isRefetching;

  if (positionQuery.isLoading) {
    // 헤더 유지 + 포지션 카드/Thesis 골격 스켈레톤으로 로딩→콘텐츠 점프 제거(DAR-147).
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={['top']}>
        <View style={[styles.header, { borderBottomColor: colors.border }]}>
          <TouchableOpacity
            onPress={() => router.back()}
            accessibilityRole="button"
            accessibilityLabel="뒤로 가기"
          >
            <Feather name="arrow-left" size={22} color={colors.text} />
          </TouchableOpacity>
          <Text style={[typo.h3, { color: colors.text, flex: 1, marginLeft: spacing.md }]}>
            포지션 상세
          </Text>
        </View>
        <DetailSkeleton cards={[{ chip: true, lines: 2 }, { lines: 2 }, { lines: 1 }]} />
      </SafeAreaView>
    );
  }

  if (positionQuery.isError) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={['top']}>
        <ErrorState title="포지션을 불러오지 못했습니다." onRetry={positionQuery.refetch} />
      </SafeAreaView>
    );
  }

  const position = positionQuery.data;
  const thesis = thesisQuery.data;

  // Thesis 카드 보조 라벨 — 로딩/에러/무데이터/데이터를 명시적으로 분기(DAR-183).
  // 기존엔 data 존재여부만 봐 에러·무데이터에도 "불러오는 중…"으로 고착됐다.
  const thesisSummary = thesisQuery.isLoading
    ? 'Thesis 불러오는 중…'
    : thesisQuery.isError
      ? 'Thesis를 불러오지 못했습니다'
      : thesis
        ? '진입 논리 및 훼손 조건 확인'
        : 'Thesis 없음';

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={['top']}>
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <TouchableOpacity
          onPress={() => router.back()}
          accessibilityRole="button"
          accessibilityLabel="뒤로 가기"
        >
          <Feather name="arrow-left" size={22} color={colors.text} />
        </TouchableOpacity>
        <Text style={[typo.h3, { color: colors.text, flex: 1, marginLeft: spacing.md }]}>
          포지션 상세
        </Text>
      </View>

      {!position ? (
        <View style={styles.emptyState}>
          <Feather name="inbox" size={48} color={colors.textTertiary} />
          <Text style={[typo.bodyMedium, { color: colors.text, marginTop: spacing.md }]}>
            포지션 정보를 찾을 수 없습니다.
          </Text>
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={styles.scroll}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={isRefreshing}
              onRefresh={handleRefresh}
              colors={[colors.primary]}
              tintColor={colors.primary}
            />
          }
        >
          {/* 헤더 */}
          <Surface elevation={1} style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <View style={styles.titleRow}>
              {/* DAR-305: 큰 글꼴서 기업명이 다중 줄로 팽창해 상태칩을 밀지 않도록 한 줄 말줄임. */}
              <Text style={[typo.h2, { color: colors.text, flex: 1 }]} numberOfLines={1}>
                {position.corpName}
              </Text>
              <Chip
                compact
                mode="flat"
                // DAR-305: OS 글꼴 확대 시 상태칩 한글 받침 세로 클리핑 방지 배율 상한(DAR-174 정본).
                maxFontSizeMultiplier={MAX_CHIP_FONT_SCALE}
                style={{ backgroundColor: colors.surfaceSecondary }}
                textStyle={[typo.small, { color: thesisStatusColor(position.thesisStatus, colors), fontWeight: '700' }]}
                accessibilityLabel={`Thesis 상태: ${thesisStatusLabel(position.thesisStatus)}`}
              >
                {thesisStatusLabel(position.thesisStatus)}
              </Chip>
            </View>
            <View style={[styles.pnlRow, { marginTop: spacing.sm }]}>
              <Text style={[typo.h3, { color: pnlColor(position.pnlPercent, colors) }]}>
                {formatPnlPercent(position.pnlPercent)}
              </Text>
              {position.currentPrice != null ? (
                <Text style={[typo.caption, { color: colors.textSecondary }]}>
                  현재가 {position.currentPrice.toLocaleString()}원
                </Text>
              ) : null}
            </View>
            {position.quantity != null && position.avgPrice != null ? (
              <Text style={[typo.small, { color: colors.textTertiary, marginTop: spacing.xs }]}>
                {position.quantity}주 · 평균 {position.avgPrice.toLocaleString()}원
              </Text>
            ) : null}

            {/* DAR-363: 실시간 차트 1탭 진입 — 6자리 종목코드 있을 때만(graceful). ★정직 라벨. */}
            {isChartableTicker(position.ticker) ? (
              <TouchableOpacity
                onPress={handleViewChart}
                activeOpacity={0.8}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                accessibilityRole="button"
                accessibilityLabel={`${position.corpName} 실시간 차트 보기 — 실시간 시장가, 환경시계와 다를 수 있음`}
                style={[styles.chartLink, { borderColor: colors.primary }]}
              >
                <Feather name="bar-chart-2" size={16} color={colors.primary} />
                <View style={styles.chartLinkText}>
                  <Text style={[typo.captionMedium, { color: colors.primary }]}>실시간 차트 보기</Text>
                  <Text style={[typo.small, { color: colors.textTertiary }]}>
                    실시간 시장가 · 환경시계와 괴리
                  </Text>
                </View>
                <Feather name="chevron-right" size={18} color={colors.primary} />
              </TouchableOpacity>
            ) : null}
          </Surface>

          {/* 기업 허브 진입(DAR-149) — corpCode 부재 시 미노출(graceful) */}
          <CompanyHubLink
            corpCode={position.corpCode}
            corpName={position.corpName}
            ticker={position.ticker}
          />

          {/* Thesis 요약 + 이동 */}
          <TouchableOpacity
            onPress={handleViewThesis}
            activeOpacity={0.8}
            accessibilityRole="button"
            accessibilityLabel="Thesis 상세 보기"
          >
            <Surface elevation={0} style={[styles.card, styles.thesisLink, { backgroundColor: colors.surface, borderColor: colors.primary }]}>
              <View style={styles.rowBetween}>
                <View style={{ gap: spacing.xs }}>
                  <Text style={[typo.captionMedium, { color: colors.textSecondary }]}>Thesis</Text>
                  <Text style={[typo.bodyMedium, { color: colors.text }]}>
                    {thesisSummary}
                  </Text>
                </View>
                <Feather name="chevron-right" size={20} color={colors.primary} />
              </View>
            </Surface>
          </TouchableOpacity>

          <DisclaimerSection style={styles.disclaimer} />
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
  },
  scroll: {
    padding: spacing.lg,
    gap: spacing.md,
    paddingBottom: spacing['2xl'],
  },
  card: {
    borderRadius: radius.lg,
    borderWidth: 1,
    padding: spacing.base,
  },
  thesisLink: {
    borderWidth: 2,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  pnlRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: spacing.md,
  },
  rowBetween: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  chartLink: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: spacing.md,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderWidth: 1,
    borderRadius: radius.md,
    minHeight: 44,
  },
  chartLinkText: {
    flex: 1,
    gap: 1,
  },
  emptyState: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  disclaimer: { marginTop: spacing.md },
});
