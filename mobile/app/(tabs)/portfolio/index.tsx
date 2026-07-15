import React, { useState, useCallback, useMemo, useRef } from 'react';
import { View, Text, FlatList, ScrollView, TouchableOpacity, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Surface, Banner } from 'react-native-paper';
import { Feather } from '@expo/vector-icons';
import { router, useScrollToTop, useLocalSearchParams } from 'expo-router';
import { useTheme, MAX_CHIP_FONT_SCALE } from '@theme';
import { spacing, radius, sizing } from '@theme/spacing';
import { PositionCard } from '@components/portfolio/PositionCard';
import { EmptyState, ApiErrorState } from '@components/common/StateView';
import { GuestPrompt } from '@components/common/GuestPrompt';
import { emptyStateCopy } from '@components/common/emptyStateCopy';
import { guestPromptCopy } from '@components/common/guestPromptCopy';
import { SkeletonList, SkeletonBar, useSkeletonPulse } from '@components/common/SkeletonCard';
import { useAuthStore } from '@stores/authStore';
import { SimulationStatusSection } from '@components/portfolio/SimulationStatusSection';
import { StyleComparisonSection } from '@components/portfolio/StyleComparisonSection';
import { StrategyComparisonSection } from '@components/portfolio/StrategyComparisonSection';
import { PersonaTrackSection } from '@components/portfolio/PersonaTrackSection';
import { TodayCheckSlot } from '@components/portfolio/TodayCheckSlot';
import { TodayBriefingSection } from '@components/portfolio/TodayBriefingSection';
import { PositionSearchBar } from '@components/portfolio/PositionSearchBar';
import { PortfolioRiskBadge } from '@components/portfolio/PortfolioRiskBadge';
import { AutoTradingEntryButton } from '@components/portfolio/AutoTradingEntryButton';
import {
  usePositions,
  usePortfolioSummary,
  usePortfolioRisk,
  usePaperPortfolio,
  useTodayBriefing,
} from '@hooks/usePortfolio';
import { pnlColor, formatPnlPercent } from '@utils/signalDisplay';
import { currentPortfolioBasisLabel } from '@utils/marketQuoteDisplay';
import { dedupeByStock } from '@utils/dedupe';
import { groupedPortfolioTabs, pickLiveEmptyState, resolveInitialSubTab } from '@utils/portfolioTabs';

import type { Position } from '@app-types/portfolio.types';
import type { SortKey } from '@components/portfolio/PositionSearchBar';
import type { PortfolioSubTab } from '@utils/portfolioTabs';

// VIOLATED/EXPIRED 포지션을 리스트 최상단으로 고정하는 정렬 우선순위.
const STATUS_ORDER: Record<Position['thesisStatus'], number> = {
  VIOLATED: 0,
  EXPIRED: 1,
  WATCHING: 2,
  ACTIVE: 3,
};

// UXR-13 C-6: 손익 금액 부호 정본 — formatReturnPct 부호 규칙과 동일(양수만 '+', 0 은 부호
// 없음, 반올림 -0 은 0 으로 정규화 — DAR-312 음수영점 가드). 실전·내 모의 두 탭이 이
// 포맷터를 공유해 '+N원 vs N원' 부호 병기 비일관을 제거한다.
function formatSignedKrw(amount: number): string {
  const rounded = Math.round(amount);
  const display = rounded === 0 ? 0 : rounded;
  return `${display > 0 ? '+' : ''}${display.toLocaleString()}원`;
}

// UXR-13 C-6(DAR-451 C2 후속): 실전·내 모의 총손익 헤드라인 행 공용 렌더 — 아이콘(trending)
// + 타이포(bodyMedium 700) + 부호 병기를 두 탭 동일 시각 문법으로 통일한다.
// 파라미터명 summary: 이 행은 요약(실전 summary / 내 모의 paper)의 손익 필드 쌍을 그린다.
interface PnlHeadlineRowProps {
  totalPnl: number;
  totalPnlPercent: number;
}

function PnlHeadlineRow(summary: PnlHeadlineRowProps) {
  const { colors, typography: typo } = useTheme();
  return (
    <View
      style={styles.headlinePnlRow}
      accessibilityRole="text"
      accessibilityLabel={`총 손익 ${formatSignedKrw(summary.totalPnl)}, ${formatPnlPercent(summary.totalPnlPercent)}`}
    >
      <Feather
        name={summary.totalPnlPercent < 0 ? 'trending-down' : 'trending-up'}
        size={sizing.icon.sm}
        color={pnlColor(summary.totalPnlPercent, colors)}
      />
      <Text style={[typo.bodyMedium, styles.headlinePnl, { color: pnlColor(summary.totalPnlPercent, colors) }]}>
        {formatSignedKrw(summary.totalPnl)} ({formatPnlPercent(summary.totalPnlPercent)})
      </Text>
    </View>
  );
}

// UXR-13 C-3: 요약 로딩 중 자리 유지 스켈레톤 — 헤드라인 팝인 점프(레이아웃 시프트) 제거.
// 실제 요약 카드와 동일한 Surface 골격에 라벨·헤드라인·손익 3줄 자리를 유지한다.
function SummaryHeadlineSkeleton() {
  const { colors } = useTheme();
  const opacity = useSkeletonPulse();
  return (
    <Surface
      elevation={1}
      style={[styles.summary, { backgroundColor: colors.surface, borderColor: colors.border }]}
      accessibilityRole="progressbar"
      accessibilityLabel="포트폴리오 요약 로딩 중"
    >
      <SkeletonBar width={88} height={12} opacity={opacity} />
      <SkeletonBar width="55%" height={30} opacity={opacity} style={styles.headlineValue} />
      <SkeletonBar width="40%" height={16} opacity={opacity} style={styles.headlineValue} />
    </Surface>
  );
}

export default function PortfolioScreen() {
  const { colors, typography: typo } = useTheme();
  // DAR-431: 체결 알림 딥링크(`/portfolio?tab=sim` 등)가 해당 트랙 서브탭으로 직행하도록
  //   초기 탭을 쿼리 파라미터에서 도출(허용 목록 밖/미지정은 'live' 폴백).
  const { tab: tabParam } = useLocalSearchParams<{ tab?: string }>();
  const [subTab, setSubTab] = useState<PortfolioSubTab>(() => resolveInitialSubTab(tabParam));
  // 이미 마운트된 포트폴리오 탭에 새 딥링크(`?tab=...`)가 도착하면 해당 트랙으로 전환.
  //   렌더 단계에서 직전 파라미터와 비교해 동기화(React 권장 'derive-from-props' 패턴 —
  //   useEffect+setState 의 추가 커밋/캐스케이드 렌더 회피). 유효한 tab 값이 올 때만 반응해
  //   사용자의 수동 탭 전환을 덮어쓰지 않는다(파라미터 부재·불변=무동작).
  const [seenTabParam, setSeenTabParam] = useState(tabParam);
  if (tabParam !== seenTabParam) {
    setSeenTabParam(tabParam);
    if (typeof tabParam === 'string' && tabParam.length > 0) {
      setSubTab(resolveInitialSubTab(tabParam));
    }
  }
  const [searchQuery, setSearchQuery] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('urgency');
  // DAR-356: '오늘 점검할 포지션'은 요약 아래로 강등(세컨더리)하고 기본 접힘 — 요약 글랜스 보호.
  const [showTodayCheck, setShowTodayCheck] = useState(false);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);

  // DAR-181: 탭 재탭 시 최상단 복귀. 실전·모의 FlatList는 상호배타로 하나만 마운트되어
  // 동일 ref를 공유한다(비활성 list는 언마운트되어 ref.current=null).
  // UXR-13 C-8: 시스템 검증 서브탭은 각 섹션이 자체 FlatList 에 useScrollToTop 을 등록한다
  // (StrategyComparisonSection 반영 — 나머지 섹션은 각 담당 이슈 범위에서 확장).
  const listRef = useRef<FlatList<Position>>(null);
  useScrollToTop(listRef);

  // UXR-13 P-5: 활성 서브탭이 실제로 그리는 쿼리만 발화(DAR-471 접힘 게이팅과 동일 사상).
  // 딥링크(?tab=sim 등)로 시스템 검증 트랙에 직행하면 실전 3종+모의 쿼리가 전부 무발화 —
  // 체결 알림 동선에서 무관 API 4건이 트랙 데이터와 대역폭을 경쟁하지 않는다.
  // 게스트는 GuestPrompt 만 렌더하므로 전 쿼리 무발화(401 소음 0).
  const isLiveTab = subTab === 'live';
  const positionsQuery = usePositions({ enabled: isAuthenticated && isLiveTab });
  const summaryQuery = usePortfolioSummary({ enabled: isAuthenticated && isLiveTab });
  const riskQuery = usePortfolioRisk({ enabled: isAuthenticated && isLiveTab });
  // W14 오늘의 브리핑 — 실전 탭에서만 발화(P-5 게이팅 사상 동일). 보조 표면이라
  // 로딩/에러는 무음(섹션 미표시)이고, 실패 시 아래 TodayCheckSlot 폴백이 점검 동선을 보존한다.
  const briefingQuery = useTodayBriefing({ enabled: isAuthenticated && isLiveTab });
  const paperQuery = usePaperPortfolio({ enabled: isAuthenticated && subTab === 'paper' });

  const handlePositionPress = useCallback((position: Position) => {
    router.push(`/portfolio/${position.portfolioId}/position/${position.id}`);
  }, []);

  // UXR-13 C-3: 헤드라인 존(요약+리스크) 실패 재시도 — 두 쿼리를 함께 복구해
  // '요약만 살고 하드룰 경보는 죽은' 반쪽 복구를 막는다.
  const handleRetryHeadline = useCallback(() => {
    summaryQuery.refetch();
    riskQuery.refetch();
  }, [summaryQuery, riskQuery]);

  // UXR-13 C-3: 리스크만 실패한 경우의 단독 재시도(요약 불필요 재요청 방지).
  const handleRetryRisk = useCallback(() => {
    riskQuery.refetch();
  }, [riskQuery]);

  const sortedPositions = useMemo(() => {
    const data = positionsQuery.data ?? [];
    const sorted = [...data].sort(
      (a, b) => STATUS_ORDER[a.thesisStatus] - STATUS_ORDER[b.thesisStatus],
    );
    // DAR-122: 종목당 1카드(데이터 레벨 중복 보조 방어선) — 상태 우선순위가 높은 행을 대표로 보존.
    return dedupeByStock(sorted, (p) => p.id);
  }, [positionsQuery.data]);

  const filteredPositions = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    const base = query
      ? sortedPositions.filter(
          (p) =>
            p.corpName.toLowerCase().includes(query) ||
            (p.ticker?.toLowerCase().includes(query) ?? false),
        )
      : sortedPositions;

    return [...base].sort((a, b) => {
      if (sortKey === 'pnl') {
        // DAR-451 C12: '손익순'은 기본 내림차순(수익률 높은 종목 최상단).
        // 종전 오름차순(손실 큰 종목 최상단)은 방향 표시가 없어 혼란 — '비중순'(내림차순)과
        // 동일하게 큰 값이 위로 오는 관례로 통일해 정렬 방향을 예측 가능하게 만든다.
        return b.pnlPercent - a.pnlPercent;
      }
      if (sortKey === 'weight') {
        return (b.weight ?? 0) - (a.weight ?? 0);
      }
      return (
        (STATUS_ORDER[a.thesisStatus] - STATUS_ORDER[b.thesisStatus]) ||
        ((b.exitScore ?? 0) - (a.exitScore ?? 0))
      );
    });
  }, [sortedPositions, searchQuery, sortKey]);

  const renderPosition = useCallback(
    ({ item }: { item: Position }) => <PositionCard position={item} onPress={handlePositionPress} />,
    [handlePositionPress],
  );

  // DAR-356: 접힘 토글 표시/카운트용 — TodayCheckSlot 큐레이션 조건과 동일 술어(점검 대상만 노출).
  const todayCheckCount = useMemo(() => {
    const data = positionsQuery.data ?? [];
    return data.filter(
      (p) =>
        p.exitScore !== undefined ||
        p.thesisStatus === 'VIOLATED' ||
        p.thesisStatus === 'EXPIRED',
    ).length;
  }, [positionsQuery.data]);

  // W14 통합 판단(중복 정보 반복 금지): 브리핑이 같은 소스(ExitSignal·thesisStatus)의 점검
  // 섹션을 이미 그리면 TodayCheckSlot 토글은 숨긴다 — 점검 표면은 화면당 1개.
  // 브리핑 실패/부재 시에는 기존 토글이 그대로 폴백(회귀 0).
  const briefingCoversChecks = (briefingQuery.data?.checks?.length ?? 0) > 0;

  const renderLive = () => {
    if (positionsQuery.isLoading) return <SkeletonList variant="buyScore" />;
    if (positionsQuery.isError) {
      return <ApiErrorState error={positionsQuery.error} title="포지션을 불러오지 못했습니다." onRetry={positionsQuery.refetch} />;
    }

    const summary = summaryQuery.data;
    const basisLabel = currentPortfolioBasisLabel();

    return (
      <View style={styles.liveBody}>
        {/* DAR-356: 검색/정렬은 요약과 리스트 사이에서 제거 → 헤더 상단 고정.
            스크롤로 사라지지 않고, 요약 글랜스 존을 밀어내지 않는다. 검색 대상이 있을 때만 노출. */}
        {(positionsQuery.data?.length ?? 0) > 0 ? (
          <View style={styles.fixedSearch}>
            <PositionSearchBar
              value={searchQuery}
              onChangeText={setSearchQuery}
              sortKey={sortKey}
              onSortChange={setSortKey}
            />
          </View>
        ) : null}
        <FlatList
          ref={listRef}
          data={filteredPositions}
          renderItem={renderPosition}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          removeClippedSubviews={false}
          initialNumToRender={8}
          maxToRenderPerBatch={8}
          windowSize={7}
          refreshing={positionsQuery.isRefetching}
          onRefresh={() => {
            positionsQuery.refetch();
            summaryQuery.refetch();
            riskQuery.refetch();
            briefingQuery.refetch();
          }}
          ListHeaderComponent={
          <View style={styles.liveHeader}>
            {/* UXR-13 C-3: 요약 쿼리 상태를 명시 처리 — 실패 시 헤드라인 무음 소실 금지.
                로딩은 자리 유지 스켈레톤(팝인 점프 제거), 캐시가 있으면 데이터 우선(리프레시
                실패로 화면을 비우지 않음), 캐시 없는 실패만 컴팩트 인라인 에러+재시도
                (EquityCurveCard '불러오지 못했습니다 · 다시 시도' 패턴 재사용). */}
            {summaryQuery.isLoading ? (
              <SummaryHeadlineSkeleton />
            ) : summary ? (
              <Surface elevation={1} style={[styles.summary, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                {/* DAR-356 GROUND-1: 총평가금액(대형) 1줄 + 손익 색조 1줄 = 2줄 헤드라인.
                    무스크롤 최상단에서 '내 상태 어때?'를 2초 내 글랜스로 파악. */}
                <View style={styles.summaryTopRow}>
                  <Text style={[typo.small, { color: colors.textSecondary }]}>총 평가금액</Text>
                  {/* DAR-356 GROUND-2: 신선도 정직 표기('기준: 실시간' | '기준: 장 마감'). */}
                  <Text style={[typo.small, { color: colors.textTertiary }]}>{basisLabel}</Text>
                </View>
                {/* DAR-451 C2: 세 탭(실전·내 모의·시스템 모의) 총평가금액 헤드라인을 동일
                    토큰(typo.h1 — DAR-356 글랜스 헤드라인)으로 통일. 실전 탭 기준 유지. */}
                <Text
                  style={[typo.h1, styles.headlineValue, { color: colors.text }]}
                  numberOfLines={1}
                  adjustsFontSizeToFit
                  minimumFontScale={0.7}
                >
                  {summary.totalValue.toLocaleString()}원
                </Text>
                {/* UXR-13 C-6: 손익 행은 내 모의 탭과 공용 렌더(아이콘+bodyMedium 700+부호 정본). */}
                <PnlHeadlineRow totalPnl={summary.totalPnl} totalPnlPercent={summary.totalPnlPercent} />
                {/* DAR-163/356: 리스크 스냅샷(하드룰 위반 전폭 배너 우선 → 일손익·집중도 1줄). 없으면 미표시.
                    UXR-13 C-3: 캐시 우선(리프레시 실패가 하드룰 경보를 지우지 않도록) —
                    캐시 없는 실패만 '스냅샷 없음'과 구분해 1줄 고지+재시도(무음 소실 방지). */}
                {riskQuery.data ? (
                  <PortfolioRiskBadge snapshot={riskQuery.data} style={styles.riskBadge} />
                ) : riskQuery.isError ? (
                  <TouchableOpacity
                    activeOpacity={0.7}
                    onPress={handleRetryRisk}
                    accessibilityRole="button"
                    accessibilityLabel="리스크 정보를 불러오지 못했습니다. 다시 시도"
                    style={[styles.inlineRetry, styles.riskBadge]}
                  >
                    <Feather name="refresh-cw" size={14} color={colors.primary} />
                    <Text style={[typo.small, { color: colors.primary }]}>
                      리스크 정보를 불러오지 못했습니다 · 다시 시도
                    </Text>
                  </TouchableOpacity>
                ) : null}
                {summary.mddBreached ? (
                  <Banner visible actions={[]} style={[styles.banner, { backgroundColor: colors.surfaceSecondary }]}>
                    <Text style={[typo.small, { color: colors.error }]}>
                      포트폴리오 손실 한도 초과 위험 — 포지션 점검이 필요합니다.
                    </Text>
                  </Banner>
                ) : null}
              </Surface>
            ) : summaryQuery.isError ? (
              <Surface elevation={1} style={[styles.summary, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                <Text style={[typo.small, { color: colors.textSecondary }]}>총 평가금액</Text>
                <TouchableOpacity
                  activeOpacity={0.7}
                  onPress={handleRetryHeadline}
                  accessibilityRole="button"
                  accessibilityLabel="요약을 불러오지 못했습니다. 다시 시도"
                  style={styles.inlineRetry}
                >
                  <Feather name="refresh-cw" size={14} color={colors.primary} />
                  <Text style={[typo.small, { color: colors.primary }]}>
                    요약을 불러오지 못했습니다 · 다시 시도
                  </Text>
                </TouchableOpacity>
              </Surface>
            ) : null}

            {/* W14 오늘의 브리핑 — 요약(글랜스 존, DAR-356) 바로 아래 상단 배치.
                내 종목 당일 이벤트·일간 손익·점검 포지션 결합 표면(각 항목 딥링크).
                섹션 0건·브리핑 null·로딩·에러는 전부 무렌더(0건 억제 — 소음 0). */}
            <TodayBriefingSection briefing={briefingQuery.data} />

            {/* DAR-356: '오늘 점검할 포지션'은 요약 아래 세컨더리 + 기본 접힘. 글랜스 존을 덮지 않는다.
                W14: 브리핑이 점검 섹션(같은 소스)을 그리는 동안은 숨김 — 점검 표면 이중 노출 방지. */}
            {todayCheckCount > 0 && !briefingCoversChecks ? (
              <View>
                <TouchableOpacity
                  style={[styles.collapseToggle, { borderColor: colors.borderLight, backgroundColor: colors.surface }]}
                  onPress={() => setShowTodayCheck((v) => !v)}
                  activeOpacity={0.7}
                  accessibilityRole="button"
                  accessibilityState={{ expanded: showTodayCheck }}
                  accessibilityLabel={`오늘 점검할 포지션 ${todayCheckCount}건 ${showTodayCheck ? '접기' : '펼치기'}`}
                >
                  <Feather name="check-circle" size={14} color={colors.textSecondary} />
                  <Text style={[typo.captionMedium, styles.collapseLabel, { color: colors.text }]}>
                    오늘 점검할 포지션 {todayCheckCount}건
                  </Text>
                  <Feather name={showTodayCheck ? 'chevron-up' : 'chevron-down'} size={16} color={colors.textSecondary} />
                </TouchableOpacity>
                {showTodayCheck ? (
                  <TodayCheckSlot positions={positionsQuery.data ?? []} onPress={handlePositionPress} />
                ) : null}
              </View>
            ) : null}
          </View>
        }
        ListEmptyComponent={
          // DAR-212: 실전은 실제 주문 엔드포인트가 없어(Engine5 게이트) 항상 빈 상태일 수 있다.
          // 매수 유도 CTA 대신 '준비 중'을 정직하게 안내하고, 지금 쓸 수 있는 '내 모의'로 보낸다.
          pickLiveEmptyState(positionsQuery.data?.length ?? 0) === 'preparing' ? (
            <EmptyState
              icon="clock"
              title="실전 거래는 준비 중이에요"
              description="실제 주문 기능은 아직 제공되지 않아요. 지금은 '내 모의' 탭에서 전략을 미리 확인해 보세요."
              actionLabel="내 모의 보기"
              onAction={() => setSubTab('paper')}
            />
          ) : (
            <EmptyState
              icon="search"
              title="검색 결과가 없어요"
              actionLabel="초기화"
              onAction={() => setSearchQuery('')}
            />
          )
        }
        />
      </View>
    );
  };

  const renderPaper = () => {
    if (paperQuery.isLoading) return <SkeletonList variant="buyScore" />;
    if (paperQuery.isError) {
      return <ApiErrorState error={paperQuery.error} title="모의투자 정보를 불러오지 못했습니다." onRetry={paperQuery.refetch} />;
    }

    const paper = paperQuery.data;

    return (
      <FlatList
        ref={listRef}
        data={paper?.positions ?? []}
        renderItem={renderPosition}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.listContent}
        showsVerticalScrollIndicator={false}
        removeClippedSubviews={false}
        initialNumToRender={8}
        maxToRenderPerBatch={8}
        windowSize={7}
        refreshing={paperQuery.isRefetching}
        onRefresh={paperQuery.refetch}
        ListHeaderComponent={
          <View style={styles.paperHeader}>
            <Banner visible actions={[]} icon="information" style={[styles.banner, { backgroundColor: colors.surfaceSecondary }]}>
              <Text style={[typo.small, { color: colors.info }]}>
                모의투자 중 — 실제 돈이 투입되지 않습니다.
              </Text>
            </Banner>
            {paper?.started ? (
              <Surface elevation={1} style={[styles.summary, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                <Text style={[typo.small, { color: colors.textSecondary }]}>가상 총자산</Text>
                {/* DAR-451 C2: 실전 탭과 동일 토큰(typo.h1)으로 통일. 실전 헤드라인과 같은
                    overflow 안전장치(adjustsFontSizeToFit)도 정합으로 동반. */}
                <Text
                  style={[typo.h1, { color: colors.text, marginTop: spacing.xs }]}
                  numberOfLines={1}
                  adjustsFontSizeToFit
                  minimumFontScale={0.7}
                >
                  {paper.totalAsset.toLocaleString()}원
                </Text>
                {/* UXR-13 C-6(DAR-451 C2 후속): 손익 행도 실전 탭과 동일 공용 렌더로 통일 —
                    아이콘·bodyMedium 700·양수 '+' 부호 병기(같은 지표=같은 시각 문법). */}
                <PnlHeadlineRow totalPnl={paper.totalPnl} totalPnlPercent={paper.totalPnlPercent} />
                {typeof paper.signalHitRate === 'number' ? (
                  <Text style={[typo.small, { color: colors.textSecondary, marginTop: spacing.sm }]}>
                    신호 적중률 {Math.round(paper.signalHitRate * 100)}%
                  </Text>
                ) : null}
              </Surface>
            ) : null}
          </View>
        }
        ListEmptyComponent={
          paper?.started ? (
            <EmptyState {...emptyStateCopy.paperTradingNoSignalsEmpty} />
          ) : (
            <EmptyState
              {...emptyStateCopy.paperTradingEmpty}
              description="신호 탭에서 매수 신호를 확인하면 AI 기반 가상 주문이 채워져요"
              onAction={() => router.push('/(tabs)/signals')}
            />
          )
        }
      />
    );
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={['top']}>
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <Text style={[typo.h2, { color: colors.text }]}>포트폴리오</Text>
        {/* DAR-372: 자동매매 상태(읽기전용 투명성) 진입을 헤더 상단에 항상 노출.
            기존 모의 성과 푸터 링크에만 의존하던 동선('탭으로만 유도돼 찾을 수 없음')을
            해소 — 어느 서브탭에서도 1탭 진입. */}
        <AutoTradingEntryButton />
      </View>

      {/* DAR-113: 포트폴리오는 전 탭 인증 필요(401). 게스트는 탭/빈·에러 화면 대신 로그인 유도. */}
      {!isAuthenticated ? (
        <GuestPrompt
          {...guestPromptCopy.portfolio}
          secondaryLabel="공시 먼저 둘러보기"
          onSecondary={() => router.push('/(tabs)/home')}
        />
      ) : (
        <>
          {/* DAR-212: 5분할 SegmentedButtons는 역할 라벨이 잘려(개념 과밀) 가로 스크롤 칩 행으로
              노출한다(DAR-156 종목상세 패턴 재사용). '내 모의'/'시스템 모의'로 주체를 구분.
              DAR-451 C1: 6탭이 구분 안내 없이 병렬이라 신규 사용자가 길을 잃음 → 그룹 머릿글
              ('내 운용'·'시스템 검증')을 각 그룹 첫 칩 앞에 1회 끼워 진입 오리엔테이션을 준다. */}
          <View style={styles.tabs}>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.tabScrollContent}
            >
              {groupedPortfolioTabs().map((grp, grpIndex) => (
                <React.Fragment key={grp.group}>
                  <Text
                    accessibilityRole="header"
                    accessibilityLabel={`${grp.label} 그룹`}
                    maxFontSizeMultiplier={MAX_CHIP_FONT_SCALE}
                    style={[
                      typo.small,
                      styles.tabGroupLabel,
                      grpIndex > 0 ? styles.tabGroupLabelGap : null,
                      { color: colors.textTertiary },
                    ]}
                  >
                    {grp.label}
                  </Text>
                  {grp.tabs.map((tab) => {
                    const isActive = subTab === tab.value;
                    return (
                      <TouchableOpacity
                        key={tab.value}
                        style={[
                          styles.tabChip,
                          isActive
                            ? { backgroundColor: colors.primary, borderColor: colors.primary }
                            : { backgroundColor: colors.surface, borderColor: colors.borderLight },
                        ]}
                        onPress={() => setSubTab(tab.value)}
                        activeOpacity={0.7}
                        hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }}
                        accessibilityRole="tab"
                        accessibilityState={{ selected: isActive }}
                        accessibilityLabel={tab.a11y}
                      >
                        <Text
                          numberOfLines={1}
                          maxFontSizeMultiplier={MAX_CHIP_FONT_SCALE}
                          style={[
                            typo.captionMedium,
                            { color: isActive ? colors.primaryForeground : colors.textSecondary },
                          ]}
                        >
                          {tab.label}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </React.Fragment>
              ))}
            </ScrollView>
          </View>

          <View style={styles.body}>
            {subTab === 'live'
              ? renderLive()
              : subTab === 'paper'
                ? renderPaper()
                : subTab === 'sim'
                  ? <SimulationStatusSection />
                  : subTab === 'strategy'
                    ? <StrategyComparisonSection />
                    : subTab === 'persona'
                      ? <PersonaTrackSection />
                      : <StyleComparisonSection />}
          </View>
        </>
      )}
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
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
  },
  tabs: {
    paddingTop: spacing.md,
  },
  tabScrollContent: {
    flexDirection: 'row',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
  },
  // DAR-451 C1: 그룹 머릿글 — 칩과 같은 행에서 세로 중앙 정렬, 약한 강조(tertiary + 600).
  tabGroupLabel: {
    alignSelf: 'center',
    fontWeight: '600',
  },
  // 두 번째 그룹부터 앞 그룹 칩과 시각적 간격을 더 벌려 그룹 경계를 명확히 한다.
  tabGroupLabelGap: {
    marginLeft: spacing.sm,
  },
  tabChip: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.base,
    paddingVertical: spacing.sm,
    borderRadius: radius.full,
    borderWidth: 1,
    minHeight: 36,
  },
  body: {
    flex: 1,
  },
  liveBody: {
    flex: 1,
  },
  fixedSearch: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
  },
  listContent: {
    padding: spacing.lg,
    gap: spacing.md,
    flexGrow: 1,
  },
  liveHeader: {
    gap: spacing.md,
    marginBottom: spacing.sm,
  },
  summary: {
    borderRadius: radius.lg,
    borderWidth: 1,
    padding: spacing.base,
  },
  summaryTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  headlineValue: {
    marginTop: spacing.xs,
  },
  headlinePnlRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    marginTop: spacing.xs,
  },
  headlinePnl: {
    fontWeight: '700',
  },
  riskBadge: {
    marginTop: spacing.md,
  },
  // UXR-13 C-3: 컴팩트 인라인 에러 재시도 행(EquityCurveCard curveRetry 패턴) — 44pt 터치영역.
  inlineRetry: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    minHeight: sizing.minTouchTarget,
  },
  collapseToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.base,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
    borderWidth: 1,
    minHeight: 44,
  },
  collapseLabel: {
    flex: 1,
  },
  paperHeader: {
    gap: spacing.md,
  },
  banner: {
    borderRadius: radius.md,
  },
});
