import React, { useCallback } from 'react';
import { View, Text, ScrollView, StyleSheet, TouchableOpacity, RefreshControl } from 'react-native';
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
  positionSystemAction,
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
      <SafeAreaView
        style={[styles.container, { backgroundColor: colors.background }]}
        edges={['top']}
      >
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
      <SafeAreaView
        style={[styles.container, { backgroundColor: colors.background }]}
        edges={['top']}
      >
        <ErrorState title="포지션을 불러오지 못했습니다." onRetry={positionQuery.refetch} />
      </SafeAreaView>
    );
  }

  const position = positionQuery.data;
  const thesis = thesisQuery.data;

  // DAR-368: 시스템 트레이딩 현황 — 상태칩을 자동 동작 언어로(EXIT='자동 매도 예정', VIOLATED='시스템 모니터링').
  // 표시=엔진 일치(①): 손익(실시간)과 시스템이 행동하는 상태를 같은 언어로 노출, 수동 점검 암시 문구 금지.
  const action = position ? positionSystemAction(position) : null;
  // DAR-359: 손익% 위계 지배 — 이익/손실 글랜스. pnlColor(반올림 정합)로 부호를 판정해
  // 전폭 색조 배경·방향 화살표를 결정한다(이익=초록, 손실=빨강, 보합=중립).
  const pnlTextColor = position ? pnlColor(position.pnlPercent, colors) : colors.textSecondary;
  const isProfit = pnlTextColor === colors.success;
  const isLoss = pnlTextColor === colors.error;
  const pnlSurface = isProfit
    ? colors.successSurface
    : isLoss
      ? colors.errorSurface
      : colors.surfaceSecondary;
  const pnlArrow = isProfit ? 'trending-up' : isLoss ? 'trending-down' : 'minus';

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
    <SafeAreaView
      style={[styles.container, { backgroundColor: colors.background }]}
      edges={['top']}
    >
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
          <Surface
            elevation={1}
            style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}
          >
            <View style={styles.titleRow}>
              {/* DAR-305: 큰 글꼴서 기업명이 다중 줄로 팽창해 상태칩을 밀지 않도록 한 줄 말줄임. */}
              <Text
                style={[typo.h2, { color: colors.text, flex: 1, minWidth: 0 }]}
                numberOfLines={1}
                ellipsizeMode="tail"
              >
                {position.corpName}
              </Text>
              {action ? (
                <Chip
                  compact
                  mode="flat"
                  // DAR-305: OS 글꼴 확대 시 상태칩 한글 받침 세로 클리핑 방지 배율 상한(DAR-174 정본).
                  maxFontSizeMultiplier={MAX_CHIP_FONT_SCALE}
                  // DAR-368: 자동 매도(하드룰 손절·청산)만 솔리드 경고색 강조, 그 외는 보조 표면.
                  style={{
                    backgroundColor:
                      action.tone === 'auto-sell' ? colors.error : colors.surfaceSecondary,
                  }}
                  textStyle={[
                    typo.small,
                    {
                      color:
                        action.tone === 'auto-sell'
                          ? colors.onColor
                          : thesisStatusColor(position.thesisStatus, colors),
                      fontWeight: '700',
                    },
                  ]}
                  accessibilityLabel={action.a11yLabel}
                  // DAR-368: 자동 매도='zap'(시스템 자동 실행), 모니터링='activity'(시스템 감시). 수동 알림 금지.
                  icon={
                    action.tone === 'auto-sell'
                      ? ({ size }) => <Feather name="zap" size={size} color={colors.onColor} />
                      : action.tone === 'monitoring'
                        ? ({ size }) => (
                            <Feather
                              name="activity"
                              size={size}
                              color={thesisStatusColor(position.thesisStatus, colors)}
                            />
                          )
                        : undefined
                  }
                >
                  {action.label}
                </Chip>
              ) : null}
            </View>
            {/* DAR-359: 손익% 지배 블록 — typo.amount 전폭 색조 + 방향 화살표.
                결과(손익)를 한눈에 추출하도록 입력값(가격·수량)보다 위계를 명확히 끌어올린다. */}
            <View
              style={[styles.pnlBlock, { backgroundColor: pnlSurface, marginTop: spacing.md }]}
              accessibilityRole="summary"
              accessibilityLabel={`손익 ${formatPnlPercent(position.pnlPercent)}`}
            >
              <View style={styles.pnlHeadline}>
                <Feather name={pnlArrow} size={28} color={pnlTextColor} />
                <Text
                  style={[typo.amount, { color: pnlTextColor, flexShrink: 1, minWidth: 0 }]}
                  numberOfLines={1}
                  ellipsizeMode="tail"
                  adjustsFontSizeToFit
                  minimumFontScale={0.7}
                >
                  {formatPnlPercent(position.pnlPercent)}
                </Text>
              </View>
              {position.currentPrice != null ? (
                <Text
                  style={[typo.caption, { color: colors.textSecondary, marginTop: spacing.xs }]}
                >
                  현재가 {position.currentPrice.toLocaleString()}원
                </Text>
              ) : null}
            </View>
            {/* 입력값 메타 — 작은 폰트·낮은 불투명도로 손익 결과와 시각 위계 분리. */}
            {position.quantity != null && position.avgPrice != null ? (
              <View
                style={[
                  styles.metaSection,
                  { borderTopColor: colors.border, marginTop: spacing.md },
                ]}
              >
                <Text style={[typo.small, { color: colors.textTertiary, opacity: 0.75 }]}>
                  {position.quantity}주 · 평균 {position.avgPrice.toLocaleString()}원
                </Text>
              </View>
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
                  <Text style={[typo.captionMedium, { color: colors.primary }]}>
                    실시간 차트 보기
                  </Text>
                  <Text style={[typo.small, { color: colors.textTertiary }]}>
                    실시간 시장가 · 환경시계와 괴리
                  </Text>
                </View>
                <Feather name="chevron-right" size={18} color={colors.primary} />
              </TouchableOpacity>
            ) : null}
            {/* DAR-368: 하드룰 손절·청산은 Engine5가 자동 체결 — 수동 매도 불필요임을 정직하게 고지(예정 상태).
                포지션이 목록/상세에 보이면 미체결 = 예정. 체결되면 거래내역으로 이동한다. */}
            {action?.tone === 'auto-sell' ? (
              <View
                style={[
                  styles.autoSellNotice,
                  { backgroundColor: colors.error, marginTop: spacing.sm },
                ]}
                accessibilityRole="summary"
                accessibilityLabel={action.a11yLabel}
              >
                <Feather name="zap" size={16} color={colors.onColor} />
                <Text style={[typo.small, { color: colors.onColor, flex: 1 }]}>
                  하드룰 손절 — 시스템이 다음 평가 시 자동 매도합니다. 사용자 조치는 필요하지
                  않습니다.
                </Text>
              </View>
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
            <Surface
              elevation={0}
              style={[
                styles.card,
                styles.thesisLink,
                { backgroundColor: colors.surface, borderColor: colors.primary },
              ]}
            >
              <View style={styles.rowBetween}>
                <View style={{ gap: spacing.xs }}>
                  <Text style={[typo.captionMedium, { color: colors.textSecondary }]}>Thesis</Text>
                  <Text style={[typo.bodyMedium, { color: colors.text }]}>{thesisSummary}</Text>
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
  pnlBlock: {
    borderRadius: radius.md,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
  },
  pnlHeadline: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  metaSection: {
    paddingTop: spacing.sm,
    borderTopWidth: 1,
  },
  // DAR-368: 자동 매도 고지 배너 — 솔리드 경고색 + 아이콘 + 평문(시스템 자동 체결 예정).
  autoSellNotice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.sm,
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
