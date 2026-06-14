import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  FlatList,
  ActivityIndicator,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Bell, ChartLineUp, Briefcase } from 'phosphor-react-native';
import { router } from 'expo-router';
import { getNotifications } from '@utils/notifications';
import { useTheme } from '@theme';
import { spacing, radius } from '@theme/spacing';
import { Button } from '@components/common/Button';
import { useAddToWatchlist } from '@hooks/useWatchlist';
import { usePopularCompanies } from '@hooks/useCompanySearch';
import { useAuthStore } from '@stores/authStore';
import { deviceService } from '@services/device.service';
import { notificationSettingsService } from '@services/notification-settings.service';
import { ONBOARDING_TOTAL_STEPS, onboardingExitRoute } from '@utils/onboardingFlow';

const PROJECT_ID = 'dbdd30ba-72aa-4f90-ae45-54aa8fd43aa7';

export default function OnboardingScreen() {
  const { colors, typography: typo } = useTheme();
  const [step, setStep] = useState(1);
  const [selected, setSelected] = useState<string[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const addToWatchlist = useAddToWatchlist();
  const completeOnboarding = useAuthStore((s) => s.completeOnboarding);
  const setExpoPushToken = useAuthStore((s) => s.setExpoPushToken);
  const { data: popularCompanies = [], isLoading } = usePopularCompanies();

  const toggleCompany = (corpCode: string) => {
    setSelected((prev) =>
      prev.includes(corpCode) ? prev.filter((c) => c !== corpCode) : [...prev, corpCode],
    );
  };

  // 마찰제거(DAR-65): 관심기업 선택은 선택 사항 — 0개여도 다음 단계로 진행한다.
  // (선택 안 하면 홈 첫 종목 코치마크가 이어서 등록을 유도)
  const handleStep1Continue = async () => {
    if (selected.length === 0) {
      setStep(2);
      return;
    }
    setIsSubmitting(true);
    try {
      const selectedCompanies = popularCompanies.filter((c) => selected.includes(c.corpCode));
      for (const company of selectedCompanies) {
        await addToWatchlist.mutateAsync({ corpCode: company.corpCode, corpName: company.corpName });
      }
    } catch {
      // 일부 실패해도 계속 진행
    } finally {
      setIsSubmitting(false);
      setStep(2);
    }
  };

  const handleEnableNotifications = async () => {
    setIsSubmitting(true);
    try {
      const Notifications = getNotifications();
      if (Notifications) {
        const { status } = await Notifications.requestPermissionsAsync();
        if (status === 'granted') {
          const tokenData = await Notifications.getExpoPushTokenAsync({ projectId: PROJECT_ID });
          const token = tokenData.data;
          const platform = Platform.OS === 'ios' ? 'ios' : 'android';
          await deviceService.register(token, platform);
          setExpoPushToken(token);
        }
      }
      // Expo Go 안드로이드 등 미지원 환경: 권한 단계 건너뛰고 온보딩 계속
    } catch (err) {
      console.warn('푸시 알림 설정 실패:', err);
    } finally {
      setIsSubmitting(false);
      // DAR-209: 곧장 완료하지 않고 신호·포트폴리오 가치 단계로 이어간다.
      setStep(3);
    }
  };

  const handleSkipNotifications = async () => {
    try {
      await notificationSettingsService.update({ isEnabled: false });
    } catch {
      // 실패해도 진행
    }
    setStep(3);
  };

  // Step 3(DAR-209): 가치 안내 종료 — '신호 보러 가기' 또는 '홈으로'.
  const handleFinish = (exit: 'signals' | 'home') => {
    completeOnboarding();
    router.replace(onboardingExitRoute(exit));
  };

  // Step 3(DAR-209): 신호·포트폴리오 가치 안내 — intro 캐러셀이 약속한
  // AI 투자판단·거장 철학을 가입 직후 핵심 탭과 연결한다.
  if (step === 3) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
        <View style={styles.content}>
          <View style={[styles.stepIndicator, { backgroundColor: colors.primaryLight }]}>
            <Text style={[typo.captionMedium, { color: colors.primary }]}>
              3단계 / {ONBOARDING_TOTAL_STEPS}
            </Text>
          </View>

          <Text style={[typo.h1, { color: colors.text, marginTop: spacing.lg }]}>
            이제 투자 판단까지{'\n'}받아보세요
          </Text>
          <Text style={[typo.body, { color: colors.textSecondary, marginTop: spacing.sm }]}>
            공시 알림에서 끝나지 않아요. 신호와 포트폴리오로{'\n'}매수·매도 판단을 도와드려요.
          </Text>

          <View style={styles.valueList}>
            <ValueCard
              icon={<ChartLineUp size={28} color={colors.primary} weight="duotone" />}
              title="신호 — AI 매수 판단"
              description="공시가 뜨면 거장 4인의 투자 철학 기준으로 AI가 매수 점수를 매겨요."
              colors={colors}
              typo={typo}
            />
            <ValueCard
              icon={<Briefcase size={28} color={colors.primary} weight="duotone" />}
              title="포트폴리오 — 보유 종목 추적"
              description="관심 종목을 담아 수익률과 매도 신호를 한눈에 확인해요."
              colors={colors}
              typo={typo}
            />
          </View>

          <View style={[styles.disclaimerMini, { backgroundColor: colors.surfaceSecondary }]}>
            <Ionicons name="information-circle-outline" size={14} color={colors.textTertiary} />
            <Text style={[typo.small, styles.disclaimerText, { color: colors.textTertiary }]}>
              AI 점수는 참고 정보예요 · 투자자문이 아닙니다
            </Text>
          </View>
        </View>

        <View style={styles.footer}>
          <Button
            title="신호 보러 가기"
            onPress={() => handleFinish('signals')}
            fullWidth
            size="lg"
          />
          <TouchableOpacity
            style={styles.skipButton}
            onPress={() => handleFinish('home')}
            accessibilityRole="button"
            accessibilityLabel="홈으로 이동"
          >
            <Text style={[typo.captionMedium, { color: colors.textSecondary }]}>홈으로 가기</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  // Step 2: 푸시 알림 동의
  if (step === 2) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
        <View style={styles.content}>
          <View style={[styles.stepIndicator, { backgroundColor: colors.primaryLight }]}>
            <Text style={[typo.captionMedium, { color: colors.primary }]}>
              2단계 / {ONBOARDING_TOTAL_STEPS}
            </Text>
          </View>

          <Text style={[typo.h1, { color: colors.text, marginTop: spacing.lg }]}>
            공시 알림을{'\n'}받아보세요
          </Text>
          <Text style={[typo.body, { color: colors.textSecondary, marginTop: spacing.sm }]}>
            관심 기업의 새 공시가 등록되면{'\n'}실시간으로 알려드려요
          </Text>

          <View style={styles.notificationContent}>
            <View style={[styles.bellCircle, {
              backgroundColor: colors.primaryLight,
              borderColor: colors.primary + '25',
              shadowColor: colors.primary,
            }]}>
              <Bell size={48} color={colors.primary} weight="duotone" />
            </View>

            <View style={styles.featureList}>
              <FeatureItem
                icon="flash-outline"
                text="실시간 공시 알림"
                colors={colors}
                typo={typo}
              />
              <FeatureItem
                icon="filter-outline"
                text="관심 기업 & 공시 유형별 필터"
                colors={colors}
                typo={typo}
              />
              <FeatureItem
                icon="settings-outline"
                text="언제든 설정에서 변경 가능"
                colors={colors}
                typo={typo}
              />
            </View>
          </View>
        </View>

        <View style={styles.footer}>
          <Button
            title="알림 받기"
            onPress={handleEnableNotifications}
            fullWidth
            size="lg"
            loading={isSubmitting}
          />
          <TouchableOpacity
            style={styles.skipButton}
            onPress={handleSkipNotifications}
          >
            <Text style={[typo.captionMedium, { color: colors.textSecondary }]}>나중에 하기</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  // Step 1: 관심 기업 선택
  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={styles.content}>
        <View style={[styles.stepIndicator, { backgroundColor: colors.primaryLight }]}>
          <Text style={[typo.captionMedium, { color: colors.primary }]}>
            1단계 / {ONBOARDING_TOTAL_STEPS}
          </Text>
        </View>

        <Text style={[typo.h1, { color: colors.text, marginTop: spacing.lg }]}>
          관심 기업을{'\n'}등록하세요
        </Text>
        <Text style={[typo.body, { color: colors.textSecondary, marginTop: spacing.sm }]}>
          관심 기업을 추가하면 맞춤 공시·신호를 받아요. 나중에 추가해도 괜찮아요.
        </Text>

        {isLoading ? (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color={colors.primary} />
            <Text style={[typo.body, { color: colors.textSecondary, marginTop: spacing.md }]}>
              인기 기업을 불러오는 중...
            </Text>
          </View>
        ) : (
          <FlatList
            data={popularCompanies}
            keyExtractor={(item) => item.corpCode}
            style={styles.list}
            showsVerticalScrollIndicator={false}
            renderItem={({ item }) => {
              const isSelected = selected.includes(item.corpCode);
              return (
                <TouchableOpacity
                  style={[
                    styles.companyItem,
                    {
                      backgroundColor: isSelected ? colors.primaryLight : colors.surface,
                      borderColor: isSelected ? colors.primary : colors.border,
                    },
                  ]}
                  onPress={() => toggleCompany(item.corpCode)}
                  activeOpacity={0.7}
                >
                  <View>
                    <Text style={[typo.bodyMedium, { color: colors.text }]}>{item.corpName}</Text>
                    <Text style={[typo.small, { color: colors.textSecondary }]}>{item.stockCode}</Text>
                  </View>
                  {isSelected && (
                    <Ionicons name="checkmark-circle" size={24} color={colors.primary} />
                  )}
                </TouchableOpacity>
              );
            }}
          />
        )}
      </View>

      <View style={styles.footer}>
        <Text style={[typo.caption, { color: colors.textSecondary, textAlign: 'center', marginBottom: spacing.md }]}>
          {selected.length > 0 ? `${selected.length}개 선택됨` : '지금 선택하지 않아도 나중에 추가할 수 있어요'}
        </Text>
        {/* 마찰제거(DAR-65): 0개여도 진행 가능. 0개면 건너뛰기 라벨로 의도를 명확히. */}
        <Button
          title={selected.length > 0 ? '계속하기' : '건너뛰고 시작하기'}
          onPress={handleStep1Continue}
          fullWidth
          size="lg"
          loading={isSubmitting}
        />
      </View>
    </SafeAreaView>
  );
}

function FeatureItem({ icon, text, colors, typo }: {
  icon: keyof typeof Ionicons.glyphMap;
  text: string;
  colors: ReturnType<typeof useTheme>['colors'];
  typo: ReturnType<typeof useTheme>['typography'];
}) {
  return (
    <View style={styles.featureItem}>
      <View style={[styles.featureIcon, { backgroundColor: colors.primaryLight }]}>
        <Ionicons name={icon} size={18} color={colors.primary} />
      </View>
      <Text style={[typo.body, { color: colors.text, marginLeft: spacing.md }]}>{text}</Text>
    </View>
  );
}

// Step 3(DAR-209) 가치 카드 — 신호/포트폴리오 핵심 가치를 사실 기반으로 안내.
function ValueCard({ icon, title, description, colors, typo }: {
  icon: React.ReactNode;
  title: string;
  description: string;
  colors: ReturnType<typeof useTheme>['colors'];
  typo: ReturnType<typeof useTheme>['typography'];
}) {
  return (
    <View
      style={[styles.valueCard, { backgroundColor: colors.surface, borderColor: colors.border }]}
      accessibilityRole="summary"
      accessibilityLabel={`${title}. ${description}`}
    >
      <View style={[styles.valueIcon, { backgroundColor: colors.primaryLight }]}>{icon}</View>
      <View style={styles.valueText}>
        <Text style={[typo.bodyMedium, { color: colors.text }]}>{title}</Text>
        <Text style={[typo.caption, styles.valueDesc, { color: colors.textSecondary }]}>
          {description}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    flex: 1,
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.xl,
  },
  stepIndicator: {
    alignSelf: 'flex-start',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radius.full,
  },
  list: {
    marginTop: spacing.xl,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  companyItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: spacing.base,
    borderRadius: radius.md,
    borderWidth: 1.5,
    marginBottom: spacing.sm,
  },
  notificationContent: {
    paddingTop: spacing['3xl'],
    justifyContent: 'center',
    alignItems: 'center',
  },
  bellCircle: {
    width: 100,
    height: 100,
    borderRadius: 50,
    borderWidth: 2,
    justifyContent: 'center',
    alignItems: 'center',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 8,
    elevation: 4,
  },
  featureList: {
    alignSelf: 'stretch',
    marginTop: spacing['2xl'],
  },
  featureItem: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacing.base,
  },
  featureIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    justifyContent: 'center',
    alignItems: 'center',
  },
  valueList: {
    marginTop: spacing['2xl'],
    gap: spacing.md,
  },
  valueCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    padding: spacing.base,
    borderRadius: radius.lg,
    borderWidth: 1,
  },
  valueIcon: {
    width: 48,
    height: 48,
    borderRadius: radius.md,
    justifyContent: 'center',
    alignItems: 'center',
  },
  valueText: {
    flex: 1,
    marginLeft: spacing.md,
  },
  valueDesc: {
    marginTop: 2,
  },
  disclaimerText: {
    flex: 1,
  },
  disclaimerMini: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    padding: spacing.sm,
    borderRadius: radius.sm,
    marginTop: spacing.xl,
  },
  footer: {
    paddingHorizontal: spacing.xl,
    paddingBottom: spacing['2xl'],
  },
  skipButton: {
    alignItems: 'center',
    marginTop: spacing.md,
    paddingVertical: spacing.sm,
  },
});
