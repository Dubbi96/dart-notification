import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  Linking,
  RefreshControl,
  ActivityIndicator,
  AppState,
  type AppStateStatus,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons, Feather } from '@expo/vector-icons';
import { Chip } from 'react-native-paper';
import { router, useLocalSearchParams, useFocusEffect } from 'expo-router';
import { useTheme, MAX_CHIP_FONT_SCALE } from '@theme';
import { spacing, radius, sizing } from '@theme/spacing';
import { verticalHitSlopForHeight } from '@utils/touchTarget';
import { Card } from '@components/common/Card';
import { useCompanyDetail } from '@hooks/useCompanyDetail';
import {
  useWatchlist,
  useAddToWatchlist,
  useRemoveFromWatchlist,
  useMarkWatchlistViewed,
} from '@hooks/useWatchlist';
import { useRequireAuth } from '@hooks/useRequireAuth';
import { useCompanyEventStudy } from '@hooks/useEventStudy';
import { useCompanySignal } from '@hooks/useSignals';
import { gradeColor, gradeLabel } from '@utils/signalDisplay';
import { formatReturnPct, returnColor } from '@utils/numberFormat';
import { getTypeStyle, getTypeLabel } from '@utils/disclosureType';
import { formatYmdDots } from '@utils/datetime';
import { isDataLimited } from '@utils/dataLimit';
import { LoadingState, EmptyState, ErrorState, ApiErrorState } from '@components/common/StateView';
import { DetailSkeleton } from '@components/common/DetailSkeleton';
import { DisclaimerSection } from '@components/common/DisclaimerSection';
import { DataLimitBadge } from '@components/common/DataLimitBadge';
import { PhilosophyFitBreakdown } from '@components/philosophy/PhilosophyFitBreakdown';
import { DecisionHubTab } from '@components/company/DecisionHubTab';
import { EventStudyObservationsDrilldown } from '@components/company/EventStudyObservationsDrilldown';
import { InsiderHoldingsTab } from '@components/company/InsiderHoldingsTab';
import { FundamentalsTab } from '@components/company/FundamentalsTab';
import { RiskStatusBadges } from '@components/common/RiskStatusBadges';
import { useCompanyPhilosophyFit } from '@hooks/usePhilosophies';
import { useStockRiskStatus } from '@hooks/useStockRiskStatus';
import { useStockQuotes } from '@hooks/useStockQuotes';
import { useMinuteCandles } from '@hooks/useMinuteCandles';
import { MinuteCandleChart } from '@components/company/MinuteCandleChart';
import { QuoteHeader } from '@components/common/QuoteHeader';
import { SourceAttribution } from '@components/common/SourceAttribution';
import { resolveQuotePollInterval } from '@utils/marketQuoteDisplay';
import { useHaptics } from '@hooks/useHaptics';
import { useSnackbar } from '@components/common/SnackbarProvider';
import { snackbarCopy, SNACKBAR_DURATION } from '@components/common/snackbarCopy';
import { OfflineStaleLabel } from '@components/common/OfflineStaleLabel';
import { isNotFoundError } from '@services/api';
import type { EventStudyResult } from '@app-types/signal.types';

type CompanyTab = 'decision' | 'disclosures' | 'financials' | 'insider' | 'stats' | 'philosophy';

// DAR-353: 현재가 라이브 폴링 간격(15s). 화면 포커스 + 앱 활성 + 장중에만 가동(배터리·비용).
const QUOTE_POLL_INTERVAL_MS = 15 * 1000;

// DAR-452/E4: 헤더 뒤로가기 아이콘 크기. 우측 스페이서 폭과 공유해 타이틀을 시각적으로 중앙 정렬한다.
// DAR-472: per-file 매직넘버 → 공용 sizing.icon 패밀리 SSOT(값 보존: lg=26·md=18).
const BACK_ICON_SIZE = sizing.icon.lg;
// DAR-452/E4: 분봉 차트 헤더의 접기/펼치기 chevron·전체화면 아이콘 크기.
const CHART_CHEVRON_SIZE = sizing.icon.md;
// 전체화면 링크의 보조 아이콘 — 스케일 밖 작은 값(14)이라 토큰 미적용(의도적 one-off).
const CHART_LINK_ICON_SIZE = 14;
// DAR-452/E4: 접기 토글 hitSlop — 시각 높이 유지 + 유효 터치 ≥44pt. (chevron+제목 ≈26pt + 24 = 50pt)
const CHART_TOUCH_HIT_SLOP = {
  top: spacing.md,
  bottom: spacing.md,
  left: spacing.sm,
  right: spacing.sm,
} as const;
// DAR-472: "크게 보기" 링크의 시각 높이(typo.small lineHeight=16; 아이콘 14<16). verticalHitSlopForHeight 로
// 세로 터치를 정확히 44pt까지 보정한다(기존 CHART_TOUCH_HIT_SLOP 으론 16+24=40pt < 44pt 였음).
const CHART_LINK_VISUAL_HEIGHT = 16;
// DAR-452/E4: 상단 6탭 칩 hitSlop(기존 인라인 {8,8,4,4} 토큰화). 가로는 인접 칩 오탭 방지로 좁게.
const TAB_CHIP_HIT_SLOP = {
  top: spacing.sm,
  bottom: spacing.sm,
  left: spacing.xs,
  right: spacing.xs,
} as const;

// 기업 상세 상단 6탭(DAR-156). 한 줄 SegmentedButtons는 좁은 기기에서 라벨이 압축·잘려
// 오탭을 유발하므로 가로 스크롤 칩 행으로 노출한다(홈 segmentTab 패턴 재사용).
const COMPANY_TABS: { value: CompanyTab; label: string; a11y: string }[] = [
  { value: 'decision', label: '판단', a11y: '종목 의사결정 허브 탭' },
  { value: 'disclosures', label: '공시', a11y: '최근 공시 탭' },
  { value: 'financials', label: '재무', a11y: '재무지표 펀더멘털 카드 탭' },
  { value: 'insider', label: '내부자', a11y: '내부자·대량보유 동향 탭' },
  { value: 'stats', label: '통계', a11y: 'Event Study 통계 탭' },
  { value: 'philosophy', label: '적합도', a11y: '거장별 철학 적합도 탭' },
];

const MARKET_LABELS: Record<string, string> = {
  LISTED: '상장',
  KOSPI: '코스피',
  KOSDAQ: '코스닥',
  KONEX: '코넥스',
};

function getMarketLabel(corpCls: string | null, market: string | null): string {
  if (market) return MARKET_LABELS[market] ?? market;
  switch (corpCls) {
    case 'Y':
      return '코스피';
    case 'K':
      return '코스닥';
    case 'N':
      return '코넥스';
    default:
      return '비상장';
  }
}

function PctText({
  value,
  typo,
  colors,
}: {
  value: number;
  typo: ReturnType<typeof useTheme>['typography'];
  colors: ReturnType<typeof useTheme>['colors'];
}) {
  return (
    <Text style={[typo.bodyMedium, { color: returnColor(value, colors), fontWeight: '600' }]}>
      {formatReturnPct(value)}
    </Text>
  );
}

interface EventStudyTabProps {
  corpCode: string;
}

function EventStudyTab({ corpCode }: EventStudyTabProps) {
  const { colors, typography: typo } = useTheme();
  const [selectedEventType, setSelectedEventType] = useState<string | undefined>(undefined);

  // UXR-6/E-1: 서버 필터 없이 전체 유형을 1회 조회하고 selectedEventType 은 클라이언트에서 고른다.
  // 종전엔 칩 탭마다 eventType 별 새 쿼리가 돌아 ①탭 전체가 로딩 화면으로 플래시되고
  // ②필터된 응답에서 eventTypes 가 1개로 줄어 칩 행 자체가 소멸(다른 유형 복귀 불가 트랩)했다.
  const { data, isLoading, isError, refetch, isRefetching } = useCompanyEventStudy(corpCode);

  // 무필터 응답 기준으로 고정 — 칩 선택과 무관하게 전체 유형 목록이 유지된다.
  const eventTypes = useMemo(() => {
    if (!data) return [];
    return Array.from(new Set(data.map((r) => r.eventType)));
  }, [data]);

  const selected = useMemo<EventStudyResult | undefined>(() => {
    if (!data || data.length === 0) return undefined;
    // 선택 유형이 응답에서 사라진 극단 케이스는 첫 유형으로 graceful 폴백.
    if (selectedEventType) return data.find((r) => r.eventType === selectedEventType) ?? data[0];
    return data[0];
  }, [data, selectedEventType]);

  if (isLoading) return <LoadingState message="통계 데이터를 불러오는 중…" />;
  if (isError)
    return (
      <ErrorState
        title="통계를 불러오지 못했습니다"
        description="잠시 후 다시 시도해 주세요."
        onRetry={refetch}
      />
    );
  if (!data || data.length === 0)
    return (
      <EmptyState
        icon="bar-chart-2"
        title="이 기업의 과거 이벤트 통계가 아직 없습니다."
        description="이벤트 스터디 데이터가 쌓이면 여기에 표시됩니다."
      />
    );

  return (
    <ScrollView
      showsVerticalScrollIndicator={false}
      contentContainerStyle={styles.statsScroll}
      refreshControl={
        <RefreshControl
          refreshing={isRefetching}
          onRefresh={refetch}
          colors={[colors.primary]}
          tintColor={colors.primary}
        />
      }
    >
      {/* Event type chip selector */}
      {eventTypes.length > 1 && (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.chipRow}
          contentContainerStyle={styles.chipRowContent}
        >
          {eventTypes.map((et) => (
            <Chip
              key={et}
              mode="outlined"
              selected={selectedEventType ? selectedEventType === et : eventTypes[0] === et}
              onPress={() => setSelectedEventType(et)}
              style={styles.chip}
              accessibilityLabel={`이벤트 유형: ${et}`}
              maxFontSizeMultiplier={MAX_CHIP_FONT_SCALE}
            >
              {et}
            </Chip>
          ))}
        </ScrollView>
      )}

      {selected && (
        <View style={styles.statsContent}>
          {/* Sample count header */}
          <Text
            style={[
              typo.captionMedium,
              { color: colors.textSecondary, marginBottom: spacing.base },
            ]}
          >
            {selected.eventType} 이벤트 통계 · 표본: {selected.sampleCount}건 기준
          </Text>

          {/* UXR-6/E-7: 표본 경고를 공용 규약(isDataLimited + DataLimitBadge, DAR-121 §6)으로 통일 —
              event-stats 와 동일 판정(유의성 반영) + 자체 배너·알파 hex 합성(warning+'22') 제거. */}
          {isDataLimited({
            sampleCount: selected.sampleCount,
            isSignificant: selected.isSignificant,
          }) && (
            <View style={styles.dataLimitWrap}>
              <DataLimitBadge />
              <Text style={[typo.small, { color: colors.textSecondary, marginTop: spacing.xs }]}>
                표본이 적거나 통계적으로 유의하지 않아 신뢰도가 제한적입니다. 참고용으로만
                활용하세요.
              </Text>
            </View>
          )}

          {/* D+N return table */}
          <Card variant="elevated" style={styles.tableCard}>
            <Text
              style={[
                typo.captionMedium,
                { color: colors.textSecondary, marginBottom: spacing.sm },
              ]}
            >
              단순 수익률 (이벤트 이후)
            </Text>
            <View style={styles.tableHeader}>
              {['D+1', 'D+3', 'D+5', 'D+20'].map((label) => (
                <Text
                  key={label}
                  style={[
                    typo.caption,
                    { color: colors.textTertiary, flex: 1, textAlign: 'center' },
                  ]}
                >
                  {label}
                </Text>
              ))}
            </View>
            <View style={styles.tableRow}>
              <View style={styles.tableCell}>
                <PctText value={selected.avgReturnD1} typo={typo} colors={colors} />
              </View>
              <View style={styles.tableCell}>
                <PctText value={selected.avgReturnD3} typo={typo} colors={colors} />
              </View>
              <View style={styles.tableCell}>
                <PctText value={selected.avgReturnD5} typo={typo} colors={colors} />
              </View>
              <View style={styles.tableCell}>
                <PctText value={selected.avgReturnD20} typo={typo} colors={colors} />
              </View>
            </View>
          </Card>

          {/* Key stats */}
          <Card variant="elevated" style={styles.tableCard}>
            <StatRow
              label="상승 확률 (D+5)"
              value={`${(selected.upProbD5 * 100).toFixed(0)}%`}
              colors={colors}
              typo={typo}
              valueColor={selected.upProbD5 >= 0.5 ? colors.success : colors.error}
              accessibilityLabel={`상승 확률 D+5: ${(selected.upProbD5 * 100).toFixed(0)}%`}
            />
            <StatRow
              label="평균 최대낙폭 (MDD)"
              value={formatReturnPct(selected.avgMaxDrawdown)}
              colors={colors}
              typo={typo}
              valueColor={colors.error}
              accessibilityLabel={`평균 최대낙폭: ${formatReturnPct(selected.avgMaxDrawdown)}`}
            />
            <StatRow
              label="시장 대비 초과수익 D+5"
              value={formatReturnPct(selected.avgArD5)}
              colors={colors}
              typo={typo}
              valueColor={returnColor(selected.avgArD5, colors)}
              accessibilityLabel={`시장 대비 초과수익 D+5: ${formatReturnPct(selected.avgArD5)}`}
            />
          </Card>

          <Text
            style={[
              typo.small,
              { color: colors.textTertiary, textAlign: 'center', marginTop: spacing.sm },
            ]}
          >
            집계 기간: {selected.dataFromDate} ~ {selected.dataToDate}
          </Text>

          {/* DAR-166: 버킷 구성 개별 관측치 드릴다운 — 표본 투명성(과신 방지) */}
          <EventStudyObservationsDrilldown
            bucketKey={selected.bucketKey}
            sampleCount={selected.sampleCount}
          />
        </View>
      )}

      <View style={styles.bottomSpacer} />
    </ScrollView>
  );
}

function StatRow({
  label,
  value,
  colors,
  typo,
  valueColor,
  accessibilityLabel,
}: {
  label: string;
  value: string;
  colors: ReturnType<typeof useTheme>['colors'];
  typo: ReturnType<typeof useTheme>['typography'];
  valueColor?: string;
  accessibilityLabel?: string;
}) {
  return (
    <View
      style={styles.statRow}
      accessible
      accessibilityLabel={accessibilityLabel ?? `${label}: ${value}`}
    >
      <Text style={[typo.body, { color: colors.textSecondary, flex: 1 }]}>{label}</Text>
      <Text style={[typo.bodyMedium, { color: valueColor ?? colors.text, fontWeight: '600' }]}>
        {value}
      </Text>
    </View>
  );
}

export default function CompanyDetailScreen() {
  const { corpCode } = useLocalSearchParams<{ corpCode: string }>();
  const { colors, typography: typo, isDark } = useTheme();
  const { isAuthenticated, requireAuth } = useRequireAuth();
  const {
    data: company,
    isLoading,
    isError: isCompanyError,
    error: companyError,
    refetch: refetchCompany,
    isRefetching: isRefetchingCompany,
  } = useCompanyDetail(corpCode!);
  // DAR-99: 관리종목·거래정지·상폐위험 배지(손실 회피 1차 방어선, DART 폴백·근사값).
  const {
    data: riskStatus,
    refetch: refetchRisk,
    isRefetching: isRefetchingRisk,
  } = useStockRiskStatus({ corpCode: corpCode! });
  // DAR-353: 현재가 라이브 자동갱신 — 화면 포커스 + 앱 활성 + 장중에만 ~15s 폴링(배터리·비용 배려).
  // 포커스 이탈/백그라운드/장 마감이면 폴링 off → 1회 fetch 한 종가만 graceful 표시.
  const [isFocused, setIsFocused] = useState(false);
  const [appActive, setAppActive] = useState(AppState.currentState === 'active');
  useFocusEffect(
    useCallback(() => {
      setIsFocused(true);
      return () => setIsFocused(false);
    }, []),
  );
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s: AppStateStatus) => {
      setAppActive(s === 'active');
    });
    return () => sub.remove();
  }, []);
  // UXR-6/P-8: refetchInterval 을 함수로 전달 — React Query 가 매 폴링 틱·렌더마다 장중 여부를
  // 재판정한다(useMinuteCandles 패턴과 일관). 렌더 시점 정적 평가(number|false)는 개장 전(예: 08:58)
  // 진입 시 09:00 이후에도 폴링이 시작되지 않고, 장중 진입 시 15:30 이후에도 폴링이 멈추지 않았다.
  const quotePollInterval = useCallback(
    () =>
      resolveQuotePollInterval({
        isFocused,
        appActive,
        now: new Date(),
        intervalMs: QUOTE_POLL_INTERVAL_MS,
      }),
    [isFocused, appActive],
  );
  // DAR-158/353: 최신 시세(현재가·전일대비·출처·갱신시각). 가격 없으면 헤더 미표시.
  const { quotes, dataUpdatedAt: quoteUpdatedAt } = useStockQuotes([company?.stockCode], {
    refetchInterval: quotePollInterval,
  });
  const quote = company?.stockCode ? quotes[company.stockCode] : null;
  // DAR-452/E1: 분봉 차트는 기본 접힘. 회사카드+차트가 탭 위에 고정돼 전 탭 뷰포트를 절반 잠식하던 문제를
  // 단일 토글로 해소한다(6개 탭 동시 개선). 펼칠 때만 차트를 렌더해 접힘 상태의 점유 높이를 헤더 한 줄로 축소.
  // (useMinuteCandles enabled 게이트보다 먼저 선언 — TDZ 회피.)
  const [isChartExpanded, setIsChartExpanded] = useState(false);
  const toggleChart = useCallback(() => setIsChartExpanded((prev) => !prev), []);
  // DAR-354: 당일 분봉(인트라데이) — 현재가 헤더 아래 차트. 장중에만 1분 폴링.
  // DAR-471: 지연 로딩 — 접힘 상태에선 enabled:false → 최초 발화·장중 폴링 모두 중단(펼칠 때만 조회).
  const {
    candles: minuteCandles,
    asOf: minuteCandlesAsOf,
    isLoading: isLoadingMinuteCandles,
    isError: isMinuteCandlesError,
    refetch: refetchMinuteCandles,
  } = useMinuteCandles(company?.stockCode, {
    pollWhileMarketOpen: true,
    enabled: isChartExpanded,
  });
  const { data: watchlistData } = useWatchlist({ enabled: isAuthenticated });
  const addToWatchlist = useAddToWatchlist();
  const removeFromWatchlist = useRemoveFromWatchlist();
  const markViewed = useMarkWatchlistViewed();
  const haptics = useHaptics();
  const { showSnackbar } = useSnackbar();
  const [activeTab, setActiveTab] = useState<CompanyTab>('decision');

  const watchlistItem = useMemo(
    () => watchlistData?.data?.find((item) => item.corpCode === corpCode),
    [watchlistData, corpCode],
  );
  const isWatched = !!watchlistItem;

  // 기업 개요·최근 공시·위험 배지 갱신(공시 탭 당겨서 새로고침).
  const handleRefreshOverview = useCallback(() => {
    refetchCompany();
    refetchRisk();
  }, [refetchCompany, refetchRisk]);

  // UXR-6/E-10: '최근 공시'는 서버가 자른 최근분만 — 전체 이력은 전체 공시 화면에
  // 기업명 프리필 검색(query 파라미터)으로 잇는다(기업명 재타이핑 없는 허브 응집 동선).
  const corpName = company?.corpName;
  const handleViewAllDisclosures = useCallback(() => {
    if (!corpName) return;
    router.push({ pathname: '/disclosures', params: { query: corpName } });
  }, [corpName]);

  // DAR-165: 관심 종목 상세 진입 시 조회 시각 갱신 → 신규 공시 unread 배지 소거.
  // 관심목록에 있고 미확인 신규 공시가 있을 때 corpCode당 1회만 호출(중복 mutation 방지).
  const markedRef = useRef<string | null>(null);
  useEffect(() => {
    if (!isAuthenticated || !corpCode) return;
    if (!isWatched) return;
    if ((watchlistItem?.newDisclosureCount ?? 0) <= 0) return;
    if (markedRef.current === corpCode) return;
    markedRef.current = corpCode;
    markViewed.mutate(corpCode);
  }, [isAuthenticated, corpCode, isWatched, watchlistItem?.newDisclosureCount, markViewed]);

  const handleToggleWatchlist = () => {
    if (!requireAuth()) return;
    if (!company) return;

    if (isWatched && watchlistItem) {
      // 해제: 성공 햅틱 + 스낵바 확인(낙관적 업데이트만으로 무피드백이던 갭 해소, DAR-172).
      removeFromWatchlist.mutate(watchlistItem.id, {
        onSuccess: () => {
          haptics.success();
          showSnackbar(snackbarCopy.watchlistRemoved(company.corpName), {
            duration: SNACKBAR_DURATION.success,
          });
        },
      });
    } else {
      // 추가: 성공 햅틱 + 스낵바, 실패 시 에러 스낵바(롤백은 훅 onError가 담당).
      addToWatchlist.mutate(
        { corpCode: company.corpCode, corpName: company.corpName },
        {
          onSuccess: () => {
            haptics.success();
            showSnackbar(snackbarCopy.watchlistAdded(company.corpName), {
              duration: SNACKBAR_DURATION.success,
            });
          },
          onError: () => {
            showSnackbar(snackbarCopy.watchlistAddFailed, {
              duration: SNACKBAR_DURATION.error,
            });
          },
        },
      );
    }
  };

  if (isLoading) {
    // 헤더(뒤로가기) 유지 + 기업 카드/탭 콘텐츠 골격 스켈레톤으로 로딩→콘텐츠 점프 제거(DAR-147).
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
        <View style={styles.header}>
          <TouchableOpacity
            onPress={() => router.back()}
            style={styles.backButton}
            accessibilityLabel="뒤로 가기"
            accessibilityRole="button"
          >
            <Ionicons name="chevron-back" size={BACK_ICON_SIZE} color={colors.text} />
          </TouchableOpacity>
        </View>
        <DetailSkeleton cards={[{ chip: true, lines: 2 }, { lines: 3 }, { lines: 2 }]} />
      </SafeAreaView>
    );
  }

  // DAR-187: 네트워크/서버 실패는 "기업 정보 없음"으로 위장하지 않고 사유 + 재시도 동선을 노출한다.
  // 진짜 미존재(서버 404)는 이 분기를 건너뛰어 아래 not-found 문구를 그대로 유지한다(두 케이스 분리).
  if (isCompanyError && !isNotFoundError(companyError)) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
        <View style={styles.header}>
          <TouchableOpacity
            onPress={() => router.back()}
            style={styles.backButton}
            accessibilityLabel="뒤로 가기"
            accessibilityRole="button"
          >
            <Ionicons name="chevron-back" size={BACK_ICON_SIZE} color={colors.text} />
          </TouchableOpacity>
        </View>
        <View style={styles.loadingContainer}>
          <ApiErrorState
            error={companyError}
            title="기업 정보를 불러오지 못했습니다"
            description="잠시 후 다시 시도해 주세요."
            onRetry={refetchCompany}
          />
        </View>
      </SafeAreaView>
    );
  }

  if (!company) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
        <View style={styles.header}>
          <TouchableOpacity
            onPress={() => router.back()}
            style={styles.backButton}
            accessibilityLabel="뒤로 가기"
            accessibilityRole="button"
          >
            <Ionicons name="chevron-back" size={BACK_ICON_SIZE} color={colors.text} />
          </TouchableOpacity>
        </View>
        <View style={styles.loadingContainer}>
          <Text style={[typo.body, { color: colors.textSecondary }]}>
            기업 정보를 찾을 수 없습니다
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  const overview = company.overview;
  const marketLabel = getMarketLabel(overview?.corpCls ?? null, company.market);

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => router.back()}
          style={styles.backButton}
          accessibilityLabel="뒤로 가기"
          accessibilityRole="button"
        >
          <Ionicons name="chevron-back" size={BACK_ICON_SIZE} color={colors.text} />
        </TouchableOpacity>
        <Text
          style={[typo.h3, styles.headerTitle, { color: colors.text, minWidth: 0 }]}
          numberOfLines={1}
          ellipsizeMode="tail"
        >
          {company.corpName}
        </Text>
        <View style={styles.headerSpacer} />
      </View>

      {/* Company Header Card */}
      <View style={styles.companyCardWrap}>
        <Card style={styles.mainCard} variant="elevated">
          <View style={styles.companyHeader}>
            <View style={styles.companyNameWrap}>
              <Text style={[typo.h2, { color: colors.text }]}>{company.corpName}</Text>
              {overview?.corpNameEng && (
                <Text style={[typo.small, { color: colors.textTertiary, marginTop: 2 }]}>
                  {overview.corpNameEng}
                </Text>
              )}
            </View>
            <View
              style={[styles.marketBadge, { backgroundColor: colors.successSurface }]}
              accessibilityLabel={`시장: ${marketLabel}`}
            >
              <Text
                style={[
                  typo.small,
                  { color: colors.success, fontWeight: '600', flexShrink: 1, minWidth: 0 },
                ]}
                numberOfLines={1}
                maxFontSizeMultiplier={MAX_CHIP_FONT_SCALE}
                ellipsizeMode="tail"
              >
                {marketLabel}
              </Text>
            </View>
          </View>

          {company.stockCode && (
            <Text style={[typo.caption, { color: colors.textSecondary, marginTop: spacing.xs }]}>
              종목코드 {company.stockCode}
            </Text>
          )}

          {/* DAR-353: 대형 현재가 헤더 — 현재가·등락(색+부호+금액)·출처 배지·갱신시각. 없으면 미표시. */}
          <QuoteHeader quote={quote} updatedAt={quoteUpdatedAt} style={styles.quoteHeader} />

          {/* DAR-173: 오프라인 시 '마지막 갱신 N분 전' 보조 라벨(stale 옛값 오인 방지). 온라인이면 미표시. */}
          {company.stockCode ? (
            <OfflineStaleLabel updatedAt={quoteUpdatedAt} style={styles.staleLabel} />
          ) : null}

          {/* DAR-99: 위험 배지 — 위험 없으면 미표시. 근사값(DART 공시 기반) 라벨 병기. */}
          <RiskStatusBadges status={riskStatus} style={styles.riskBadges} />

          {/* DAR-159: 종목 신호 배지 — 로그인 사용자에게만. 신호 없으면 빈상태 흡수. */}
          {isAuthenticated && <CompanySignalBadgeRow corpCode={corpCode!} />}

          <TouchableOpacity
            style={[
              styles.watchlistButton,
              { backgroundColor: isWatched ? colors.surface : colors.primary },
              isWatched && { borderWidth: 1, borderColor: colors.borderLight },
            ]}
            onPress={handleToggleWatchlist}
            activeOpacity={0.8}
            accessibilityLabel={isWatched ? '관심기업 해제' : '관심기업 추가'}
            accessibilityRole="button"
          >
            <Feather
              name={isWatched ? 'check' : 'plus'}
              size={16}
              color={isWatched ? colors.text : colors.textInverse}
            />
            <Text
              style={[
                typo.bodyMedium,
                { color: isWatched ? colors.text : colors.textInverse, marginLeft: spacing.xs },
              ]}
            >
              {isWatched ? '관심기업' : '관심기업 추가'}
            </Text>
          </TouchableOpacity>
        </Card>
      </View>

      {/* DAR-354: 분봉 차트 섹션 — 현재가 헤더 아래. 종목코드 있을 때만. 빈/로딩/에러 graceful.
          DAR-452/E1: 기본 접힘(접힘 시 헤더 한 줄만 점유) → 펼칠 때만 차트 렌더(전 탭 뷰포트 회수). */}
      {company.stockCode ? (
        <View style={styles.companyCardWrap}>
          <Card style={styles.mainCard} variant="elevated">
            <View style={styles.chartHeader}>
              {/* 접기/펼치기 토글 — chevron + 제목. 접힘 시 차트 높이만큼 뷰포트 회수. */}
              <TouchableOpacity
                onPress={toggleChart}
                hitSlop={CHART_TOUCH_HIT_SLOP}
                activeOpacity={0.7}
                accessibilityRole="button"
                accessibilityState={{ expanded: isChartExpanded }}
                accessibilityLabel={isChartExpanded ? '분봉 차트 접기' : '분봉 차트 펼치기'}
                style={styles.chartToggle}
              >
                <Feather
                  name={isChartExpanded ? 'chevron-down' : 'chevron-right'}
                  size={CHART_CHEVRON_SIZE}
                  color={colors.textSecondary}
                />
                <Text style={[typo.h3, styles.chartTitle, { color: colors.text }]}>분봉 차트</Text>
              </TouchableOpacity>
              {/* DAR-355: 전용 풀스크린 차트 화면(app/stock/[stockCode]) 진입. 접힘 여부와 무관하게 항상 노출. */}
              <TouchableOpacity
                onPress={() => router.push(`/stock/${company.stockCode}`)}
                hitSlop={verticalHitSlopForHeight(CHART_LINK_VISUAL_HEIGHT)}
                accessibilityRole="button"
                accessibilityLabel="전체화면 차트 보기"
                style={styles.chartExpandLink}
              >
                <Text style={[typo.small, styles.chartLinkText, { color: colors.primary }]}>
                  크게 보기
                </Text>
                <Feather name="maximize-2" size={CHART_LINK_ICON_SIZE} color={colors.primary} />
              </TouchableOpacity>
            </View>
            {isChartExpanded ? (
              <MinuteCandleChart
                candles={minuteCandles}
                asOf={minuteCandlesAsOf}
                isLoading={isLoadingMinuteCandles}
                isError={isMinuteCandlesError}
                onRetry={() => {
                  void refetchMinuteCandles();
                }}
              />
            ) : (
              <Text style={[typo.small, styles.chartCollapsedHint, { color: colors.textTertiary }]}>
                탭하여 당일 분봉 차트 보기
              </Text>
            )}
          </Card>
          {/* W2 컴플라이언스(M0 정책 §4): 출처 귀속 — 화면당 1회(현재가·분봉=KIS, 종가 폴백=KRX). */}
          <SourceAttribution sources={['KRX', 'KIS']} style={styles.sourceAttribution} />
        </View>
      ) : null}

      {/* Tab selector — 6탭 가로 스크롤 칩 행(DAR-156): 좁은 기기 라벨 압축·오탭 방지 */}
      <View style={[styles.tabWrap, { borderBottomColor: colors.borderLight }]}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.tabScrollContent}
        >
          {COMPANY_TABS.map((tab) => {
            const isActive = activeTab === tab.value;
            return (
              <TouchableOpacity
                key={tab.value}
                style={[
                  styles.tabChip,
                  isActive
                    ? { backgroundColor: colors.primary, borderColor: colors.primary }
                    : { backgroundColor: colors.surface, borderColor: colors.borderLight },
                ]}
                onPress={() => setActiveTab(tab.value)}
                activeOpacity={0.7}
                hitSlop={TAB_CHIP_HIT_SLOP}
                accessibilityRole="tab"
                accessibilityState={{ selected: isActive }}
                accessibilityLabel={tab.a11y}
              >
                <Text
                  style={[
                    typo.captionMedium,
                    {
                      color: isActive ? colors.primaryForeground : colors.textSecondary,
                      flexShrink: 1,
                      minWidth: 0,
                    },
                  ]}
                  numberOfLines={1}
                  maxFontSizeMultiplier={MAX_CHIP_FONT_SCALE}
                  ellipsizeMode="tail"
                >
                  {tab.label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      </View>

      {/* Tab content */}
      {activeTab === 'decision' ? (
        <DecisionHubTab corpCode={corpCode!} />
      ) : activeTab === 'disclosures' ? (
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.scrollContent}
          refreshControl={
            <RefreshControl
              refreshing={isRefetchingCompany || isRefetchingRisk}
              onRefresh={handleRefreshOverview}
              colors={[colors.primary]}
              tintColor={colors.primary}
            />
          }
        >
          {overview && (
            <View style={styles.section}>
              <Text style={[typo.h3, { color: colors.text, marginBottom: spacing.md }]}>
                기업 개요
              </Text>
              <Card variant="elevated">
                {overview.ceoName && (
                  <InfoRow
                    icon="user"
                    label="대표이사"
                    value={overview.ceoName}
                    colors={colors}
                    typo={typo}
                  />
                )}
                {overview.industryCode && (
                  <InfoRow
                    icon="briefcase"
                    label="업종코드"
                    value={overview.industryCode}
                    colors={colors}
                    typo={typo}
                  />
                )}
                {overview.estDate && (
                  <InfoRow
                    icon="calendar"
                    label="설립일"
                    value={formatYmdDots(overview.estDate)}
                    colors={colors}
                    typo={typo}
                  />
                )}
                {overview.accMonth && (
                  <InfoRow
                    icon="clock"
                    label="결산월"
                    value={`${overview.accMonth}월`}
                    colors={colors}
                    typo={typo}
                  />
                )}
                {overview.address && (
                  <InfoRow
                    icon="map-pin"
                    label="주소"
                    value={overview.address}
                    colors={colors}
                    typo={typo}
                  />
                )}
                {overview.homepageUrl && (
                  <TouchableOpacity
                    onPress={() => {
                      const url = overview.homepageUrl!.startsWith('http')
                        ? overview.homepageUrl!
                        : `https://${overview.homepageUrl}`;
                      Linking.openURL(url);
                    }}
                    accessibilityRole="link"
                    accessibilityLabel={`홈페이지: ${overview.homepageUrl}`}
                  >
                    <InfoRow
                      icon="globe"
                      label="홈페이지"
                      value={overview.homepageUrl}
                      colors={colors}
                      typo={typo}
                      isLink
                    />
                  </TouchableOpacity>
                )}
              </Card>
            </View>
          )}

          <View style={styles.section}>
            <Text style={[typo.h3, { color: colors.text, marginBottom: spacing.md }]}>
              최근 공시
            </Text>
            {company.recentDisclosures.length === 0 ? (
              <Card variant="elevated">
                <Text
                  style={[
                    typo.body,
                    {
                      color: colors.textSecondary,
                      textAlign: 'center',
                      paddingVertical: spacing.lg,
                    },
                  ]}
                >
                  최근 공시가 없습니다
                </Text>
              </Card>
            ) : (
              company.recentDisclosures.map((disclosure) => (
                <TouchableOpacity
                  key={disclosure.rcpNo}
                  activeOpacity={0.7}
                  onPress={() => router.push(`/disclosure/${disclosure.rcpNo}`)}
                  accessibilityRole="button"
                  accessibilityLabel={`공시: ${disclosure.reportName}`}
                >
                  <Card style={styles.disclosureCard} variant="elevated">
                    <View style={styles.disclosureHeader}>
                      <View
                        style={[
                          styles.typeBadge,
                          { backgroundColor: getTypeStyle(disclosure.disclosureType, isDark).bg },
                        ]}
                      >
                        <Text
                          style={[
                            typo.small,
                            {
                              color: getTypeStyle(disclosure.disclosureType, isDark).text,
                              fontWeight: '600',
                            },
                          ]}
                          maxFontSizeMultiplier={MAX_CHIP_FONT_SCALE}
                        >
                          {getTypeLabel(disclosure.disclosureType)}
                        </Text>
                      </View>
                      <Text style={[typo.small, { color: colors.textTertiary }]}>
                        {formatYmdDots(disclosure.rcpDt)}
                      </Text>
                    </View>
                    <Text
                      style={[typo.body, { color: colors.text, marginTop: spacing.sm }]}
                      numberOfLines={2}
                    >
                      {disclosure.reportName}
                    </Text>
                  </Card>
                </TouchableOpacity>
              ))
            )}
            {/* UXR-6/E-10: 이 기업 공시 전체 이력 동선 — 전체 공시 화면에 기업명 프리필 검색 진입. */}
            {company.recentDisclosures.length > 0 && (
              <TouchableOpacity
                style={[
                  styles.allDisclosuresLink,
                  { backgroundColor: colors.surface, borderColor: colors.borderLight },
                ]}
                onPress={handleViewAllDisclosures}
                activeOpacity={0.7}
                accessibilityRole="button"
                accessibilityLabel={`${company.corpName} 공시 전체 보기`}
              >
                <Text style={[typo.bodyMedium, { color: colors.primary, fontWeight: '600' }]}>
                  이 기업 공시 전체 보기
                </Text>
                <Feather name="chevron-right" size={sizing.icon.sm} color={colors.primary} />
              </TouchableOpacity>
            )}
          </View>

          <View style={styles.bottomSpacer} />
        </ScrollView>
      ) : activeTab === 'financials' ? (
        <FundamentalsTab corpCode={corpCode!} corpName={company.corpName} />
      ) : activeTab === 'insider' ? (
        <InsiderHoldingsTab corpCode={corpCode!} />
      ) : activeTab === 'stats' ? (
        <EventStudyTab corpCode={corpCode!} />
      ) : (
        <CompanyPhilosophyTab corpCode={corpCode!} corpName={company.corpName} />
      )}
    </SafeAreaView>
  );
}

// 종목 × 거장별 적합도(DAR-54) — /companies/:corpCode/philosophy-fit.
// 어느 거장 철학에 맞는지(점수 내림차순) + 통과/미달 근거지표. 게스트 열람 가능. 참고용(면책).
interface CompanyPhilosophyTabProps {
  corpCode: string;
  corpName: string;
}

function CompanyPhilosophyTab({ corpCode, corpName }: CompanyPhilosophyTabProps) {
  const { colors, typography: typo } = useTheme();
  const { data, isLoading, isError, refetch, isRefetching } = useCompanyPhilosophyFit(corpCode);

  if (isLoading) return <LoadingState message="거장별 적합도를 계산하는 중…" />;
  if (isError)
    return (
      <ErrorState
        title="적합도를 불러오지 못했습니다"
        description="잠시 후 다시 시도해 주세요."
        onRetry={refetch}
      />
    );
  if (!data || data.noFinancials || data.fits.length === 0)
    return (
      <EmptyState
        icon="bar-chart-2"
        title="재무 데이터가 아직 없습니다."
        description={`${corpName}의 재무제표가 수집되면 거장별 적합도를 표시합니다.`}
      />
    );

  const basis = data.financialBasis;

  return (
    <ScrollView
      showsVerticalScrollIndicator={false}
      contentContainerStyle={styles.statsScroll}
      refreshControl={
        <RefreshControl
          refreshing={isRefetching}
          onRefresh={refetch}
          colors={[colors.primary]}
          tintColor={colors.primary}
        />
      }
    >
      {basis ? (
        <Text
          style={[typo.captionMedium, { color: colors.textSecondary, marginBottom: spacing.base }]}
        >
          {basis.bsnsYear}년 {basis.fsDiv} 재무 기준 · 점수 높은 순
        </Text>
      ) : null}

      {data.fits.map((fit) => (
        <TouchableOpacity
          key={fit.philosophyId}
          activeOpacity={0.8}
          onPress={() =>
            // DAR-57: 거장별 적합도 카드 탭 → 항목별 통과/미달 체크리스트 분해.
            router.push({
              pathname: '/philosophy/checklist',
              params: { id: fit.philosophyId, corpCode, corpName },
            })
          }
          accessibilityRole="button"
          accessibilityLabel={`${fit.investorName} 항목별 체크리스트 분해 보기`}
        >
          <Card variant="elevated" style={styles.tableCard}>
            <View style={styles.philosophyFitHeader}>
              <Text style={[typo.bodyMedium, { color: colors.text }]}>{fit.investorName}</Text>
              <Feather name="chevron-right" size={sizing.icon.sm} color={colors.textTertiary} />
            </View>
            <View style={{ marginTop: spacing.sm }}>
              <PhilosophyFitBreakdown fit={fit} showBreakdown={false} />
            </View>
          </Card>
        </TouchableOpacity>
      ))}

      <DisclaimerSection style={styles.philosophyDisclaimer} />
      <View style={styles.bottomSpacer} />
    </ScrollView>
  );
}

// DAR-159: 종목 상세 헤더 신호 배지 — 해당 종목 최신 매수 신호(등급·점수·진입준비)를
// 전용 엔드포인트로 단건 조회해 노출한다. 신호 없으면 '신호 없음' 빈상태로 흡수.
// 로그인 사용자에게만 마운트(게스트는 신호 비노출 → 401 회피).
function CompanySignalBadgeRow({ corpCode }: { corpCode: string }) {
  const { colors, typography: typo } = useTheme();
  const { data, isLoading } = useCompanySignal(corpCode);

  if (isLoading) {
    return (
      <View style={styles.signalBadgeLoading} accessibilityLabel="종목 신호 불러오는 중">
        <ActivityIndicator size="small" color={colors.primary} />
      </View>
    );
  }

  if (!data) {
    return (
      <View
        style={[
          styles.signalBadgeEmpty,
          { backgroundColor: colors.surface, borderColor: colors.borderLight },
        ]}
        accessible
        accessibilityLabel="아직 매수 신호가 없습니다"
      >
        <Feather name="bell-off" size={13} color={colors.textTertiary} />
        <Text
          style={[typo.small, { color: colors.textTertiary, marginLeft: spacing.xs }]}
          maxFontSizeMultiplier={MAX_CHIP_FONT_SCALE}
        >
          아직 매수 신호 없음
        </Text>
      </View>
    );
  }

  const color = gradeColor(data.grade, colors);
  const label = gradeLabel(data.grade);

  return (
    <TouchableOpacity
      style={[
        styles.signalBadgeRow,
        { backgroundColor: colors.surface, borderColor: colors.borderLight },
      ]}
      activeOpacity={0.8}
      onPress={() => router.push(`/signals/${data.id}`)}
      accessibilityRole="button"
      accessibilityLabel={`매수 신호 ${label}, 점수 ${data.buyScore}점${data.entryReady ? ', 진입 준비 완료' : ''}. 신호 상세 보기`}
    >
      {/* UXR-6/E-7: 알파 hex 합성(color+'22') 제거 — 등급칩 서피스는 신호 카드들과 동일하게
          surfaceSecondary 토큰(BuyScoreCard/CuratedSignalCard 규약), 등급색은 테두리·라벨로 유지. */}
      <View
        style={[styles.gradeChip, { backgroundColor: colors.surfaceSecondary, borderColor: color }]}
      >
        <Text
          style={[typo.small, { color, fontWeight: '700', flexShrink: 1, minWidth: 0 }]}
          numberOfLines={1}
          maxFontSizeMultiplier={MAX_CHIP_FONT_SCALE}
          ellipsizeMode="tail"
        >
          {label}
        </Text>
      </View>
      <Text
        style={[typo.bodyMedium, { color: colors.text, fontWeight: '700', marginLeft: spacing.sm }]}
      >
        {data.buyScore}점
      </Text>
      {data.entryReady && (
        <View style={[styles.entryReadyChip, { backgroundColor: colors.successSurface }]}>
          <Feather name="check-circle" size={12} color={colors.success} />
          <Text
            style={[
              typo.small,
              styles.entryReadyText,
              { color: colors.success, flexShrink: 1, minWidth: 0 },
            ]}
            numberOfLines={1}
            maxFontSizeMultiplier={MAX_CHIP_FONT_SCALE}
            ellipsizeMode="tail"
          >
            진입 준비
          </Text>
        </View>
      )}
      <View style={styles.flexSpacer} />
      <Feather name="chevron-right" size={sizing.icon.sm} color={colors.textTertiary} />
    </TouchableOpacity>
  );
}

function InfoRow({
  icon,
  label,
  value,
  colors,
  typo,
  isLink,
}: {
  icon: string;
  label: string;
  value: string;
  colors: ReturnType<typeof useTheme>['colors'];
  typo: ReturnType<typeof useTheme>['typography'];
  isLink?: boolean;
}) {
  return (
    <View style={styles.infoRow}>
      <View style={styles.infoLabel}>
        <Feather
          name={icon as keyof typeof Feather.glyphMap}
          size={14}
          color={colors.textTertiary}
        />
        <Text style={[typo.caption, { color: colors.textSecondary, marginLeft: spacing.sm }]}>
          {label}
        </Text>
      </View>
      <Text
        style={[
          typo.body,
          { color: isLink ? colors.primary : colors.text, flex: 1, textAlign: 'right' },
          isLink && { textDecorationLine: 'underline' },
        ]}
        numberOfLines={2}
      >
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingRight: spacing.lg,
    paddingVertical: spacing.sm,
  },
  backButton: {
    padding: spacing.sm,
    paddingHorizontal: spacing.base,
    minWidth: 44,
    minHeight: 44,
    justifyContent: 'center',
  },
  companyCardWrap: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
  },
  // W2: 차트 카드 아래 출처 귀속 한 줄(화면당 1회).
  sourceAttribution: {
    marginTop: spacing.xs,
  },
  scrollContent: {
    paddingTop: spacing.md,
    paddingHorizontal: spacing.lg,
  },
  mainCard: {
    marginBottom: 0,
  },
  companyHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
  },
  marketBadge: {
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: radius.sm,
    marginLeft: spacing.sm,
  },
  riskBadges: {
    marginTop: spacing.sm,
  },
  signalBadgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
    borderWidth: 1,
    marginTop: spacing.sm,
    minHeight: 44,
  },
  signalBadgeEmpty: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
    borderWidth: 1,
    marginTop: spacing.sm,
  },
  signalBadgeLoading: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.sm,
    marginTop: spacing.sm,
    minHeight: 44,
  },
  gradeChip: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: radius.sm,
    borderWidth: 1,
  },
  entryReadyChip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: radius.sm,
    marginLeft: spacing.sm,
  },
  quoteHeader: {
    marginTop: spacing.sm,
  },
  staleLabel: {
    marginTop: spacing.xs,
  },
  watchlistButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.sm + 2,
    borderRadius: radius.md,
    marginTop: spacing.base,
    minHeight: 44,
  },
  tabWrap: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.base,
    paddingBottom: spacing.sm,
    borderBottomWidth: 1,
  },
  tabScrollContent: {
    flexDirection: 'row',
    gap: spacing.sm,
    paddingRight: spacing.lg,
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
  section: {
    marginTop: spacing.xl,
  },
  infoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.sm,
  },
  infoLabel: {
    flexDirection: 'row',
    alignItems: 'center',
    minWidth: 90,
  },
  disclosureCard: {
    marginBottom: spacing.sm,
  },
  disclosureHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  typeBadge: {
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: radius.sm,
  },
  statsScroll: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.base,
  },
  statsContent: {
    marginTop: spacing.sm,
  },
  tableCard: {
    marginBottom: spacing.base,
  },
  tableHeader: {
    flexDirection: 'row',
    marginBottom: spacing.sm,
  },
  tableRow: {
    flexDirection: 'row',
  },
  statRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.sm,
  },
  // UXR-6/E-7: 공용 DataLimitBadge + 보조 문구 래퍼(자체 warningBanner 대체).
  dataLimitWrap: {
    marginBottom: spacing.base,
  },
  // UXR-6/E-10: '이 기업 공시 전체 보기' 행 — 유효 터치 ≥44pt.
  allDisclosuresLink: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
    borderWidth: 1,
    minHeight: 44,
  },
  chipRow: {
    marginBottom: spacing.sm,
  },
  chipRowContent: {
    gap: spacing.sm,
    paddingRight: spacing.lg,
  },
  chip: {
    marginRight: spacing.xs,
  },
  philosophyFitHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  philosophyDisclaimer: {
    marginTop: spacing.base,
  },
  // DAR-452/E4: 인라인 스타일·매직넘버 추출 ──────────────────────────────
  headerTitle: {
    flex: 1,
  },
  headerSpacer: {
    width: BACK_ICON_SIZE,
  },
  companyNameWrap: {
    flex: 1,
  },
  chartHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  chartToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  chartTitle: {
    marginLeft: spacing.xs,
  },
  chartExpandLink: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  chartLinkText: {
    fontWeight: '600',
  },
  chartCollapsedHint: {
    paddingVertical: spacing.xs,
  },
  tableCell: {
    flex: 1,
    alignItems: 'center',
  },
  entryReadyText: {
    fontWeight: '600',
    marginLeft: spacing.xs,
  },
  flexSpacer: {
    flex: 1,
  },
  bottomSpacer: {
    height: spacing['2xl'],
  },
});
