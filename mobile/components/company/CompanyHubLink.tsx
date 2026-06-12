import React, { useCallback, useMemo } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Surface } from 'react-native-paper';
import { Feather } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useTheme } from '@theme';
import { spacing, radius } from '@theme/spacing';
import { useSnackbar } from '@components/common/SnackbarProvider';
import {
  useWatchlist,
  useAddToWatchlist,
  useRemoveFromWatchlist,
} from '@hooks/useWatchlist';

import type { WatchlistItem } from '@app-types/user.types';

interface CompanyHubLinkProps {
  corpCode?: string | null;
  corpName: string;
  /** 보조 표기용(예: 종목코드). 없으면 미표시. */
  ticker?: string | null;
  /** 관심 기업 퀵액션 노출 여부(기본 노출). */
  showWatchlistAction?: boolean;
}

/**
 * 신호·포지션 상세 → 기업 허브(`/company/{corpCode}`) 진입 동선(DAR-149).
 * corpCode 부재 시 링크 비노출(막다른 길 방지보다 잘못된 이동 방지 우선).
 * 관심 기업 추가/해제 퀵액션을 동반해 한 화면에서 허브 이동·관심 등록을 처리한다.
 */
export function CompanyHubLink({
  corpCode,
  corpName,
  ticker,
  showWatchlistAction = true,
}: CompanyHubLinkProps) {
  const { colors, typography: typo } = useTheme();
  const { showSnackbar } = useSnackbar();
  const { data: watchlist } = useWatchlist();
  const addToWatchlist = useAddToWatchlist();
  const removeFromWatchlist = useRemoveFromWatchlist();

  const watchlistItem = useMemo<WatchlistItem | undefined>(
    () => watchlist?.data.find((i) => i.corpCode === corpCode),
    [watchlist, corpCode],
  );
  const isWatched = Boolean(watchlistItem);

  const handleOpenHub = useCallback(() => {
    if (corpCode) {
      router.push(`/company/${corpCode}`);
    }
  }, [corpCode]);

  const handleToggleWatchlist = useCallback(() => {
    if (!corpCode) return;
    if (isWatched && watchlistItem) {
      removeFromWatchlist.mutate(watchlistItem.id);
      showSnackbar(`${corpName} 관심 등록을 해제했어요.`, { duration: 2500 });
      return;
    }
    addToWatchlist.mutate(
      { corpCode, corpName },
      {
        onError: (error) => {
          const status = (error as { response?: { status?: number } })?.response
            ?.status;
          // 422(한도 초과)는 훅에서 안내 다이얼로그 처리 — 그 외만 스낵바.
          if (status !== 422) {
            showSnackbar('관심 등록에 실패했어요. 다시 시도해 주세요.', {
              duration: 4000,
            });
          }
        },
      },
    );
    showSnackbar(`${corpName}을(를) 관심목록에 추가했어요.`, { duration: 2500 });
  }, [
    corpCode,
    corpName,
    isWatched,
    watchlistItem,
    addToWatchlist,
    removeFromWatchlist,
    showSnackbar,
  ]);

  // corpCode 부재 시 잘못된 이동/등록 방지를 위해 링크 자체를 미노출.
  if (!corpCode) return null;

  return (
    <Surface
      elevation={0}
      style={[
        styles.card,
        { backgroundColor: colors.surface, borderColor: colors.primary },
      ]}
    >
      <TouchableOpacity
        onPress={handleOpenHub}
        activeOpacity={0.8}
        style={styles.hubLink}
        accessibilityRole="link"
        accessibilityLabel={`${corpName} 기업 허브 보기`}
      >
        <Feather name="briefcase" size={18} color={colors.primary} />
        <View style={styles.hubTextWrap}>
          <Text style={[typo.captionMedium, { color: colors.primary }]}>
            기업 허브 보기
          </Text>
          <Text
            style={[typo.small, { color: colors.textSecondary }]}
            numberOfLines={1}
          >
            {corpName}
            {ticker ? ` · ${ticker}` : ''} 종합 정보
          </Text>
        </View>
        <Feather name="chevron-right" size={18} color={colors.textTertiary} />
      </TouchableOpacity>

      {showWatchlistAction ? (
        <TouchableOpacity
          onPress={handleToggleWatchlist}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          style={[styles.watchBtn, { borderColor: colors.border }]}
          accessibilityRole="button"
          accessibilityState={{ selected: isWatched }}
          accessibilityLabel={
            isWatched
              ? `${corpName} 관심 등록 해제`
              : `${corpName} 관심 기업 추가`
          }
        >
          <Feather
            name={isWatched ? 'check' : 'plus'}
            size={16}
            color={isWatched ? colors.success : colors.primary}
          />
          <Text
            style={[
              typo.small,
              { color: isWatched ? colors.success : colors.primary },
            ]}
          >
            {isWatched ? '관심 등록됨' : '관심 추가'}
          </Text>
        </TouchableOpacity>
      ) : null}
    </Surface>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: radius.lg,
    borderWidth: 1,
    padding: spacing.base,
    gap: spacing.sm,
  },
  hubLink: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    minHeight: 44,
  },
  hubTextWrap: {
    flex: 1,
    gap: 2,
  },
  watchBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    minHeight: 44,
    borderRadius: radius.md,
    borderWidth: 1,
    paddingHorizontal: spacing.md,
  },
});
