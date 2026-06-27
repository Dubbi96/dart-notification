import React, { useCallback, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '@theme';
import { spacing, sizing } from '@theme/spacing';

/**
 * 인라인 접기(progressive disclosure) — 전문/희귀 지표·룰을 '한 탭 뒤'로 숨겨 카드 과밀을 줄인다.
 * 색 단독 의미 금지 — 아이콘(형태)+평문 라벨 병행. 헤더는 44pt 터치영역.
 *
 * DAR-472: StrategyComparisonSection·IntradayScalpSection·StyleComparisonSection 에 글자 단위로
 * 복제돼 있던 로컬 InlineDisclosure 를 공용 컴포넌트로 통일(DAR-459 후속). StyleComparison 의
 * 상위집합 API(accent·defaultExpanded)를 흡수하며 두 옵션은 선택(기본 false)이라 기존 호출과 동작 동일.
 *
 * @param accent          true 면 경고 톤(라벨·아이콘 colors.warning) — '표본 적음' 등 주의 환기용.
 * @param defaultExpanded 초기 펼침 여부(기본 false).
 */
export function InlineDisclosure({
  label,
  icon,
  accent = false,
  defaultExpanded = false,
  children,
}: {
  label: string;
  icon?: keyof typeof Feather.glyphMap;
  accent?: boolean;
  defaultExpanded?: boolean;
  children: React.ReactNode;
}) {
  const { colors, typography: typo } = useTheme();
  const [expanded, setExpanded] = useState(defaultExpanded);
  const toggle = useCallback(() => setExpanded((v) => !v), []);
  const tone = accent ? colors.warning : colors.textSecondary;
  return (
    <View>
      <TouchableOpacity
        activeOpacity={0.7}
        onPress={toggle}
        style={styles.discHeader}
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        accessibilityLabel={`${label}, ${expanded ? '펼침' : '접힘'}`}
      >
        <View style={styles.discHeaderLeft}>
          {icon ? (
            // 보조 라벨 아이콘 — 스케일 밖 작은 값(14)이라 토큰 미적용(원본 시각 보존).
            <Feather
              name={icon}
              size={14}
              color={accent ? colors.warning : colors.textTertiary}
            />
          ) : null}
          <Text style={[typo.small, { color: tone }]} numberOfLines={1}>
            {label}
          </Text>
        </View>
        <Feather
          name={expanded ? 'chevron-up' : 'chevron-down'}
          size={sizing.icon.sm}
          color={colors.textTertiary}
        />
      </TouchableOpacity>
      {expanded ? <View style={styles.discBody}>{children}</View> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  discHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: sizing.minTouchTarget,
    gap: spacing.sm,
  },
  discHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    flexShrink: 1,
  },
  discBody: {
    paddingBottom: spacing.xs,
    gap: spacing.sm,
  },
});
