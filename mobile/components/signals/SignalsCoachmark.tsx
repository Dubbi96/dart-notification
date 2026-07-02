import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '@theme';
import { spacing, radius, sizing } from '@theme/spacing';
import { useSignalsCoachmark } from '@hooks/useSignalsCoachmark';
import {
  BUY_GRADE_THRESHOLDS,
  BUY_SCORE_MIN,
  BUY_SCORE_MAX,
  gradeLabel,
} from '@utils/signalDisplay';

// 신호 탭 첫 진입 코치마크 — W1 잔여(6/27 UI/UX 감사).
// 첫 진입 1회 노출, 닫기 후 재노출 없음(useSignalsCoachmark SecureStore 단일키).
// 3포인트: ①점수 게이지 읽는 법(-100~100·등급 경계) ②등급 칩 의미 ③'표본 N건' 의미(과신 방지).
// 카피 규약: 단정·지시·FOMO 금지, '참고' 어휘 유지. 숫자·라벨은 SSOT(signalDisplay) 재사용 —
// 등급 컷 재보정 시 코치마크가 자동 추종해 드리프트가 없다(check-grade-cut-sync 사상 동일).
// 스타일은 FirstWatchCoachmark(components/home) 카드 패턴 재사용(동일 토큰·지오메트리).

interface CoachPoint {
  icon: keyof typeof Feather.glyphMap;
  text: string;
}

// 3포인트 카피 — JSX 원문 대신 문자열 상수(따옴표 이스케이프·재사용). 등급 경계/라벨은 SSOT 보간.
const COACH_POINTS: CoachPoint[] = [
  {
    icon: 'bar-chart-2',
    text: `점수 게이지는 ${BUY_SCORE_MIN}~${BUY_SCORE_MAX} 스케일이에요. 눈금 ${BUY_GRADE_THRESHOLDS.WATCH}·${BUY_GRADE_THRESHOLDS.BUY}·${BUY_GRADE_THRESHOLDS.STRONG_BUY}점이 등급 경계이고, 음수도 정상 값이에요.`,
  },
  {
    icon: 'tag',
    text: `등급 칩(${gradeLabel('STRONG_BUY')}·${gradeLabel('BUY')}·${gradeLabel('WATCH')}·${gradeLabel('NEUTRAL')}·${gradeLabel('AVOID')})은 점수 구간의 이름표예요. 매수·매도 지시가 아니에요.`,
  },
  {
    icon: 'database',
    text: `'표본 N건'은 통계를 계산한 과거 사례 수예요. 표본이 적을수록 우연일 수 있어 그만큼 신뢰도가 제한적이에요.`,
  },
];

// 닫기 터치 영역: 아이콘 md(18) + hitSlop 13*2 = 44pt(sizing.minTouchTarget) 보장.
const CLOSE_HIT_SLOP_INSET = (sizing.minTouchTarget - sizing.icon.md) / 2;
const CLOSE_HIT_SLOP = {
  top: CLOSE_HIT_SLOP_INSET,
  bottom: CLOSE_HIT_SLOP_INSET,
  left: CLOSE_HIT_SLOP_INSET,
  right: CLOSE_HIT_SLOP_INSET,
};

export function SignalsCoachmark() {
  const { colors, typography: typo } = useTheme();
  const { dismissed, dismiss } = useSignalsCoachmark();

  // 로딩(null) 또는 이미 해제(true)면 노출하지 않음.
  if (dismissed !== false) return null;

  return (
    <View
      style={[styles.card, { backgroundColor: colors.primaryLight, borderColor: colors.primary }]}
    >
      {/* 스크린리더 순서: 제목(header) → 3포인트 → 각주 → 닫기(트리 마지막, 시각은 우상단 고정). */}
      <View style={styles.titleGroup}>
        <Feather name="info" size={sizing.icon.md} color={colors.primary} />
        <Text
          accessibilityRole="header"
          style={[typo.captionMedium, { color: colors.primary, marginLeft: spacing.sm, flex: 1 }]}
        >
          신호 읽는 법 3가지
        </Text>
      </View>

      {COACH_POINTS.map((point) => (
        <View key={point.icon} style={styles.pointRow}>
          <Feather
            name={point.icon}
            size={sizing.icon.sm}
            color={colors.primary}
            style={styles.pointIcon}
          />
          <Text style={[typo.caption, { color: colors.text, flex: 1 }]}>{point.text}</Text>
        </View>
      ))}

      {/* 과신 금지 각주 — ScoreGauge InfoSheet 각주와 동일 취지(참고 정보·투자 권유 아님). */}
      <Text style={[typo.small, { color: colors.textSecondary, marginTop: spacing.sm }]}>
        신호는 참고 정보이며 투자 권유가 아닙니다.
      </Text>

      <TouchableOpacity
        style={styles.close}
        onPress={dismiss}
        hitSlop={CLOSE_HIT_SLOP}
        accessibilityRole="button"
        accessibilityLabel="신호 읽는 법 안내 닫기"
      >
        <Feather name="x" size={sizing.icon.md} color={colors.primary} />
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  // FirstWatchCoachmark 카드 스타일 재사용(동일 토큰) + 헤더 아래 정적 장착용 marginTop.
  card: {
    borderRadius: radius.lg,
    borderWidth: 1,
    padding: spacing.base,
    marginHorizontal: spacing.lg,
    marginTop: spacing.md,
  },
  titleGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    // 우상단 고정 닫기 아이콘과 제목이 겹치지 않도록 여백 확보.
    paddingRight: spacing.xl,
  },
  pointRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginTop: spacing.sm,
  },
  pointIcon: {
    marginRight: spacing.sm,
    marginTop: spacing.xs / 2,
  },
  close: {
    position: 'absolute',
    top: spacing.base,
    right: spacing.base,
  },
});
