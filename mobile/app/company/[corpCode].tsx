import React, { useCallback, useMemo, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  Linking,
  RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons, Feather } from '@expo/vector-icons';
import { Chip, SegmentedButtons } from 'react-native-paper';
import { router, useLocalSearchParams } from 'expo-router';
import { useTheme } from '@theme';
import { spacing, radius } from '@theme/spacing';
import { Card } from '@components/common/Card';
import { useCompanyDetail } from '@hooks/useCompanyDetail';
import { useWatchlist, useAddToWatchlist, useRemoveFromWatchlist } from '@hooks/useWatchlist';
import { useRequireAuth } from '@hooks/useRequireAuth';
import { useCompanyEventStudy } from '@hooks/useEventStudy';
import { useCompanySignal } from '@hooks/useSignals';
import { gradeColor, gradeLabel } from '@utils/signalDisplay';
import { getTypeStyle, getTypeLabel } from '@utils/disclosureType';
import { parse, format } from 'date-fns';
import { LoadingState, EmptyState, ErrorState } from '@components/common/StateView';
import { DetailSkeleton } from '@components/common/DetailSkeleton';
import { DisclaimerSection } from '@components/common/DisclaimerSection';
import { PhilosophyFitBreakdown } from '@components/philosophy/PhilosophyFitBreakdown';
import { DecisionHubTab } from '@components/company/DecisionHubTab';
import { InsiderHoldingsTab } from '@components/company/InsiderHoldingsTab';
import { FundamentalsTab } from '@components/company/FundamentalsTab';
import { RiskStatusBadges } from '@components/common/RiskStatusBadges';
import { useCompanyPhilosophyFit } from '@hooks/usePhilosophies';
import { useStockRiskStatus } from '@hooks/useStockRiskStatus';
import type { EventStudyResult } from '@app-types/signal.types';

type CompanyTab = 'decision' | 'disclosures' | 'financials' | 'insider' | 'stats' | 'philosophy';

function formatEstDate(estDate: string | null): string {
  if (!estDate || estDate.length !== 8) return '-';
  return `${estDate.slice(0, 4)}.${estDate.slice(4, 6)}.${estDate.slice(6, 8)}`;
}

const MARKET_LABELS: Record<string, string> = {
  LISTED: '상장',
  KOSPI: '코스피',
  KOSDAQ: '코스닥',
  KONEX: '코넥스',
};

function getMarketLabel(corpCls: string | null, market: string | null): string {
  if (market) return MARKET_LABELS[market] ?? market;
  switch (corpCls) {
    case 'Y': return '코스피';
    case 'K': return '코스닥';
    case 'N': return '코넥스';
    default: return '비상장';
  }
}

function formatPct(value: number): string {
  const sign = value >= 0 ? '+' : '';
  return `${sign}${value.toFixed(1)}%`;
}

function PctText({ value, typo, colors }: {
  value: number;
  typo: ReturnType<typeof useTheme>['typography'];
  colors: ReturnType<typeof useTheme>['colors'];
}) {
  const color = value > 0 ? colors.success : value < 0 ? colors.error : colors.textSecondary;
  return (
    <Text style={[typo.bodyMedium, { color, fontWeight: '600' }]}>
      {formatPct(value)}
    </Text>
  );
}

interface EventStudyTabProps {
  corpCode: string;
}

function EventStudyTab({ corpCode }: EventStudyTabProps) {
  const { colors, typography: typo } = useTheme();
  const [selectedEventType, setSelectedEventType] = useState<string | undefined>(undefined);

  const { data, isLoading, isError, refetch, isRefetching } = useCompanyEventStudy(
    corpCode,
    selectedEventType,
  );

  const eventTypes = useMemo(() => {
    if (!data) return [];
    return Array.from(new Set(data.map((r) => r.eventType)));
  }, [data]);

  const selected = useMemo<EventStudyResult | undefined>(() => {
    if (!data || data.length === 0) return undefined;
    if (selectedEventType) return data.find((r) => r.eventType === selectedEventType);
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
        title="이 이벤트 유형의 과거 통계가 아직 없습니다."
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
            >
              {et}
            </Chip>
          ))}
        </ScrollView>
      )}

      {selected && (
        <View style={styles.statsContent}>
          {/* Sample count header */}
          <Text style={[typo.captionMedium, { color: colors.textSecondary, marginBottom: spacing.base }]}>
            {selected.eventType} 이벤트 통계 · 표본: {selected.sampleCount}건 기준
          </Text>

          {/* Sample size warning */}
          {selected.sampleCount < 30 && (
            <View
              style={[styles.warningBanner, { backgroundColor: colors.warning + '22', borderColor: colors.warning }]}
              accessibilityLabel={`표본 ${selected.sampleCount}건 — 통계 신뢰도 제한 안내`}
            >
              <Feather name="alert-triangle" size={14} color={colors.warning} />
              <Text style={[typo.small, { color: colors.warning, marginLeft: spacing.xs, flex: 1 }]}>
                {selected.sampleCount < 10
                  ? `표본이 부족해 통계 신뢰도가 낮습니다. (${selected.sampleCount}건)`
                  : `표본 ${selected.sampleCount}건으로 통계 신뢰도가 제한적입니다. 참고용으로만 활용하세요.`}
              </Text>
            </View>
          )}

          {/* D+N return table */}
          <Card variant="elevated" style={styles.tableCard}>
            <Text style={[typo.captionMedium, { color: colors.textSecondary, marginBottom: spacing.sm }]}>
              단순 수익률 (이벤트 이후)
            </Text>
            <View style={styles.tableHeader}>
              {['D+1', 'D+3', 'D+5', 'D+20'].map((label) => (
                <Text key={label} style={[typo.caption, { color: colors.textTertiary, flex: 1, textAlign: 'center' }]}>
                  {label}
                </Text>
              ))}
            </View>
            <View style={styles.tableRow}>
              <View style={{ flex: 1, alignItems: 'center' }}>
                <PctText value={selected.avgReturnD1} typo={typo} colors={colors} />
              </View>
              <View style={{ flex: 1, alignItems: 'center' }}>
                <PctText value={selected.avgReturnD3} typo={typo} colors={colors} />
              </View>
              <View style={{ flex: 1, alignItems: 'center' }}>
                <PctText value={selected.avgReturnD5} typo={typo} colors={colors} />
              </View>
              <View style={{ flex: 1, alignItems: 'center' }}>
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
              value={formatPct(selected.avgMaxDrawdown)}
              colors={colors}
              typo={typo}
              valueColor={colors.error}
              accessibilityLabel={`평균 최대낙폭: ${formatPct(selected.avgMaxDrawdown)}`}
            />
            <StatRow
              label="시장 대비 초과수익 D+5"
              value={formatPct(selected.avgArD5)}
              colors={colors}
              typo={typo}
              valueColor={selected.avgArD5 >= 0 ? colors.success : colors.error}
              accessibilityLabel={`시장 대비 초과수익 D+5: ${formatPct(selected.avgArD5)}`}
            />
          </Card>

          <Text style={[typo.small, { color: colors.textTertiary, textAlign: 'center', marginTop: spacing.sm }]}>
            집계 기간: {selected.dataFromDate} ~ {selected.dataToDate}
          </Text>
        </View>
      )}

      <View style={{ height: spacing['2xl'] }} />
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
    refetch: refetchCompany,
    isRefetching: isRefetchingCompany,
  } = useCompanyDetail(corpCode!);
  // DAR-99: 관리종목·거래정지·상폐위험 배지(손실 회피 1차 방어선, DART 폴백·근사값).
  const {
    data: riskStatus,
    refetch: refetchRisk,
    isRefetching: isRefetchingRisk,
  } = useStockRiskStatus({ corpCode: corpCode! });
  const { data: watchlistData } = useWatchlist({ enabled: isAuthenticated });
  const addToWatchlist = useAddToWatchlist();
  const removeFromWatchlist = useRemoveFromWatchlist();
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

  const handleToggleWatchlist = () => {
    if (!requireAuth()) return;
    if (!company) return;

    if (isWatched && watchlistItem) {
      removeFromWatchlist.mutate(watchlistItem.id);
    } else {
      addToWatchlist.mutate({ corpCode: company.corpCode, corpName: company.corpName });
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
            <Ionicons name="chevron-back" size={26} color={colors.text} />
          </TouchableOpacity>
        </View>
        <DetailSkeleton cards={[{ chip: true, lines: 2 }, { lines: 3 }, { lines: 2 }]} />
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
            <Ionicons name="chevron-back" size={26} color={colors.text} />
          </TouchableOpacity>
        </View>
        <View style={styles.loadingContainer}>
          <Text style={[typo.body, { color: colors.textSecondary }]}>기업 정보를 찾을 수 없습니다</Text>
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
          <Ionicons name="chevron-back" size={26} color={colors.text} />
        </TouchableOpacity>
        <Text style={[typo.h3, { color: colors.text, flex: 1 }]} numberOfLines={1}>
          {company.corpName}
        </Text>
        <View style={{ width: 26 }} />
      </View>

      {/* Company Header Card */}
      <View style={styles.companyCardWrap}>
        <Card style={styles.mainCard} variant="elevated">
          <View style={styles.companyHeader}>
            <View style={{ flex: 1 }}>
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
              <Text style={[typo.small, { color: colors.success, fontWeight: '600' }]}>
                {marketLabel}
              </Text>
            </View>
          </View>

          {company.stockCode && (
            <Text style={[typo.caption, { color: colors.textSecondary, marginTop: spacing.xs }]}>
              종목코드 {company.stockCode}
            </Text>
          )}

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
            <Text style={[
              typo.bodyMedium,
              { color: isWatched ? colors.text : colors.textInverse, marginLeft: spacing.xs },
            ]}>
              {isWatched ? '관심기업' : '관심기업 추가'}
            </Text>
          </TouchableOpacity>
        </Card>
      </View>

      {/* Tab selector */}
      <View style={[styles.tabWrap, { borderBottomColor: colors.borderLight }]}>
        <SegmentedButtons
          value={activeTab}
          onValueChange={(v) => setActiveTab(v as CompanyTab)}
          buttons={[
            { value: 'decision', label: '판단', accessibilityLabel: '종목 의사결정 허브 탭' },
            { value: 'disclosures', label: '공시', accessibilityLabel: '최근 공시 탭' },
            { value: 'financials', label: '재무', accessibilityLabel: '재무지표 펀더멘털 카드 탭' },
            { value: 'insider', label: '내부자', accessibilityLabel: '내부자·대량보유 동향 탭' },
            { value: 'stats', label: '통계', accessibilityLabel: 'Event Study 통계 탭' },
            { value: 'philosophy', label: '적합도', accessibilityLabel: '거장별 철학 적합도 탭' },
          ]}
          style={styles.segmented}
        />
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
              <Text style={[typo.h3, { color: colors.text, marginBottom: spacing.md }]}>기업 개요</Text>
              <Card variant="elevated">
                {overview.ceoName && (
                  <InfoRow icon="user" label="대표이사" value={overview.ceoName} colors={colors} typo={typo} />
                )}
                {overview.industryCode && (
                  <InfoRow icon="briefcase" label="업종코드" value={overview.industryCode} colors={colors} typo={typo} />
                )}
                {overview.estDate && (
                  <InfoRow icon="calendar" label="설립일" value={formatEstDate(overview.estDate)} colors={colors} typo={typo} />
                )}
                {overview.accMonth && (
                  <InfoRow icon="clock" label="결산월" value={`${overview.accMonth}월`} colors={colors} typo={typo} />
                )}
                {overview.address && (
                  <InfoRow icon="map-pin" label="주소" value={overview.address} colors={colors} typo={typo} />
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
                    <InfoRow icon="globe" label="홈페이지" value={overview.homepageUrl} colors={colors} typo={typo} isLink />
                  </TouchableOpacity>
                )}
              </Card>
            </View>
          )}

          <View style={styles.section}>
            <Text style={[typo.h3, { color: colors.text, marginBottom: spacing.md }]}>최근 공시</Text>
            {company.recentDisclosures.length === 0 ? (
              <Card variant="elevated">
                <Text style={[typo.body, { color: colors.textSecondary, textAlign: 'center', paddingVertical: spacing.lg }]}>
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
                            { color: getTypeStyle(disclosure.disclosureType, isDark).text, fontWeight: '600' },
                          ]}
                        >
                          {getTypeLabel(disclosure.disclosureType)}
                        </Text>
                      </View>
                      <Text style={[typo.small, { color: colors.textTertiary }]}>
                        {disclosure.rcpDt.length === 8
                          ? format(parse(disclosure.rcpDt, 'yyyyMMdd', new Date()), 'yyyy.MM.dd')
                          : disclosure.rcpDt}
                      </Text>
                    </View>
                    <Text style={[typo.body, { color: colors.text, marginTop: spacing.sm }]} numberOfLines={2}>
                      {disclosure.reportName}
                    </Text>
                  </Card>
                </TouchableOpacity>
              ))
            )}
          </View>

          <View style={{ height: spacing['2xl'] }} />
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
        <Text style={[typo.captionMedium, { color: colors.textSecondary, marginBottom: spacing.base }]}>
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
              <Feather name="chevron-right" size={16} color={colors.textTertiary} />
            </View>
            <View style={{ marginTop: spacing.sm }}>
              <PhilosophyFitBreakdown fit={fit} showBreakdown={false} />
            </View>
          </Card>
        </TouchableOpacity>
      ))}

      <DisclaimerSection style={styles.philosophyDisclaimer} />
      <View style={{ height: spacing['2xl'] }} />
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
        style={[styles.signalBadgeEmpty, { backgroundColor: colors.surface, borderColor: colors.borderLight }]}
        accessible
        accessibilityLabel="아직 매수 신호가 없습니다"
      >
        <Feather name="bell-off" size={13} color={colors.textTertiary} />
        <Text style={[typo.small, { color: colors.textTertiary, marginLeft: spacing.xs }]}>
          아직 매수 신호 없음
        </Text>
      </View>
    );
  }

  const color = gradeColor(data.grade, colors);
  const label = gradeLabel(data.grade);

  return (
    <TouchableOpacity
      style={[styles.signalBadgeRow, { backgroundColor: colors.surface, borderColor: colors.borderLight }]}
      activeOpacity={0.8}
      onPress={() => router.push(`/signals/${data.id}`)}
      accessibilityRole="button"
      accessibilityLabel={`매수 신호 ${label}, 점수 ${data.buyScore}점${data.entryReady ? ', 진입 준비 완료' : ''}. 신호 상세 보기`}
    >
      <View
        style={[styles.gradeChip, { backgroundColor: color + '22', borderColor: color }]}
      >
        <Text style={[typo.small, { color, fontWeight: '700' }]}>{label}</Text>
      </View>
      <Text
        style={[typo.bodyMedium, { color: colors.text, fontWeight: '700', marginLeft: spacing.sm }]}
      >
        {data.buyScore}점
      </Text>
      {data.entryReady && (
        <View style={[styles.entryReadyChip, { backgroundColor: colors.successSurface }]}>
          <Feather name="check-circle" size={12} color={colors.success} />
          <Text style={[typo.small, { color: colors.success, fontWeight: '600', marginLeft: 4 }]}>
            진입 준비
          </Text>
        </View>
      )}
      <View style={{ flex: 1 }} />
      <Feather name="chevron-right" size={16} color={colors.textTertiary} />
    </TouchableOpacity>
  );
}

function InfoRow({ icon, label, value, colors, typo, isLink }: {
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
        <Feather name={icon as keyof typeof Feather.glyphMap} size={14} color={colors.textTertiary} />
        <Text style={[typo.caption, { color: colors.textSecondary, marginLeft: spacing.sm }]}>{label}</Text>
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
  segmented: {
    alignSelf: 'stretch',
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
  warningBanner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    padding: spacing.sm,
    borderRadius: radius.sm,
    borderWidth: 1,
    marginBottom: spacing.base,
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
});
