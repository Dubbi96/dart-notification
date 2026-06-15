import React, { useCallback } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Surface, Chip } from 'react-native-paper';
import { Feather } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useTheme } from '@theme';
import { spacing, radius } from '@theme/spacing';
import { useDisclosureSignal } from '@hooks/useSignals';
import { gradeColor, gradeLabel, buyScoreColor } from '@utils/signalDisplay';
import { SIGNAL_TERMS } from '@utils/signalTerms';
import { disclosureSignalTarget } from '@utils/disclosureSignalLink';

// 공시 → 매수 신호 역링크 진입 카드(DAR-208).
//  - 기존엔 신호 → 공시 단방향만 존재(signals/[id]의 '관련 공시'). 그 공시로 생성된 매수
//    신호로 가는 역방향 동선이 끊겨 intro Slide2("공시→AI 매수점수") 약속이 무너져 있었다.
//  - 해당 rcpNo로 생성된 신호가 있을 때만 카드 노출, 탭하면 signals/[id]로 이동(없으면 미표시).
//  - 신호 API는 인증 필요 → enabled로 게스트 호출 차단(401 소음 방지).

interface DisclosureSignalLinkProps {
  rcpNo: string;
  /** 로그인 사용자에게만 조회(게스트는 신호 API 401) — 기본 true */
  enabled?: boolean;
}

export function DisclosureSignalLink({ rcpNo, enabled = true }: DisclosureSignalLinkProps) {
  const { colors, typography: typo } = useTheme();
  const { data: signal } = useDisclosureSignal(rcpNo, { enabled });

  const target = disclosureSignalTarget(signal);

  const handlePress = useCallback(() => {
    if (target) router.push(target);
  }, [target]);

  // 신호가 없으면(또는 미인증·미조회) 카드 자체를 그리지 않는다(빈상태 흡수).
  if (!signal || !target) return null;

  return (
    <Surface
      elevation={0}
      style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}
    >
      <View style={styles.titleRow}>
        <Feather name="zap" size={16} color={colors.primary} />
        <Text style={[typo.captionMedium, { color: colors.text, marginLeft: spacing.xs }]}>
          이 공시의 {SIGNAL_TERMS.card}
        </Text>
      </View>

      <TouchableOpacity
        onPress={handlePress}
        style={[styles.link, { borderColor: colors.border }]}
        accessibilityRole="button"
        accessibilityLabel={`이 공시의 ${SIGNAL_TERMS.card} 보기 · ${signal.corpName} ${SIGNAL_TERMS.buyScore} ${signal.buyScore}점 ${gradeLabel(signal.grade)}`}
      >
        <Chip
          compact
          mode="flat"
          style={[styles.gradeChip, { backgroundColor: colors.surfaceSecondary }]}
          textStyle={[typo.small, { color: gradeColor(signal.grade, colors), fontWeight: '700' }]}
        >
          {gradeLabel(signal.grade)}
        </Chip>
        <Text style={[typo.captionMedium, { color: buyScoreColor(signal.buyScore, colors), flex: 1 }]}>
          {SIGNAL_TERMS.buyScore} {signal.buyScore}
        </Text>
        <Feather name="chevron-right" size={16} color={colors.textTertiary} />
      </TouchableOpacity>
    </Surface>
  );
}

const styles = StyleSheet.create({
  card: {
    marginTop: spacing.xl,
    borderRadius: radius.lg,
    borderWidth: 1,
    padding: spacing.base,
    gap: spacing.sm,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  link: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    minHeight: 44,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.md,
    borderWidth: 1,
  },
  gradeChip: { minHeight: 26 },
});
