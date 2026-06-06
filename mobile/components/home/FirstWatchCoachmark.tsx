import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@theme';
import { spacing, radius } from '@theme/spacing';
import { useFirstWatchCoachmark } from '@hooks/useFirstWatchCoachmark';

// 첫 관심기업 추가 코치마크 — DAR-65.
// 로그인 후 관심목록이 비어있을 때 1회성으로 노출(관심기업=수집 시드 등록 유도).
// 비차단(dismiss 가능)·접근성·테마토큰만. 과장/FOMO 카피 금지 — 가치 사실만 전달.

interface FirstWatchCoachmarkProps {
  /** '관심 기업 추가' 진입(홈 검색 오버레이 열기 등) — 화면이 주입 */
  onAdd: () => void;
}

export function FirstWatchCoachmark({ onAdd }: FirstWatchCoachmarkProps) {
  const { colors, typography: typo } = useTheme();
  const { dismissed, dismiss } = useFirstWatchCoachmark();

  // 로딩(null) 또는 이미 해제(true)면 노출하지 않음.
  if (dismissed !== false) return null;

  return (
    <View
      style={[styles.card, { backgroundColor: colors.primaryLight, borderColor: colors.primary }]}
      accessibilityRole="summary"
      accessibilityLabel="첫 관심 기업 추가 안내"
    >
      <View style={styles.headerRow}>
        <View style={styles.titleGroup}>
          <Ionicons name="star" size={18} color={colors.primary} />
          <Text style={[typo.captionMedium, { color: colors.primary, marginLeft: spacing.sm, flex: 1 }]}>
            첫 관심 기업을 추가해 보세요
          </Text>
        </View>
        <TouchableOpacity
          onPress={dismiss}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          accessibilityRole="button"
          accessibilityLabel="안내 닫기"
        >
          <Ionicons name="close" size={18} color={colors.primary} />
        </TouchableOpacity>
      </View>

      <Text style={[typo.caption, { color: colors.text, marginTop: spacing.xs }]}>
        관심 기업을 추가하면 공시·매수 신호를 받아볼 수 있어요.
      </Text>

      <TouchableOpacity
        style={[styles.cta, { backgroundColor: colors.primary }]}
        onPress={onAdd}
        activeOpacity={0.8}
        accessibilityRole="button"
        accessibilityLabel="관심 기업 추가하기"
      >
        <Ionicons name="search" size={16} color={colors.primaryForeground} />
        <Text style={[typo.captionMedium, { color: colors.primaryForeground, marginLeft: spacing.xs }]}>
          관심 기업 추가
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
  cta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.md,
    paddingVertical: spacing.sm,
    marginTop: spacing.md,
  },
});
