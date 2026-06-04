import React, { useCallback } from 'react';
import { StyleSheet } from 'react-native';
import { Chip } from 'react-native-paper';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '@theme';

// "AI 분석 참고용" 표준 레이블(기획 §5). AI 생성 콘텐츠 블록에 인라인 배치.
// Chip(outlined) + Feather info 아이콘 + 텍스트.

interface AiReferenceLabelProps {
  /** 기본 "AI 분석 참고용" / 짧은 형태 "AI 생성" */
  text?: string;
  compact?: boolean;
}

export function AiReferenceLabel({ text = 'AI 분석 참고용', compact = true }: AiReferenceLabelProps) {
  const { colors, typography: typo } = useTheme();

  const renderIcon = useCallback(
    ({ size }: { size: number }) => (
      <Feather name="info" size={size} color={colors.textSecondary} />
    ),
    [colors.textSecondary],
  );

  return (
    <Chip
      mode="outlined"
      compact={compact}
      icon={renderIcon}
      style={[styles.chip, { borderColor: colors.border, backgroundColor: colors.surface }]}
      textStyle={[typo.small, { color: colors.textSecondary }]}
      accessibilityLabel={`${text} 레이블`}
    >
      {text}
    </Chip>
  );
}

const styles = StyleSheet.create({
  chip: {
    alignSelf: 'flex-start',
  },
});
