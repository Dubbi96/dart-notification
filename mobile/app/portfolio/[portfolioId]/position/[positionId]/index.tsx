import React, { useCallback } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Surface, Chip } from 'react-native-paper';
import { Feather } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';

import { useTheme } from '@theme';
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
        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
          {/* 헤더 */}
          <Surface elevation={1} style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <View style={styles.titleRow}>
              <Text style={[typo.h2, { color: colors.text, flex: 1 }]}>{position.corpName}</Text>
              <Chip
                compact
                mode="flat"
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
                    {thesis ? '진입 논리 및 훼손 조건 확인' : 'Thesis 불러오는 중…'}
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
  emptyState: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  disclaimer: { marginTop: spacing.md },
});
