import React, { useCallback, useMemo } from 'react';
import {
  View,
  Text,
  FlatList,
  StyleSheet,
  TouchableOpacity,
  Linking,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons, Feather } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { useTheme } from '@theme';
import { spacing, radius } from '@theme/spacing';
import { Card } from '@components/common/Card';
import { CollapsibleCard } from '@components/common/CollapsibleCard';
import { DisclaimerSection } from '@components/common/DisclaimerSection';
import { LoadingState, EmptyState, ApiErrorState } from '@components/common/StateView';
import { PhilosophyFitBreakdown } from '@components/philosophy/PhilosophyFitBreakdown';
import { PhilosophyStatStrip } from '@components/philosophy/PhilosophyStatStrip';
import { sourceTypeLabel } from '@components/philosophy/metricFormat';
import { usePhilosophies, usePhilosophyFit } from '@hooks/usePhilosophies';
import { useWatchlist } from '@hooks/useWatchlist';
import { usePopularCompanies } from '@hooks/useCompanySearch';
import { useAuthStore } from '@stores/authStore';
import type { Philosophy } from '@app-types/philosophy.types';

// 철학 상세(DAR-54) — 원칙·체크리스트·출처(공개자료 링크) + 철학별 적합 종목 리스트.
// 적합 종목 유니버스: 로그인 시 관심기업, 게스트는 인기 종목. 각 행은 /philosophies/:id/fit 로
// on-demand 점수 산출(React Query 캐시). 점수는 참고용 — 면책 상시.

interface Candidate {
  corpCode: string;
  corpName: string;
}

export default function PhilosophyDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { colors, typography: typo } = useTheme();
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);

  const { data: philosophies, isLoading, isError, error, refetch } = usePhilosophies();
  const philosophy = useMemo<Philosophy | undefined>(
    () => philosophies?.find((p) => p.philosophyId === id),
    [philosophies, id],
  );

  // 적합 종목 유니버스
  const { data: watchlist } = useWatchlist({ enabled: isAuthenticated });
  const { data: popular } = usePopularCompanies();

  const candidates = useMemo<Candidate[]>(() => {
    if (isAuthenticated) {
      return (watchlist?.data ?? []).map((w) => ({ corpCode: w.corpCode, corpName: w.corpName }));
    }
    return (popular ?? []).map((c) => ({ corpCode: c.corpCode, corpName: c.corpName }));
  }, [isAuthenticated, watchlist, popular]);

  const renderCandidate = useCallback(
    ({ item }: { item: Candidate }) =>
      philosophy ? (
        <FitRow philosophyId={philosophy.philosophyId} corpCode={item.corpCode} corpName={item.corpName} />
      ) : null,
    [philosophy],
  );

  if (isLoading) {
    return (
      <Shell colors={colors} typo={typo} title="투자거장">
        <LoadingState message="철학을 불러오는 중…" />
      </Shell>
    );
  }

  if (isError || !philosophy) {
    return (
      <Shell colors={colors} typo={typo} title="투자거장">
        {isError ? (
          <ApiErrorState error={error} title="철학을 불러오지 못했습니다." onRetry={refetch} />
        ) : (
          <EmptyState icon="book-open" title="철학을 찾을 수 없습니다." />
        )}
      </Shell>
    );
  }

  const universeLabel = isAuthenticated ? '관심기업' : '인기 종목';

  return (
    <Shell colors={colors} typo={typo} title={philosophy.investorName}>
      <FlatList
        data={candidates}
        renderItem={renderCandidate}
        keyExtractor={(item) => item.corpCode}
        contentContainerStyle={styles.listContent}
        showsVerticalScrollIndicator={false}
        ListHeaderComponent={
          <PhilosophyHeader philosophy={philosophy} universeLabel={universeLabel} />
        }
        ListEmptyComponent={
          <EmptyState
            icon="search"
            title={isAuthenticated ? '관심기업이 없습니다.' : '평가할 종목이 없습니다.'}
            description={
              isAuthenticated
                ? '관심기업을 추가하면 이 철학으로 점수를 매겨 드립니다.'
                : '인기 종목을 불러오면 이 철학으로 평가해 드립니다.'
            }
            actionLabel={isAuthenticated ? '관심기업 추가' : undefined}
            onAction={isAuthenticated ? () => router.push('/settings-detail/watchlist') : undefined}
          />
        }
        ListFooterComponent={<DisclaimerSection style={styles.disclaimer} />}
      />
    </Shell>
  );
}

// ── 상세 헤더(원칙·체크리스트·출처) ──────────────────────────────
function PhilosophyHeader({
  philosophy,
  universeLabel,
}: {
  philosophy: Philosophy;
  universeLabel: string;
}) {
  const { colors, typography: typo } = useTheme();

  const openSource = (url: string | null) => {
    if (url) Linking.openURL(url);
  };

  return (
    <View style={styles.headerContent}>
      {/* 스타일 태그 */}
      <View style={styles.tagRow}>
        {philosophy.styleTags.map((tag) => (
          <View key={tag} style={[styles.tag, { backgroundColor: colors.primaryLight }]}>
            <Text style={[typo.small, { color: colors.primaryDark }, styles.tagText]}>{tag}</Text>
          </View>
        ))}
      </View>

      {/* 한눈 통계 — 핵심 수치 우선(DAR-123) */}
      <PhilosophyStatStrip philosophy={philosophy} />

      {/* 리스크 성향 — 1줄 칩(서술 카드 제거) */}
      <View style={[styles.riskChip, { backgroundColor: colors.surfaceSecondary }]}>
        <Feather name="shield" size={14} color={colors.primary} />
        <Text style={[typo.caption, { color: colors.textSecondary }, styles.riskText]} numberOfLines={2}>
          {philosophy.riskProfile}
        </Text>
      </View>

      {/* 상세 텍스트 근거는 드릴다운(접이식) — 진입 화면 텍스트 최소화(DAR-123) */}
      <CollapsibleCard
        icon="book-open"
        title="철학 자세히 보기"
        summary={`핵심 원칙·체크리스트·출처 ${philosophy.sources.length}건`}
      >
        {/* 핵심 원칙 */}
        <View style={styles.subSection}>
          <SectionTitle icon="target" label="핵심 원칙" colors={colors} typo={typo} />
          {philosophy.corePrinciples.map((p, idx) => (
            <BulletRow key={idx} text={p} icon="check" colors={colors} typo={typo} />
          ))}
        </View>

        {/* 체크리스트 */}
        <View style={styles.subSection}>
          <SectionTitle icon="check-square" label="체크리스트" colors={colors} typo={typo} />
          {philosophy.checklistItems.map((c, idx) => (
            <BulletRow key={idx} text={c} icon="square" colors={colors} typo={typo} />
          ))}
        </View>

        {/* 점수 산식(참고) */}
        {philosophy.scoreFormula ? (
          <View style={styles.subSection}>
            <SectionTitle icon="sliders" label="점수 산식(참고)" colors={colors} typo={typo} />
            <Text style={[typo.small, { color: colors.textSecondary }]}>{philosophy.scoreFormula}</Text>
          </View>
        ) : null}

        {/* 출처 */}
        <View style={styles.subSection}>
          <SectionTitle icon="book-open" label="출처(공개 자료)" colors={colors} typo={typo} />
          {philosophy.sources.map((s, idx) => {
            const hasUrl = !!s.url;
            const Row = (
              <View style={styles.sourceRow}>
                <Feather name="file-text" size={14} color={colors.textTertiary} style={styles.sourceIcon} />
                <View style={styles.sourceBody}>
                  <Text
                    style={[
                      typo.caption,
                      { color: hasUrl ? colors.primary : colors.text },
                      hasUrl && styles.sourceLink,
                    ]}
                  >
                    {s.title}
                  </Text>
                  <Text style={[typo.small, { color: colors.textTertiary }]}>
                    {sourceTypeLabel(s.type)} · {s.year}
                  </Text>
                </View>
              </View>
            );
            return hasUrl ? (
              <TouchableOpacity
                key={idx}
                onPress={() => openSource(s.url)}
                accessibilityRole="link"
                accessibilityLabel={`출처 열기: ${s.title}`}
              >
                {Row}
              </TouchableOpacity>
            ) : (
              <View key={idx}>{Row}</View>
            );
          })}
        </View>
      </CollapsibleCard>

      {/* 적합 종목 섹션 제목 */}
      <View style={styles.fitHeader}>
        <Text style={[typo.h3, { color: colors.text }]}>이 철학으로 본 {universeLabel}</Text>
        <Text style={[typo.small, { color: colors.textSecondary, marginTop: spacing.xs }]}>
          최신 재무 스냅샷을 {philosophy.investorName} 기준으로 평가한 적합도입니다. 통과/미달 지표를 함께
          확인하세요.
        </Text>
      </View>
    </View>
  );
}

// ── 종목별 적합도 행 ────────────────────────────────────────────
function FitRow({
  philosophyId,
  corpCode,
  corpName,
}: {
  philosophyId: string;
  corpCode: string;
  corpName: string;
}) {
  const { colors, typography: typo } = useTheme();
  const { data, isLoading, isError } = usePhilosophyFit(philosophyId, corpCode);

  const handlePress = useCallback(() => {
    // DAR-57: 종목 행 탭 → 이 철학 기준 항목별 통과/미달 체크리스트 분해.
    router.push({
      pathname: '/philosophy/checklist',
      params: { id: philosophyId, corpCode, corpName },
    });
  }, [philosophyId, corpCode, corpName]);

  return (
    <TouchableOpacity
      activeOpacity={0.8}
      onPress={handlePress}
      accessibilityRole="button"
      accessibilityLabel={`${corpName} 항목별 체크리스트 분해 보기`}
    >
      <Card variant="elevated" style={styles.fitCard}>
        <View style={styles.fitCardHeader}>
          <Text style={[typo.bodyMedium, { color: colors.text, flex: 1 }]} numberOfLines={1}>
            {corpName}
          </Text>
          <Feather name="chevron-right" size={16} color={colors.textTertiary} />
        </View>

        {isLoading ? (
          <ActivityIndicator size="small" color={colors.primary} style={styles.fitLoading} />
        ) : isError ? (
          <Text style={[typo.small, { color: colors.textSecondary, marginTop: spacing.sm }]}>
            점수를 불러오지 못했습니다.
          </Text>
        ) : data?.noFinancials || !data?.fit ? (
          <View style={[styles.noFin, { backgroundColor: colors.surfaceSecondary }]}>
            <Feather name="alert-circle" size={13} color={colors.textTertiary} />
            <Text style={[typo.small, { color: colors.textSecondary, marginLeft: spacing.xs, flex: 1 }]}>
              재무 데이터가 없어 평가할 수 없습니다.
            </Text>
          </View>
        ) : (
          <View style={styles.fitBody}>
            <PhilosophyFitBreakdown fit={data.fit} showBreakdown={false} />
          </View>
        )}
      </Card>
    </TouchableOpacity>
  );
}

// ── 공통 보조 ───────────────────────────────────────────────────
function Shell({
  colors,
  typo,
  title,
  children,
}: {
  colors: ReturnType<typeof useTheme>['colors'];
  typo: ReturnType<typeof useTheme>['typography'];
  title: string;
  children: React.ReactNode;
}) {
  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={['top']}>
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
          {title}
        </Text>
        <View style={{ width: 26 }} />
      </View>
      <View style={styles.body}>{children}</View>
    </SafeAreaView>
  );
}

function SectionTitle({
  icon,
  label,
  colors,
  typo,
}: {
  icon: keyof typeof Feather.glyphMap;
  label: string;
  colors: ReturnType<typeof useTheme>['colors'];
  typo: ReturnType<typeof useTheme>['typography'];
}) {
  return (
    <View style={styles.sectionTitle}>
      <Feather name={icon} size={15} color={colors.primary} />
      <Text style={[typo.captionMedium, { color: colors.text, marginLeft: spacing.xs }]}>{label}</Text>
    </View>
  );
}

function BulletRow({
  text,
  icon,
  colors,
  typo,
}: {
  text: string;
  icon: keyof typeof Feather.glyphMap;
  colors: ReturnType<typeof useTheme>['colors'];
  typo: ReturnType<typeof useTheme>['typography'];
}) {
  return (
    <View style={styles.bulletRow}>
      <Feather name={icon} size={13} color={colors.textTertiary} style={styles.bulletIcon} />
      <Text style={[typo.caption, { color: colors.textSecondary, flex: 1 }]}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
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
  body: {
    flex: 1,
  },
  listContent: {
    padding: spacing.lg,
    gap: spacing.md,
    flexGrow: 1,
  },
  headerContent: {
    gap: spacing.md,
  },
  tagRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
  },
  tag: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: radius.sm,
  },
  tagText: {
    fontWeight: '600',
  },
  riskChip: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    padding: spacing.sm,
    borderRadius: radius.sm,
  },
  riskText: {
    flex: 1,
    marginLeft: spacing.xs,
  },
  subSection: {
    marginBottom: spacing.md,
  },
  sourceBody: {
    flex: 1,
  },
  sourceLink: {
    textDecorationLine: 'underline',
  },
  sectionTitle: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  bulletRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingVertical: spacing.xs / 2,
  },
  bulletIcon: {
    marginTop: 3,
    marginRight: spacing.sm,
  },
  sourceRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingVertical: spacing.xs,
  },
  sourceIcon: {
    marginTop: 2,
    marginRight: spacing.sm,
  },
  fitHeader: {
    marginTop: spacing.sm,
  },
  fitCard: {
    marginBottom: 0,
  },
  fitCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  fitBody: {
    marginTop: spacing.sm,
  },
  fitLoading: {
    marginTop: spacing.md,
    alignSelf: 'flex-start',
  },
  noFin: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.sm,
    borderRadius: radius.sm,
    marginTop: spacing.sm,
  },
  disclaimer: {
    marginTop: spacing.lg,
  },
});
