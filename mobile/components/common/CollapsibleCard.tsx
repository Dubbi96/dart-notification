import React, { useCallback, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '@theme';
import { spacing } from '@theme/spacing';
import { Card } from '@components/common/Card';

// 접이식 카드(DAR-123) — 텍스트 근거를 기본 접힘으로 두고 진입 화면 텍스트량을 줄이는 공용 컴포넌트.
// DecisionHubTab의 로컬 CollapsibleSection 패턴을 공용으로 추출(추천→검색→드릴다운 원칙).
// 접힘 상태에서도 요약(summary)을 온전히 노출한다. 큰 글자에서는 자연스럽게 줄바꿈한다.
// 색 단독 의미 금지 — 헤더 아이콘(형태) + 평문 텍스트 병행. 테마 토큰만(하드코딩 색상 0).

interface CollapsibleCardProps {
  icon: keyof typeof Feather.glyphMap;
  title: string;
  /** 접힘 상태에서도 항상 보이는 요약. */
  summary?: string;
  defaultExpanded?: boolean;
  children: React.ReactNode;
}

function CollapsibleCardBase({
  icon,
  title,
  summary,
  defaultExpanded = false,
  children,
}: CollapsibleCardProps) {
  const { colors, typography: typo } = useTheme();
  const [expanded, setExpanded] = useState(defaultExpanded);
  const toggle = useCallback(() => setExpanded((v) => !v), []);

  return (
    <Card variant="elevated" style={styles.card}>
      <TouchableOpacity
        activeOpacity={0.7}
        onPress={toggle}
        style={styles.header}
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        accessibilityLabel={`${title}${summary ? `, ${summary}` : ''}, ${expanded ? '펼침' : '접힘'}`}
      >
        <Feather name={icon} size={16} color={colors.primary} />
        <View style={styles.titleWrap}>
          <Text style={[typo.bodyMedium, { color: colors.text, minWidth: 0 }]}>{title}</Text>
          {summary && !expanded ? (
            <Text style={[typo.caption, { color: colors.textSecondary, minWidth: 0 }]}>
              {summary}
            </Text>
          ) : null}
        </View>
        <Feather
          name={expanded ? 'chevron-up' : 'chevron-down'}
          size={18}
          color={colors.textTertiary}
        />
      </TouchableOpacity>
      {expanded ? <View style={styles.body}>{children}</View> : null}
    </Card>
  );
}

export const CollapsibleCard = React.memo(CollapsibleCardBase);

const styles = StyleSheet.create({
  card: {
    marginBottom: 0,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 48,
  },
  titleWrap: {
    flex: 1,
    minWidth: 0,
    marginLeft: spacing.sm,
    marginRight: spacing.sm,
  },
  body: {
    marginTop: spacing.md,
  },
});
