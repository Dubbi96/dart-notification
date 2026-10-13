import React from 'react';
import { View, Text, StyleSheet, type ViewStyle } from 'react-native';
import { Surface } from 'react-native-paper';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '@theme';
import { spacing, radius } from '@theme/spacing';

import { HelpButton } from './HelpButton';

// AI 면책 표준 컴포넌트(기획 §5). 투자 판단 화면(M6~) 최하단 고정 배치.
// Surface(surfaceSecondary) + Text(textSecondary) + Feather alert-triangle.

const DISCLAIMER_TEXT =
  '이 서비스의 모든 분석·신호·점수는 AI 및 통계 모델이 생성한 참고 정보입니다. ' +
  '특정 종목의 매수·매도를 권유하지 않으며, 투자 결정 및 손실·이익의 책임은 ' +
  '전적으로 투자자 본인에게 있습니다.';

interface DisclaimerSectionProps {
  style?: ViewStyle;
  /**
   * 화면별 동적 위험 맥락 고지(§6)는 접지 않는다.
   * 면책 전문은 원문 그대로 도움말에서 제공한다. 상위 화면에서 사실 고지 문구를 주입.
   */
  contextNotes?: string[];
}

export function DisclaimerSection({ style, contextNotes }: DisclaimerSectionProps) {
  const { colors, typography: typo } = useTheme();
  const notes = contextNotes?.filter((n) => n && n.trim().length > 0) ?? [];

  return (
    <Surface
      elevation={0}
      style={[styles.container, { backgroundColor: colors.surfaceSecondary }, style]}
      accessibilityLabel="투자자문이 아님을 알리는 면책 고지"
    >
      <View style={styles.textWrap}>
        <View style={styles.heading}>
          <Feather name="alert-triangle" size={16} color={colors.textSecondary} />
          <Text style={[typo.captionMedium, styles.textWrap, { color: colors.textSecondary }]}>
            투자자문 아님
          </Text>
          <HelpButton
            title="투자 참고 정보"
            sections={[{ heading: '투자자문 아님', body: DISCLAIMER_TEXT }]}
          />
        </View>
        {/* 현재 위험 맥락은 도움말을 열지 않아도 읽을 수 있어야 한다. */}
        {notes.length > 0 ? (
          <View style={styles.contextNotes}>
            {notes.map((note, idx) => (
              <View key={`${idx}-${note}`} style={styles.contextRow} accessibilityLabel={note}>
                <Text
                  style={[typo.captionMedium, styles.contextText, { color: colors.textSecondary }]}
                >
                  {note}
                </Text>
              </View>
            ))}
          </View>
        ) : null}
      </View>
    </Surface>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    padding: spacing.base,
    borderRadius: radius.md,
  },
  textWrap: {
    flex: 1,
    minWidth: 0,
  },
  heading: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  contextNotes: {
    gap: spacing.xs,
    marginTop: spacing.xs,
  },
  contextRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.xs,
  },
  contextText: {
    flex: 1,
  },
});
