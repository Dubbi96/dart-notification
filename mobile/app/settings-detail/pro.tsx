import React from 'react';
import { View, Text, ScrollView, StyleSheet, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useTheme } from '@theme';
import { spacing, radius } from '@theme/spacing';
import { ScreenHeader } from '@components/common/ScreenHeader';
import { useSnackbar } from '@components/common/SnackbarProvider';
import { useSettingsStore } from '@stores/settingsStore';
import { useHaptics } from '@hooks/useHaptics';
import { APP_BRAND_NAME } from '@utils/copy';
import { toggleWaitlist } from '@utils/proWaitlist';

// Pro 혜택 안내 화면 — DAR-204.
// 설정 'Pro로 업그레이드' 배너의 dead-end 스낵바를 대체하는 정적 가치 화면.
// 결제는 미구현이므로 구매 CTA 대신 출시 알림 사전 신청(로컬 보관)으로 유도한다.
// read-only + 로컬 상태만 사용. 테마 토큰만, 하드코딩 색상 0.

interface Benefit {
  icon: keyof typeof Feather.glyphMap;
  title: string;
  description: string;
}

const BENEFITS: Benefit[] = [
  {
    icon: 'star',
    title: '무제한 관심기업',
    description: '30종목 한도 없이 추적하고 싶은 모든 기업을 등록하세요.',
  },
  {
    icon: 'filter',
    title: '고급 필터',
    description: '신호 등급·이벤트 유형·재무 조건을 조합한 정밀 필터를 제공합니다.',
  },
  {
    icon: 'bell',
    title: '우선 알림',
    description: '관심 종목의 핵심 공시를 더 빠르게 받아보세요.',
  },
  {
    icon: 'trending-up',
    title: '심화 분석',
    description: 'AI 분석·이벤트 스터디 표본을 더 깊게 들여다볼 수 있습니다.',
  },
];

function BenefitRow({ icon, title, description, isLast }: Benefit & { isLast: boolean }) {
  const { colors, typography: typo } = useTheme();
  return (
    <View
      style={[
        styles.benefitRow,
        { borderBottomColor: colors.borderLight, borderBottomWidth: isLast ? 0 : StyleSheet.hairlineWidth },
      ]}
    >
      <View style={[styles.benefitIcon, { backgroundColor: colors.primaryLight }]}>
        <Feather name={icon} size={18} color={colors.primary} />
      </View>
      <View style={styles.benefitText}>
        <Text style={[typo.bodyMedium, styles.semibold, { color: colors.text }]}>{title}</Text>
        <Text style={[typo.small, styles.benefitDesc, { color: colors.textSecondary }]}>
          {description}
        </Text>
      </View>
    </View>
  );
}

export default function ProScreen() {
  const { colors, typography: typo } = useTheme();
  const { showSnackbar } = useSnackbar();
  const haptics = useHaptics();
  const { proWaitlistOptIn, setProWaitlistOptIn } = useSettingsStore();

  const handleWaitlistToggle = () => {
    const { next, message, haptic } = toggleWaitlist(proWaitlistOptIn);
    setProWaitlistOptIn(next);
    haptics[haptic]();
    showSnackbar(message);
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={['top']}>
      <ScreenHeader title="Pro" onBack={() => router.back()} />

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {/* Hero */}
        <View style={styles.hero}>
          <View style={[styles.heroBadge, { backgroundColor: colors.primaryLight }]}>
            <Feather name="zap" size={28} color={colors.primary} />
          </View>
          {/* D8(L-4): 히어로 제품명을 앱 브랜드 정본(공시온)과 통일 — 결제 대상 혼동 방지. */}
          <Text style={[typo.h2, { color: colors.text, marginTop: spacing.md }]}>
            {`${APP_BRAND_NAME} Pro`}
          </Text>
          {/* D1(L-4): '놓치지 마세요' FOMO 패턴 제거 — copy.ts 톤 규약(과신·긴박 금지) 준수. */}
          <Text style={[typo.caption, styles.heroSubtitle, { color: colors.textSecondary }]}>
            더 많은 관심기업과 정밀한 분석으로 중요한 공시를 빠짐없이 받아보세요.
          </Text>
        </View>

        {/* Benefits */}
        <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          {BENEFITS.map((b, i) => (
            <BenefitRow key={b.title} {...b} isLast={i === BENEFITS.length - 1} />
          ))}
        </View>

        {/* Status notice — 결제 미구현을 솔직하게 안내 */}
        <View style={[styles.noticeRow, { backgroundColor: colors.surfaceSecondary }]}>
          <Feather name="info" size={16} color={colors.textSecondary} />
          <Text style={[typo.small, styles.noticeText, { color: colors.textSecondary }]}>
            Pro 결제는 아직 준비 중입니다. 출시되면 가장 먼저 알려드릴게요.
          </Text>
        </View>

        {/* Waitlist CTA — dead-end 대신 사전 신청(로컬 보관) */}
        <TouchableOpacity
          style={[
            styles.ctaButton,
            {
              backgroundColor: proWaitlistOptIn ? colors.surface : colors.primary,
              borderColor: proWaitlistOptIn ? colors.success : colors.primary,
            },
          ]}
          onPress={handleWaitlistToggle}
          activeOpacity={0.8}
          accessibilityRole="button"
          accessibilityState={{ selected: proWaitlistOptIn }}
          accessibilityLabel={proWaitlistOptIn ? '출시 알림 신청 완료, 다시 누르면 취소' : '출시 알림 신청하기'}
        >
          <Feather
            name={proWaitlistOptIn ? 'check-circle' : 'bell'}
            size={18}
            color={proWaitlistOptIn ? colors.success : colors.primaryForeground}
          />
          <Text
            style={[
              typo.bodyMedium,
              styles.ctaLabel,
              { color: proWaitlistOptIn ? colors.success : colors.primaryForeground },
            ]}
          >
            {proWaitlistOptIn ? '출시 알림 신청 완료' : '출시되면 알림 받기'}
          </Text>
        </TouchableOpacity>

        <View style={{ height: spacing['2xl'] }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: {
    padding: spacing.lg,
    paddingBottom: spacing['4xl'],
  },
  hero: {
    alignItems: 'center',
    paddingVertical: spacing.lg,
  },
  heroSubtitle: {
    textAlign: 'center',
    marginTop: spacing.sm,
  },
  semibold: {
    fontWeight: '600',
  },
  benefitDesc: {
    marginTop: spacing.xs,
  },
  heroBadge: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  card: {
    borderRadius: radius.lg,
    borderWidth: 1,
    paddingHorizontal: spacing.base,
    marginTop: spacing.md,
  },
  benefitRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingVertical: spacing.base,
  },
  benefitIcon: {
    width: 36,
    height: 36,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.md,
  },
  benefitText: {
    flex: 1,
  },
  noticeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.base,
    borderRadius: radius.md,
    marginTop: spacing.lg,
  },
  noticeText: {
    flex: 1,
    marginLeft: spacing.sm,
  },
  ctaButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.base,
    borderRadius: radius.lg,
    borderWidth: 1,
    marginTop: spacing.md,
  },
  ctaLabel: {
    fontWeight: '600',
    marginLeft: spacing.sm,
  },
});
