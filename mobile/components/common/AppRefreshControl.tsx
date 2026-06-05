import React from 'react';
import { RefreshControl } from 'react-native';
import { useTheme } from '@theme';

// Pull-to-refresh 통일 컴포넌트 — 기획 ux-detail-plan.md §3-3.
// tintColor(iOS)·colors(Android) 모두 primary로 고정해 화면 간 일관성을 보장한다.
// 홈/공시/알림/신호/포트폴리오 RefreshControl을 이 컴포넌트로 통일.

interface AppRefreshControlProps {
  refreshing: boolean;
  onRefresh: () => void;
}

export function AppRefreshControl({ refreshing, onRefresh }: AppRefreshControlProps) {
  const { colors } = useTheme();
  return (
    <RefreshControl
      refreshing={refreshing}
      onRefresh={onRefresh}
      tintColor={colors.primary}
      colors={[colors.primary]}
    />
  );
}
