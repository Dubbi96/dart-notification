import React, { useCallback, useMemo } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, FlatList } from 'react-native';
import { Surface, Chip } from 'react-native-paper';
import { Feather } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useTheme } from '@theme';
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
import { SIGNAL_TERMS, buildSignalCardA11yLabel } from '@utils/signalTerms';
import { curateBuySignals } from '@utils/signalCuration';
import { useBuySignals } from '@hooks/useSignals';
import { useCarouselCardWidth } from '@hooks/useCarouselCardWidth';

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

/** scoreBreakdown 표본 중 대표값(최대) — 과신 방지 신뢰표기(DAR-56). 없으면 undefined. */
function representativeSampleN(signal: TradingSignal): number | undefined {
  return (signal.scoreBreakdown ?? [])
    .map((c) => c.sampleN)
    .filter((n): n is number => typeof n === 'number' && n > 0)
    .reduce<number | undefined>((max, n) => (max === undefined ? n : Math.max(max, n)), undefined);
}

interface SignalPreviewCardProps {
  signal: TradingSignal;
  onPress: (signal: TradingSignal) => void;
  /** 화면 폭 반응형 카드 폭(DAR-301). */
  cardWidth: number;
}

function SignalPreviewCard({ signal, onPress, cardWidth }: SignalPreviewCardProps) {
  const { colors, typography: typo } = useTheme();
  const sampleN = representativeSampleN(signal);
  const handlePress = useCallback(() => onPress(signal), [onPress, signal]);

  return (
    <TouchableOpacity
      activeOpacity={0.85}
      onPress={handlePress}
      accessibilityRole="button"
      // 카드 그룹핑(§8-1): 카드를 단일 단위로 읽어 내부 중복 읽기 방지.
      // 용어 위계 L2 고정(DAR-217): 카드 a11y는 SSOT 빌더로 '매수 신호'+'Buy Score' 일관.
      accessibilityLabel={buildSignalCardA11yLabel({
        corpName: signal.corpName,
        buyScore: signal.buyScore,
        gradeText: gradeLabel(signal.grade),
      })}
      accessibilityActions={[{ name: 'activate', label: '신호 상세 보기' }]}
      onAccessibilityAction={(event) => {
        if (event.nativeEvent.actionName === 'activate') handlePress();
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
            style={[styles.gradeChip, { backgroundColor: colors.surfaceSecondary }]}
            textStyle={[typo.small, { color: gradeColor(signal.grade, colors), fontWeight: '700' }]}
          >
            {gradeLabel(signal.grade)}
          </Chip>
        </View>

        <View style={styles.gaugeWrap}>
          <ScoreGauge
            score={signal.buyScore}
            kind="buy"
            statusText={gradeLabel(signal.grade)}
            oneLiner={scoreOneLiner(signal.buyScore, signal.grade)}
            accessibilityHidden
          />
        </View>

        {sampleN !== undefined ? (
          <EvidenceMeta sample={{ n: sampleN, unit: '건' }} style={styles.evidence} />
        ) : null}

        <View style={styles.cardFooter}>
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
          <Feather name="lock" size={22} color={colors.surface} />
          <Text style={[typo.captionMedium, styles.lockText, { color: colors.surface }]}>
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
        {/* L1 우산 헤더(DAR-217): 화면/섹션 헤더는 '투자판단', 부제는 콘텐츠 어휘 '매수 신호'. */}
        <Text style={[typo.bodyMedium, { color: colors.text }]}>{SIGNAL_TERMS.homeHeader}</Text>
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
        <Text style={[typo.captionMedium, { color: colors.primary }]}>전체보기</Text>
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
    paddingHorizontal: spacing.lg,
    gap: spacing.md,
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
  gradeChip: {
    height: 26,
  },
  gaugeWrap: {
    marginTop: spacing.md,
  },
  evidence: {
    marginTop: spacing.sm,
  },
  cardFooter: {
    marginTop: spacing.md,
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
