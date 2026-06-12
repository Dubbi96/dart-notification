import React from 'react';
import { View, Text, StyleSheet, type ViewStyle } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '@theme';
import { spacing } from '@theme/spacing';
import { useNetworkStatus } from '@hooks/useNetworkStatus';
import { offlineStaleLabel } from '@utils/staleData';

// DAR-173: 시세·점수 카드 보조 라벨. 오프라인일 때만 '오프라인 — 마지막 갱신 N분 전'.
// 온라인이면 null(렌더 0) → 정상 화면 불변. ProvenanceBar/EvidenceMeta 와 동일 idiom:
// Feather 아이콘(형태) + 평문 + warning 색(색 단독 의미 금지). updatedAt=React Query dataUpdatedAt.
interface OfflineStaleLabelProps {
  /** 마지막 성공 갱신 시각(ms, React Query dataUpdatedAt). 미상이면 '캐시된 값'으로 표기. */
  updatedAt?: number | null;
  style?: ViewStyle;
}

export function OfflineStaleLabel({ updatedAt, style }: OfflineStaleLabelProps) {
  const { isOffline } = useNetworkStatus();
  const { colors, typography: typo } = useTheme();

  if (!isOffline) return null;

  const label = offlineStaleLabel(updatedAt ?? null);

  return (
    <View style={[styles.row, style]} accessibilityLabel={label}>
      <Feather name="wifi-off" size={12} color={colors.warning} />
      <Text style={[typo.small, { color: colors.warning }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
});
