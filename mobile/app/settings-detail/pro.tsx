import React, { useCallback, useEffect, useRef } from 'react';
import { View, Text, ScrollView, StyleSheet, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useTheme } from '@theme';
import { spacing, radius } from '@theme/spacing';
import { ScreenHeader } from '@components/common/ScreenHeader';
import { useSnackbar } from '@components/common/SnackbarProvider';
import { useSettingsStore } from '@stores/settingsStore';
import { useAuthStore } from '@stores/authStore';
import { useHaptics } from '@hooks/useHaptics';
import { useNetworkStatus } from '@hooks/useNetworkStatus';
import { useProWaitlistStatus, useToggleProWaitlist } from '@hooks/useProWaitlist';
import { recordTesterEvent } from '@services/testerEvents.service';
import { APP_BRAND_NAME } from '@utils/copy';
import { toggleWaitlist } from '@utils/proWaitlist';
import { shouldBlockMutation } from '@utils/offlineMutation';

// Pro 혜택 안내 화면 — DAR-204 / 갭분석 W1.
// 설정 'Pro로 업그레이드' 배너의 dead-end 스낵바를 대체하는 정적 가치 화면.
// 결제는 미구현이므로 구매 CTA 대신 출시 알림 사전 신청으로 유도한다.
// 갭분석 W1: 사전신청이 로컬 보관(useSettingsStore)에만 남아 수요 데이터가 증발하던 것을
// 서버 영속화(POST/DELETE /users/pro-waitlist)로 전환 — 서버가 정본, React Query 캐시가
// 낙관적 사본. 기존 토글 UX(즉시 반영 + 스낵바 + 햅틱)는 그대로 유지한다.
// 테마 토큰만, 하드코딩 색상 0.

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
        {
          borderBottomColor: colors.borderLight,
          borderBottomWidth: isLast ? 0 : StyleSheet.hairlineWidth,
        },
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
  const { isAuthenticated } = useAuthStore();
  const { isOffline } = useNetworkStatus();
  // 레거시 로컬 플래그 — 서버 전환(갭분석 W1) 후에는 1회 마이그레이션 소스로만 쓴다.
  const { proWaitlistOptIn: legacyLocalOptIn, setProWaitlistOptIn } = useSettingsStore();

  const waitlistQuery = useProWaitlistStatus({ enabled: isAuthenticated });
  const toggleMutation = useToggleProWaitlist();
  const optedIn = waitlistQuery.data?.optedIn ?? false;

  // 기존 로컬 보관 신청자 1회 마이그레이션: 서버 미신청 + 로컬 신청이면 서버에 등록하고
  // 레거시 플래그를 소거한다(이후 서버가 유일한 정본 — 철회 후 재주입 방지).
  const migratedRef = useRef(false);
  useEffect(() => {
    if (migratedRef.current) return;
    if (!isAuthenticated || !legacyLocalOptIn || !waitlistQuery.isSuccess) return;
    migratedRef.current = true;
    if (!waitlistQuery.data.optedIn) {
      toggleMutation.mutate(true);
    }
    setProWaitlistOptIn(false);
  }, [
    isAuthenticated,
    legacyLocalOptIn,
    waitlistQuery.isSuccess,
    waitlistQuery.data,
    toggleMutation,
    setProWaitlistOptIn,
  ]);

  const handleWaitlistToggle = useCallback(() => {
    if (!isAuthenticated) {
      showSnackbar('로그인 후 신청할 수 있어요');
      return;
    }
    const { next, message, haptic } = toggleWaitlist(optedIn);
    // DAR-516 계측: Pro waitlist CTA — 대기자 등록(opt-in) 의사를 표할 때만 기록(철회는 제외).
    if (next) void recordTesterEvent('waitlist_cta');
    if (shouldBlockMutation(isOffline)) {
      // DAR-226 가드가 차단 안내 스낵바를 띄운다 — 성공 문구·햅틱은 생략.
      toggleMutation.mutate(next);
      return;
    }
    // 낙관적 UX: 즉시 피드백 후, 서버 실패 시(캐시는 훅이 롤백) 평문으로 알린다.
    toggleMutation.mutate(next, {
      onError: () => showSnackbar('요청을 처리하지 못했어요. 잠시 후 다시 시도해 주세요'),
    });
    haptics[haptic]();
    showSnackbar(message);
  }, [isAuthenticated, isOffline, optedIn, toggleMutation, haptics, showSnackbar]);

  return (
    <SafeAreaView
      style={[styles.container, { backgroundColor: colors.background }]}
      edges={['top']}
    >
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
        <View
          style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}
        >
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

        {/* Waitlist CTA — dead-end 대신 사전 신청(서버 영속화, 갭분석 W1) */}
        <TouchableOpacity
          style={[
            styles.ctaButton,
            {
              backgroundColor: optedIn ? colors.surface : colors.primary,
              borderColor: optedIn ? colors.success : colors.primary,
            },
          ]}
          onPress={handleWaitlistToggle}
          activeOpacity={0.8}
          accessibilityRole="button"
          accessibilityState={{ selected: optedIn }}
          accessibilityLabel={
            optedIn ? '출시 알림 신청 완료, 다시 누르면 취소' : '출시 알림 신청하기'
          }
        >
          <Feather
            name={optedIn ? 'check-circle' : 'bell'}
            size={18}
            color={optedIn ? colors.success : colors.primaryForeground}
          />
          <Text
            style={[
              typo.bodyMedium,
              styles.ctaLabel,
              { color: optedIn ? colors.success : colors.primaryForeground },
            ]}
          >
            {optedIn ? '출시 알림 신청 완료' : '출시되면 알림 받기'}
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
    minHeight: 64,
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
