import React, { useCallback, useMemo } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, FlatList } from 'react-native';
import { Surface, Chip } from 'react-native-paper';
import { Feather } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useTheme, MAX_CHIP_FONT_SCALE } from '@theme';
import { spacing, radius } from '@theme/spacing';
import { ScoreGauge } from '@components/common/ScoreGauge';
import { EvidenceMeta } from '@components/common/EvidenceMeta';
import { AiReferenceLabel } from '@components/common/AiReferenceLabel';
import { ApiErrorState } from '@components/common/StateView';
import { GuestPrompt } from '@components/common/GuestPrompt';
import { SkeletonCard } from '@components/common/SkeletonCard';
import { emptyStateCopy } from '@components/common/emptyStateCopy';
import { guestPromptCopy } from '@components/common/guestPromptCopy';
import { gradeColor, gradeLabel, scoreOneLiner } from '@utils/signalDisplay';
import { getEventTypeLabel } from '@utils/disclosureType';
import {
  SIGNAL_TERMS,
  buildSignalCardA11yLabel,
  buildEditionTitle,
  editionDateLabel,
  editionDateA11yLabel,
  isTodayKst,
} from '@utils/signalTerms';
import { curateBuySignals } from '@utils/signalCuration';
import { isChartableTicker, navigateToStockChart } from '@utils/stockChartLink';
import { useBuySignals } from '@hooks/useSignals';
import { useCarouselCardWidth } from '@hooks/useCarouselCardWidth';
import { CAROUSEL_GAP } from '@utils/carouselMetrics';

import type { TradingSignal } from '@app-types/signal.types';

// 홈 '오늘의 투자판단' 프리뷰 슬롯(DAR-61, 상용 패널 #8).
// summaryCard 아래 최상단에 상위 1~3 매수등급 시그널을 가로 카루셀로 노출해
// "공시→투자판단" 동선을 첫 화면 1순위로 끌어올린다.
// 정직 원칙(§2): 매수등급(STRONG_BUY/BUY)이 0이면 가짜 BUY를 만들지 않고
// '점수순 탐색' 빈 상태로 안내한다. 게스트는 1건 미리보기 + 잠금 오버레이.

const MAX_PREVIEW = 3;
const EXPLORE_ROUTE = '/(tabs)/signals' as const;

interface HomeSignalPreviewProps {
  /** 로그인 여부 — 게스트는 1건 미리보기 + 잠금 오버레이(§3). */
  isAuthenticated: boolean;
}

// '표본 N건'의 의미 고정: scoreBreakdown 전체 max 집계(의미 불명) 대신 통계 파생 항목인
// historicalEvent(과거 유사 공시 EventStudy 표본)를 직접 참조한다 — 백엔드 signals.service
// STAT_DERIVED_KEYS(historicalEvent)와 1:1. 과신 방지 신뢰표기(DAR-56)는 그대로 유지.
const HISTORICAL_EVENT_KEY = 'historicalEvent';

interface HistoricalEvidence {
  /** historicalEvent 항목의 표본수(EventStudyResult.sampleCount). */
  n: number;
  /** 백엔드 sampleScope(후속 옵셔널) 존재 시 '이벤트 라벨(스코프)' 병기 라벨. */
  scopeLabel?: string;
}

/** historicalEvent 항목의 표본 근거. 표본이 없으면 undefined(호출부가 정직 결측 표기). */
function historicalEventEvidence(signal: TradingSignal): HistoricalEvidence | undefined {
  const item = (signal.scoreBreakdown ?? []).find((c) => c.key === HISTORICAL_EVENT_KEY);
  if (!item || typeof item.sampleN !== 'number' || item.sampleN <= 0) return undefined;
  // '표본 1,871건 · 대규모 공급계약(전체시장)' 형식 — 이벤트 라벨은 EVENT_TYPE_LABEL 재사용
  // (raw enum 노출 방지). sampleScope 미도착 시 현행 '표본 N건' 유지(방어적 지원).
  const scopeLabel = item.sampleScope
    ? signal.eventType
      ? `${getEventTypeLabel(signal.eventType)}(${item.sampleScope})`
      : item.sampleScope
    : undefined;
  return { n: item.sampleN, scopeLabel };
}

interface SignalPreviewCardProps {
  signal: TradingSignal;
  onPress: (signal: TradingSignal) => void;
  /** 화면 폭 반응형 카드 폭(DAR-301). */
  cardWidth: number;
}

function SignalPreviewCard({ signal, onPress, cardWidth }: SignalPreviewCardProps) {
  const { colors, typography: typo } = useTheme();
  const evidence = historicalEventEvidence(signal);
  // DAR-504: 발행일(createdAt) KST 'M/D' 날짜배지 — 헤더 '오늘' 단정을 카드 단위로도 정직화.
  const dateLabel = editionDateLabel(signal.createdAt);
  const handlePress = useCallback(() => onPress(signal), [onPress, signal]);
  // DAR-363: 홈 프리뷰 카드에서 해당 종목 실시간 차트로 직접 진입. 6자리 종목코드 있을 때만.
  const handleChartPress = useCallback(() => navigateToStockChart(signal.ticker), [signal.ticker]);
  const chartable = isChartableTicker(signal.ticker);

  return (
    <TouchableOpacity
      activeOpacity={0.85}
      onPress={handlePress}
      // DAR-319: 카드 간격을 carousel gap 대신 카드 marginRight 로 결정론 적용(스켈레톤과 동일,
      // Android Fabric gap 미적용 대비 크로스플랫폼 일관).
      style={styles.cardTouchable}
      accessibilityRole="button"
      // 카드 그룹핑(§8-1): 카드를 단일 단위로 읽어 내부 중복 읽기 방지.
      // 용어 위계 L2 고정(DAR-217): 카드 a11y는 SSOT 빌더로 '매수 신호'+'Buy Score' 일관.
      accessibilityLabel={buildSignalCardA11yLabel({
        corpName: signal.corpName,
        buyScore: signal.buyScore,
        gradeText: gradeLabel(signal.grade),
        // DAR-504: 시각 M/D 배지를 SR도 동일하게 듣도록 음성 형태('M월 D일') 병기.
        dateText: editionDateA11yLabel(signal.createdAt),
      })}
      // DAR-363: 카드가 no-hide-descendants 라 자식 버튼이 a11y 트리에서 숨겨지므로,
      // 차트 진입을 카드 단위 보조 액션으로도 노출(스크린리더 1탭 동선).
      accessibilityActions={
        chartable
          ? [
              { name: 'activate', label: '신호 상세 보기' },
              { name: 'chart', label: '실시간 차트 보기' },
            ]
          : [{ name: 'activate', label: '신호 상세 보기' }]
      }
      onAccessibilityAction={(event) => {
        if (event.nativeEvent.actionName === 'activate') handlePress();
        else if (event.nativeEvent.actionName === 'chart') handleChartPress();
      }}
    >
      <Surface
        elevation={2}
        importantForAccessibility="no-hide-descendants"
        style={[styles.card, { width: cardWidth, backgroundColor: colors.surface, borderColor: colors.border }]}
      >
        <View style={styles.cardHeader}>
          <Text style={[typo.bodyMedium, { color: colors.text, flex: 1 }]} numberOfLines={1}>
            {signal.corpName}
          </Text>
          <Chip
            compact
            mode="flat"
            // DAR-305: 고정 높이 칩 — OS 글꼴 확대 시 한글 받침 세로 클리핑 방지 배율 상한(DAR-174 정본).
            maxFontSizeMultiplier={MAX_CHIP_FONT_SCALE}
            style={[styles.gradeChip, { backgroundColor: colors.surfaceSecondary }]}
            textStyle={[typo.small, { color: gradeColor(signal.grade, colors), fontWeight: '700' }]}
          >
            {gradeLabel(signal.grade)}
          </Chip>
          {/* DAR-363: 차트 퀵진입 — 6자리 종목코드 있을 때만(graceful). 카드 탭(상세)과 분리. */}
          {chartable ? (
            <TouchableOpacity
              onPress={handleChartPress}
              hitSlop={{ top: spacing.md, bottom: spacing.md, left: spacing.sm, right: spacing.sm }}
              accessibilityRole="button"
              accessibilityLabel={`${signal.corpName} 실시간 차트 보기`}
              style={styles.chartBtn}
            >
              <Feather name="bar-chart-2" size={20} color={colors.primary} />
            </TouchableOpacity>
          ) : null}
        </View>

        <View style={styles.gaugeWrap}>
          {/* 카드 3장 균일 높이(슬롯 예약): '다음 등급까지 +N' 캡션 자리 상시 확보 +
              oneLiner 1줄 고정 — 데이터 유무에 따른 카드별 세로 편차 제거(고정 height 금지). */}
          <ScoreGauge
            score={signal.buyScore}
            kind="buy"
            statusText={gradeLabel(signal.grade)}
            oneLiner={scoreOneLiner(signal.buyScore, signal.grade)}
            accessibilityHidden
            reserveCaptionSpace
            oneLinerNumberOfLines={1}
          />
        </View>

        {/* 표본 행 슬롯 상시 렌더(균일 높이): 표본이 없으면 같은 지오메트리의 정직 결측 행
            '표본 통계 없음'(EvidenceMeta 규약)으로 대체 — 행 유무에 따른 ≈24px 편차 제거. */}
        <EvidenceMeta
          sample={evidence ? { n: evidence.n, unit: '건', scopeLabel: evidence.scopeLabel } : undefined}
          sampleFallback="표본 통계 없음"
          style={styles.evidence}
        />

        {/* DAR-504: 발행일 M/D 배지(좌) + AI 참고 라벨(우). createdAt 결측 시 배지만 생략(균일 높이는
            AiReferenceLabel 이 결정하므로 유지). 카드는 no-hide-descendants → 날짜는 카드 a11y 라벨에 병기. */}
        <View style={styles.cardFooter}>
          {dateLabel ? (
            <View style={styles.dateBadge}>
              <Feather name="calendar" size={12} color={colors.textSecondary} />
              <Text
                style={[typo.small, { color: colors.textSecondary }]}
                numberOfLines={1}
                maxFontSizeMultiplier={MAX_CHIP_FONT_SCALE}
              >
                {dateLabel}
              </Text>
            </View>
          ) : null}
          <AiReferenceLabel />
        </View>
      </Surface>
    </TouchableOpacity>
  );
}

/** 게스트 잠금 카드(§3) — 상위 신호 전체는 로그인 후 열람. overlay 토큰 스크림. */
function LockedCard({ onPress, cardWidth }: { onPress: () => void; cardWidth: number }) {
  const { colors, typography: typo } = useTheme();
  return (
    <TouchableOpacity
      activeOpacity={0.85}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`로그인하고 상위 ${SIGNAL_TERMS.card} 전체 보기`}
    >
      <Surface
        elevation={1}
        style={[
          styles.card,
          styles.lockedCard,
          { width: cardWidth, backgroundColor: colors.surface, borderColor: colors.border },
        ]}
      >
        <View style={[styles.lockOverlay, { backgroundColor: colors.overlay }]}>
          {/* UXR L-1 A-2: 어두운 스크림 위 전경은 테마 무관 밝은 onColor — 다크 surface(≈스크림 명도)로
              잠금 CTA가 판독 불가능해지는 크로스테마 회귀 방지. */}
          <Feather name="lock" size={22} color={colors.onColor} />
          <Text style={[typo.captionMedium, styles.lockText, { color: colors.onColor }]}>
            로그인하고{'\n'}상위 {SIGNAL_TERMS.card} 전체 보기
          </Text>
        </View>
      </Surface>
    </TouchableOpacity>
  );
}

export function HomeSignalPreview({ isAuthenticated }: HomeSignalPreviewProps) {
  const { colors, typography: typo } = useTheme();
  const { data, isLoading, isError, error, refetch } = useBuySignals();
  // 화면 폭 반응형 카드 폭/스냅 간격(DAR-301).
  const { cardWidth, snapToInterval } = useCarouselCardWidth();

  // 가짜 BUY 금지(§2): 매수등급만 점수 내림차순 상위 N(공용 큐레이션 util). WATCH 이하 미노출.
  const topSignals = useMemo(() => curateBuySignals(data, MAX_PREVIEW), [data]);

  // DAR-504: 정적 '오늘' 폐기 — 헤더는 최신 발행일(topSignals 중 max createdAt) 기준으로 동적 생성.
  // 큐레이션이 buyScore desc 라 상단이 최신순이 아닐 수 있어 명시적으로 max createdAt 을 취한다.
  const latestCreatedAt = useMemo(() => {
    let bestIso: string | null = null;
    let bestMs = -Infinity;
    for (const s of topSignals) {
      const ms = s.createdAt ? new Date(s.createdAt).getTime() : NaN;
      if (!Number.isNaN(ms) && ms > bestMs) {
        bestMs = ms;
        bestIso = s.createdAt;
      }
    }
    return bestIso;
  }, [topSignals]);
  // 최신 발행일 KST일이 오늘이면 '오늘의 투자판단', 아니면 '최신 투자판단 · M/D'(+간극≥2일 'N일 전').
  // 데이터 미상(로딩·빈 상태·게스트)이면 '오늘' 단정 없는 우산 헤더 '투자판단'.
  const editionTitle = buildEditionTitle(latestCreatedAt, isTodayKst(latestCreatedAt));

  const handleCardPress = useCallback((signal: TradingSignal) => {
    // 종목 판단허브 진입(§1) — 신호 상세로 직결.
    router.push(`/signals/${signal.id}`);
  }, []);

  const handleExplore = useCallback(() => {
    router.push(EXPLORE_ROUTE);
  }, []);

  const handleSignIn = useCallback(() => {
    router.push('/auth/sign-in');
  }, []);

  // 게스트는 1건만 미리보기(§3). 로그인 사용자는 상위 3건까지.
  const visibleSignals = isAuthenticated ? topSignals : topSignals.slice(0, 1);
  const showLockedCard = !isAuthenticated && topSignals.length > 0;

  // DAR-113: 투자판단은 인증 필요(401). 게스트가 볼 데이터가 없으면(에러/빈) '버그' 오인을
  // 막기 위해 에러/빈 화면 대신 로그인 유도 카드로 자연스럽게 동선을 연다.
  const showGuestPrompt = !isAuthenticated && (isError || topSignals.length === 0);

  const renderCard = useCallback(
    ({ item }: { item: TradingSignal }) => (
      <SignalPreviewCard signal={item} onPress={handleCardPress} cardWidth={cardWidth} />
    ),
    [handleCardPress, cardWidth],
  );

  const Heading = (
    <View style={styles.heading}>
      <View style={styles.headingText}>
        {/* L1 우산 헤더(DAR-217): '투자판단' 어휘 유지. DAR-504: 정적 '오늘' 폐기 → 최신 발행일 기준 동적 문구. */}
        <Text style={[typo.bodyMedium, { color: colors.text }]}>{editionTitle}</Text>
        <Text style={[typo.small, { color: colors.textSecondary }]}>
          공시에서 찾은 상위 {SIGNAL_TERMS.card} (참고)
        </Text>
      </View>
      <TouchableOpacity
        onPress={handleExplore}
        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        accessibilityRole="button"
        accessibilityLabel={`${SIGNAL_TERMS.card} 전체보기`}
      >
        {/* DAR-305: '전체보기' 액션 라벨 — 큰 글꼴서 단어 중간 줄바꿈 방지(한 줄 보장 + 보조 캡). */}
        <Text style={[typo.captionMedium, { color: colors.primary }]} numberOfLines={1} maxFontSizeMultiplier={MAX_CHIP_FONT_SCALE}>
          전체보기
        </Text>
      </TouchableOpacity>
    </View>
  );

  let body: React.ReactNode;

  if (isLoading) {
    // 로딩(§3): buyScore 스켈레톤 가로 배치 — 카드 구조를 미리 예측 가능하게.
    body = (
      <View
        style={styles.skeletonRow}
        accessibilityRole="progressbar"
        accessibilityLabel={`${SIGNAL_TERMS.screenHeader} 프리뷰 불러오는 중`}
      >
        {[0, 1].map((i) => (
          <View key={i} style={[styles.skeletonCard, { width: cardWidth }]}>
            <SkeletonCard variant="buyScore" />
          </View>
        ))}
      </View>
    );
  } else if (showGuestPrompt) {
    // 게스트(§DAR-113): 401 에러/빈 화면 대신 로그인 유도 카드(가치 프리뷰 + CTA).
    body = (
      <View style={styles.guestWrap}>
        <GuestPrompt variant="card" {...guestPromptCopy.homeSignalPreview} onLogin={handleSignIn} />
      </View>
    );
  } else if (isError) {
    // 에러(§3): 빈 화면 대신 사유 + 재시도(ApiErrorState 표준).
    body = (
      <ApiErrorState
        error={error}
        onRetry={refetch}
        title={`${SIGNAL_TERMS.screenHeader}을 불러오지 못했습니다`}
        description="잠시 후 다시 시도해 주세요."
      />
    );
  } else if (topSignals.length === 0) {
    // 정직 빈 상태(§2): 매수등급 0 → 가짜 BUY 금지, 점수순 탐색 유도.
    body = (
      <Surface
        elevation={0}
        style={[styles.emptyCard, { backgroundColor: colors.surface, borderColor: colors.border }]}
      >
        <Feather name={emptyStateCopy.homeSignalPreviewEmpty.icon} size={28} color={colors.textTertiary} />
        <Text style={[typo.bodyMedium, { color: colors.text, marginTop: spacing.sm, textAlign: 'center' }]}>
          {emptyStateCopy.homeSignalPreviewEmpty.title}
        </Text>
        <Text
          style={[typo.small, { color: colors.textSecondary, marginTop: spacing.xs, textAlign: 'center' }]}
        >
          {emptyStateCopy.homeSignalPreviewEmpty.description}
        </Text>
        <TouchableOpacity
          onPress={handleExplore}
          style={[styles.exploreBtn, { borderColor: colors.primary }]}
          accessibilityRole="button"
          accessibilityLabel="점수순으로 전체 신호 탐색"
        >
          <Text style={[typo.captionMedium, { color: colors.primary }]}>
            {emptyStateCopy.homeSignalPreviewEmpty.actionLabel}
          </Text>
          <Feather name="arrow-right" size={14} color={colors.primary} />
        </TouchableOpacity>
      </Surface>
    );
  } else {
    body = (
      <FlatList
        horizontal
        data={visibleSignals}
        renderItem={renderCard}
        keyExtractor={(item) => item.id}
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.carousel}
        // 카드 단위 스냅(DAR-301) — 카드폭 + gap 기준으로 멈춰 peek 정렬 일관.
        snapToInterval={snapToInterval}
        snapToAlignment="start"
        decelerationRate="fast"
        ListFooterComponent={showLockedCard ? <LockedCard onPress={handleSignIn} cardWidth={cardWidth} /> : null}
      />
    );
  }

  return (
    <View style={styles.container}>
      {Heading}
      {body}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingTop: spacing.lg,
  },
  guestWrap: {
    paddingHorizontal: spacing.lg,
  },
  heading: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    marginBottom: spacing.md,
  },
  headingText: {
    flex: 1,
    gap: 2,
  },
  carousel: {
    // DAR-319: 카드 간격은 각 카드의 marginRight 로 적용(스켈레톤과 동일 방식).
    // contentContainer gap 은 Android Fabric 가로 FlatList 에서 미적용될 수 있어 비의존.
    paddingHorizontal: spacing.lg,
  },
  cardTouchable: {
    // DAR-319: 카드 단위 간격(= snapToInterval - cardWidth). carousel gap 비의존(크로스플랫폼).
    marginRight: CAROUSEL_GAP,
  },
  card: {
    // 폭은 useCarouselCardWidth 로 인라인 주입(DAR-301, 화면 폭 반응형).
    borderRadius: radius.lg,
    borderWidth: 1,
    padding: spacing.base,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  chartBtn: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  gradeChip: {
    // DAR-305: 고정 height → minHeight. 캡된 큰 글꼴에서도 칩이 늘어나 받침이 잘리지 않는다(평시 동일).
    minHeight: 26,
  },
  gaugeWrap: {
    marginTop: spacing.md,
  },
  evidence: {
    marginTop: spacing.sm,
  },
  cardFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  dateBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    flexShrink: 1,
  },
  lockedCard: {
    justifyContent: 'center',
    overflow: 'hidden',
  },
  lockOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.base,
    gap: spacing.sm,
  },
  lockText: {
    textAlign: 'center',
  },
  skeletonRow: {
    flexDirection: 'row',
    paddingLeft: spacing.lg,
  },
  skeletonCard: {
    // 폭은 인라인 주입(DAR-301) — 카드와 동일 반응형 폭.
    marginRight: spacing.md,
  },
  emptyCard: {
    marginHorizontal: spacing.lg,
    borderRadius: radius.lg,
    borderWidth: 1,
    padding: spacing.lg,
    alignItems: 'center',
  },
  exploreBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    marginTop: spacing.md,
    paddingHorizontal: spacing.base,
    paddingVertical: spacing.sm,
    borderWidth: 1,
    borderRadius: radius.full,
  },
});
