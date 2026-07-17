import React, { useMemo, useState, useCallback } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator } from 'react-native';
import { Ionicons, Feather } from '@expo/vector-icons';
import { useTheme, MAX_CHIP_FONT_SCALE } from '@theme';
import { spacing, radius, sizing } from '@theme/spacing';
import { useSnackbar } from '@components/common/SnackbarProvider';
import { SNACKBAR_DURATION } from '@components/common/snackbarCopy';
import { useAddToWatchlist } from '@hooks/useWatchlist';
import { usePopularCompanies } from '@hooks/useCompanySearch';
import { isOfflineMutationBlockedError } from '@utils/offlineMutation';
import {
  COLD_START_RECOMMEND_MIN,
  COLD_START_RECOMMEND_MAX,
  mergeSuggestions,
  type ColdStartCompany,
} from '@utils/coldStartSuggestions';

// 콜드스타트 온보딩 카드 — DAR-537.
// 관심기업 0 상태에서 FirstWatchCoachmark(DAR-65)를 선택형 온보딩으로 승격:
// 인기 종목(/companies/popular) + 최근 공시 활발 종목(홈 피드 도출, 화면이 주입)에서
// 3~5개 선택을 유도하고, 검색 연결·건너뛰기를 제공한다(비차단·강요 금지).
// 노출 게이트(관심 0·미해제)와 코치마크와의 상호배제는 홈(home/index.tsx)이 소유한다.

interface ColdStartOnboardingProps {
  /** 최근 공시 활발 종목 — 홈이 이미 로드한 전체 피드에서 도출해 주입(추가 요청 없음) */
  activeCompanies: ColdStartCompany[];
  /** 직접 검색 진입(통합 검색 화면 열기 등) — 화면이 주입 */
  onSearch: () => void;
  /** 건너뛰기 — 카드 해제. 이후 기존 코치마크가 자기 규약(독립 1회성 키)대로 폴백 */
  onSkip: () => void;
  /** 등록 완료(1개 이상 성공) — 재유도 방지를 위한 해제 처리 */
  onComplete: () => void;
}

export function ColdStartOnboarding({
  activeCompanies,
  onSearch,
  onSkip,
  onComplete,
}: ColdStartOnboardingProps) {
  const { colors, typography: typo } = useTheme();
  const { showSnackbar } = useSnackbar();
  const addToWatchlist = useAddToWatchlist();
  const { data: popularCompanies = [], isLoading } = usePopularCompanies();
  const [selected, setSelected] = useState<string[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // 인기 → 활발 순 병합·중복 제거(SSOT: utils/coldStartSuggestions).
  const suggestions = useMemo(
    () => mergeSuggestions(popularCompanies, activeCompanies),
    [popularCompanies, activeCompanies],
  );

  const toggle = useCallback((corpCode: string) => {
    setSelected((prev) =>
      prev.includes(corpCode) ? prev.filter((c) => c !== corpCode) : [...prev, corpCode],
    );
  }, []);

  // 온보딩 1단계(onboarding/index.tsx)와 동일 규약: allSettled 로 개별 실패를 수집해
  // 나머지는 계속 등록하고, 오프라인 차단 센티넬은 일반 실패 문구로 덮지 않는다(DAR-226).
  const handleRegister = async () => {
    if (selected.length === 0 || isSubmitting) return;
    setIsSubmitting(true);
    const chosen = suggestions.filter((s) => selected.includes(s.corpCode));
    const results = await Promise.allSettled(
      chosen.map((company) =>
        addToWatchlist.mutateAsync({ corpCode: company.corpCode, corpName: company.corpName }),
      ),
    );
    const failedCount = results.filter(
      (r) => r.status === 'rejected' && !isOfflineMutationBlockedError(r.reason),
    ).length;
    const succeededCount = results.filter((r) => r.status === 'fulfilled').length;
    if (failedCount > 0) {
      showSnackbar(`${failedCount}개 기업 등록에 실패했어요. 나중에 다시 시도해 주세요.`, {
        duration: SNACKBAR_DURATION.error,
      });
    }
    setIsSubmitting(false);
    // 1개 이상 반영 → 관심 캐시가 즉시 갱신돼 홈 관심 피드로 이어진다. 재유도 없이 종료.
    if (succeededCount > 0) onComplete();
  };

  return (
    <View
      style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.borderLight }]}
      accessibilityLabel="첫 관심 기업 온보딩"
    >
      <View style={styles.headerRow}>
        <View style={styles.titleGroup}>
          <Feather name="star" size={18} color={colors.primary} />
          <Text style={[typo.bodyMedium, { color: colors.text, marginLeft: spacing.sm, flex: 1 }]}>
            관심 기업 {COLD_START_RECOMMEND_MIN}~{COLD_START_RECOMMEND_MAX}개로 시작해 보세요
          </Text>
        </View>
        <TouchableOpacity
          onPress={onSkip}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          accessibilityRole="button"
          accessibilityLabel="온보딩 건너뛰기"
        >
          <Text style={[typo.captionMedium, { color: colors.textSecondary }]}>건너뛰기</Text>
        </TouchableOpacity>
      </View>

      <Text style={[typo.caption, { color: colors.textSecondary, marginTop: spacing.xs }]}>
        등록하면 새 공시 알림과 관심 피드를 받아요. 인기 종목과 최근 공시가 활발한 종목이에요.
      </Text>

      {isLoading && suggestions.length === 0 ? (
        <ActivityIndicator style={styles.loading} color={colors.primary} />
      ) : suggestions.length === 0 ? (
        // 추천 풀이 비어도(서버 오류 등) 온보딩이 죽지 않게 검색 경로로 폴백(비차단).
        <Text style={[typo.caption, { color: colors.textTertiary, marginTop: spacing.md }]}>
          추천 종목을 불러오지 못했어요. 아래 검색으로 직접 추가할 수 있어요.
        </Text>
      ) : (
        <View style={styles.chipWrap}>
          {suggestions.map((s) => {
            const isSelected = selected.includes(s.corpCode);
            return (
              <TouchableOpacity
                key={s.corpCode}
                style={[
                  styles.chip,
                  {
                    backgroundColor: isSelected ? colors.primaryLight : colors.background,
                    borderColor: isSelected ? colors.primary : colors.borderLight,
                  },
                ]}
                onPress={() => toggle(s.corpCode)}
                activeOpacity={0.7}
                accessibilityRole="button"
                accessibilityState={{ selected: isSelected }}
                accessibilityLabel={`${s.corpName} — ${s.source === 'popular' ? '인기 종목' : '최근 공시 활발'}`}
                accessibilityHint={
                  isSelected ? '두 번 탭하면 선택을 해제해요' : '두 번 탭하면 선택해요'
                }
              >
                {isSelected && (
                  <Ionicons
                    name="checkmark"
                    size={14}
                    color={colors.primary}
                    style={{ marginRight: spacing.xs }}
                  />
                )}
                <Text
                  style={[
                    typo.captionMedium,
                    { color: isSelected ? colors.primary : colors.text },
                  ]}
                  numberOfLines={1}
                  maxFontSizeMultiplier={MAX_CHIP_FONT_SCALE}
                >
                  {s.corpName}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
      )}

      {selected.length > 0 ? (
        <TouchableOpacity
          style={[styles.cta, { backgroundColor: colors.primary }]}
          onPress={handleRegister}
          disabled={isSubmitting}
          activeOpacity={0.8}
          accessibilityRole="button"
          accessibilityLabel={`선택한 ${selected.length}개 기업 등록`}
          accessibilityState={{ disabled: isSubmitting, busy: isSubmitting }}
        >
          {isSubmitting ? (
            <ActivityIndicator size="small" color={colors.primaryForeground} />
          ) : (
            <>
              <Ionicons name="star" size={16} color={colors.primaryForeground} />
              <Text
                style={[typo.captionMedium, { color: colors.primaryForeground, marginLeft: spacing.xs }]}
              >
                {selected.length}개 등록하기
              </Text>
            </>
          )}
        </TouchableOpacity>
      ) : (
        <Text
          style={[typo.small, { color: colors.textTertiary, marginTop: spacing.md, textAlign: 'center' }]}
        >
          지금 선택하지 않아도 언제든 추가할 수 있어요
        </Text>
      )}

      <TouchableOpacity
        style={styles.searchLink}
        onPress={onSearch}
        activeOpacity={0.7}
        accessibilityRole="button"
        accessibilityLabel="기업 직접 검색"
      >
        <Feather name="search" size={14} color={colors.primary} />
        <Text style={[typo.captionMedium, { color: colors.primary, marginLeft: spacing.xs }]}>
          찾는 기업이 없나요? 직접 검색
        </Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: radius.lg,
    borderWidth: 1,
    padding: spacing.base,
    marginHorizontal: spacing.lg,
    marginBottom: spacing.md,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  titleGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    marginRight: spacing.sm,
  },
  loading: {
    paddingVertical: spacing.lg,
  },
  chipWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: sizing.minTouchTarget,
    paddingHorizontal: spacing.base,
    borderRadius: radius.full,
    borderWidth: 1.5,
  },
  cta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: sizing.minTouchTarget,
    borderRadius: radius.md,
    paddingVertical: spacing.sm,
    marginTop: spacing.md,
  },
  searchLink: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: sizing.minTouchTarget,
    marginTop: spacing.xs,
  },
});
