import React, { type ReactNode } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '@theme';
import { spacing } from '@theme/spacing';

// 상세 화면 공통 헤더(좌 백버튼 · 중앙 타이틀 · 우 액션 슬롯).
// 좌/우 동폭(SIDE) 고정으로 제목을 항상 시각적 중앙에 둔다 — 화면별 정렬 기법
// (스페이서 방식 vs flex1 textAlign center)의 비일관·좌측 치우침을 단일 패턴으로 통일.
interface ScreenHeaderProps {
  title: string;
  /** 제목 아래 보조 설명(선택). */
  subtitle?: string;
  /** 좌측 뒤로가기 동작. 없으면 좌측은 동폭 스페이서만 렌더(제목 중앙 유지). */
  onBack?: () => void;
  /** 우측 액션 슬롯(선택). 없으면 동폭 스페이서로 좌우 균형을 맞춰 제목 중앙을 보장. */
  rightSlot?: ReactNode;
  /** 하단 구분선 노출(기본 true). */
  showBorder?: boolean;
}

// 좌/우 동폭 + 최소 44pt 터치영역. 두 측면이 동일 폭이라 타이틀이 정확히 중앙에 온다.
const SIDE = 44;

export function ScreenHeader({
  title,
  subtitle,
  onBack,
  rightSlot,
  showBorder = true,
}: ScreenHeaderProps) {
  const { colors, typography: typo } = useTheme();
  return (
    <View
      style={[
        styles.header,
        showBorder && styles.headerBorder,
        showBorder && { borderBottomColor: colors.border },
      ]}
    >
      <View style={styles.side}>
        {onBack ? (
          <TouchableOpacity
            onPress={onBack}
            hitSlop={8}
            style={styles.iconButton}
            accessibilityRole="button"
            accessibilityLabel="뒤로 가기"
          >
            <Feather name="chevron-left" size={26} color={colors.text} />
          </TouchableOpacity>
        ) : null}
      </View>
      <View style={styles.titleBox}>
        <Text
          style={[typo.h3, styles.title, { color: colors.text, minWidth: 0 }]}
          numberOfLines={1}
          accessibilityRole="header"
          ellipsizeMode="tail"
        >
          {title}
        </Text>
        {subtitle ? (
          <Text
            style={[typo.small, styles.subtitle, { color: colors.textSecondary, minWidth: 0 }]}
            numberOfLines={1}
            ellipsizeMode="tail"
          >
            {subtitle}
          </Text>
        ) : null}
      </View>
      <View style={[styles.side, styles.sideRight]}>{rightSlot}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
  },
  headerBorder: {
    borderBottomWidth: 1,
  },
  side: {
    width: SIDE,
    justifyContent: 'center',
  },
  sideRight: {
    alignItems: 'flex-end',
  },
  iconButton: {
    width: SIDE,
    height: SIDE,
    justifyContent: 'center',
    alignItems: 'flex-start',
  },
  titleBox: {
    flex: 1,
    alignItems: 'center',
  },
  title: {
    textAlign: 'center',
  },
  subtitle: {
    textAlign: 'center',
  },
});
