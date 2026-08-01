import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  FlatList,
  ActivityIndicator,
  Platform,
  BackHandler,
  Linking,
  type ListRenderItem,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons, Feather } from '@expo/vector-icons';
import { Bell, ChartLineUp, Briefcase } from 'phosphor-react-native';
import { router } from 'expo-router';
import { getNotifications } from '@utils/notifications';
import { useTheme } from '@theme';
import { spacing, radius, sizing } from '@theme/spacing';
import { Button } from '@components/common/Button';
import { EmptyState, ApiErrorState } from '@components/common/StateView';
import { useSnackbar } from '@components/common/SnackbarProvider';
import { SNACKBAR_DURATION } from '@components/common/snackbarCopy';
import { useAddToWatchlist } from '@hooks/useWatchlist';
import { usePopularCompanies } from '@hooks/useCompanySearch';
import { useAuthStore } from '@stores/authStore';
import { deviceService } from '@services/device.service';
import { notificationSettingsService } from '@services/notification-settings.service';
import { recordFunnelStep } from '@services/funnel.service';
import { EAS_PROJECT_ID } from '@utils/easProjectId';
import { isOfflineMutationBlockedError } from '@utils/offlineMutation';
import { ONBOARDING_TOTAL_STEPS, onboardingExitRoute } from '@utils/onboardingFlow';
import { verticalHitSlopForHeight } from '@utils/touchTarget';

// UXR-1/A-9: skipButton 시각 높이(paddingVertical sm×2 + captionMedium lineHeight 20)=36pt.
// 44pt 미달분은 hitSlop 으로 보정한다(시각 크기는 유지).
const SKIP_BUTTON_VISUAL_HEIGHT = 36;

export default function OnboardingScreen() {
  const { colors, typography: typo } = useTheme();
  const [step, setStep] = useState(1);
  const [selected, setSelected] = useState<string[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  // A-ONB-2: 알림 권한 거부 시 무음 실패 대신 인라인 안내를 띄우기 위한 플래그.
  const [permissionDenied, setPermissionDenied] = useState(false);
  const addToWatchlist = useAddToWatchlist();
  const { showSnackbar } = useSnackbar();
  const completeOnboarding = useAuthStore((s) => s.completeOnboarding);
  const setExpoPushToken = useAuthStore((s) => s.setExpoPushToken);
  const {
    data: popularCompanies = [],
    isLoading,
    isError,
    error,
    refetch,
  } = usePopularCompanies();

  // A-ONB-4: 단계 뒤로가기 — step 감소(1단계 미만 불가). 권한 거부 안내도 함께 정리.
  const handleBack = useCallback(() => {
    setPermissionDenied(false);
    setStep((s) => Math.max(1, s - 1));
  }, []);

  // A-ONB-4: 안드로이드 하드웨어 백 — 2·3단계에서는 화면 통째 이탈 대신 이전 단계로.
  useEffect(() => {
    const onHardwareBack = () => {
      if (step > 1) {
        handleBack();
        return true; // 단계만 뒤로 — 온보딩 화면 유지
      }
      return false; // 1단계: 기본 동작(온보딩 이탈) 허용
    };
    const sub = BackHandler.addEventListener('hardwareBackPress', onHardwareBack);
    return () => sub.remove();
  }, [step, handleBack]);

  // DAR-472: setSelected 함수형 업데이트만 사용 → 의존성 없는 안정 참조(renderCompany 재생성 방지).
  const toggleCompany = useCallback((corpCode: string) => {
    setSelected((prev) =>
      prev.includes(corpCode) ? prev.filter((c) => c !== corpCode) : [...prev, corpCode],
    );
  }, []);

  // DAR-472: 인기 기업 리스트 renderItem 을 useCallback 으로 분리 — 선택/테마 변경 시에만
  // 재생성되어 매 렌더의 함수 재할당을 피한다(toggleCompany 안정 참조와 함께).
  const renderCompany = useCallback<ListRenderItem<(typeof popularCompanies)[number]>>(
    ({ item }) => {
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
          accessibilityRole="button"
          accessibilityState={{ selected: isSelected }}
          accessibilityLabel={`${item.corpName} ${item.stockCode}`}
          accessibilityHint={
            isSelected ? '두 번 탭하면 관심 기업에서 제외해요' : '두 번 탭하면 관심 기업에 추가해요'
          }
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
    },
    [selected, colors, typo, toggleCompany],
  );

  // 마찰제거(DAR-65): 관심기업 선택은 선택 사항 — 0개여도 다음 단계로 진행한다.
  // (선택 안 하면 홈 첫 종목 코치마크가 이어서 등록을 유도)
  const handleStep1Continue = async () => {
    // 갭분석 W15 ③: 퍼널 4단계(watchlist) 계측 — 설치당 1회, fire-and-forget(실패 무시).
    // 0개 스킵도 단계 도달로 기록하고 선택 수는 meta 로 구분한다(측정만, 흐름 무개입).
    void recordFunnelStep('watchlist', { selectedCount: selected.length }, { once: true });
    if (selected.length === 0) {
      setStep(2);
      return;
    }
    setIsSubmitting(true);
    // UXR-1/A-6: 순차 await 는 첫 실패에서 나머지 등록까지 끊기고 무음으로 다음 단계로 넘어갔다.
    // allSettled 로 개별 실패를 수집해 나머지는 계속 등록하고, 실패 건수를 스낵바로 알린다.
    const selectedCompanies = popularCompanies.filter((c) => selected.includes(c.corpCode));
    const results = await Promise.allSettled(
      selectedCompanies.map((company) =>
        addToWatchlist.mutateAsync({ corpCode: company.corpCode, corpName: company.corpName }),
      ),
    );
    // 오프라인 차단 센티넬은 가드가 자체 안내를 이미 띄웠으므로 일반 실패 문구로 덮지 않는다(DAR-226).
    const failedCount = results.filter(
      (r) => r.status === 'rejected' && !isOfflineMutationBlockedError(r.reason),
    ).length;
    if (failedCount > 0) {
      showSnackbar(`${failedCount}개 기업 등록에 실패했어요. 나중에 다시 시도해 주세요.`, {
        duration: SNACKBAR_DURATION.error,
      });
    }
    setIsSubmitting(false);
    setStep(2);
  };

  const handleEnableNotifications = async () => {
    setIsSubmitting(true);
    try {
      const Notifications = getNotifications();
      if (!Notifications) {
        // Expo Go 안드로이드 등 미지원 환경: 권한 단계 건너뛰고 온보딩 계속
        // 갭분석 W15 ③: 퍼널 5단계(push_permission) 계측 — 결과(outcome)별 기록(측정만).
        void recordFunnelStep('push_permission', { outcome: 'unsupported' });
        setStep(3);
        return;
      }
      const { status } = await Notifications.requestPermissionsAsync();
      if (status !== 'granted') {
        // A-ONB-2: 무음 실패 방지 — 거부 사실을 인라인으로 알리고 단계 진행을 보류한다.
        // (사용자는 '설정 열기'로 켜거나 '나중에 하기'로 진행을 선택할 수 있다)
        void recordFunnelStep('push_permission', { outcome: 'denied' });
        setPermissionDenied(true);
        return;
      }
      setPermissionDenied(false);
      void recordFunnelStep('push_permission', { outcome: 'granted' });
      // UXR-1/A-1: projectId 는 빌드 설정 동적 해소 단일원천(EAS_PROJECT_ID)을 공유 —
      // 하드코딩된 구(舊) 프로젝트로 발급한 무효 토큰이 서버에 등록되는 것을 방지.
      const tokenData = await Notifications.getExpoPushTokenAsync({ projectId: EAS_PROJECT_ID });
      const token = tokenData.data;
      const platform = Platform.OS === 'ios' ? 'ios' : 'android';
      await deviceService.register(token, platform);
      setExpoPushToken(token);
      // DAR-209: 곧장 완료하지 않고 신호·포트폴리오 가치 단계로 이어간다.
      setStep(3);
    } catch (err) {
      console.warn('푸시 알림 설정 실패:', err);
      // 권한은 허용됐으나 토큰 등록만 실패한 경우 — 사용자를 막지 않고 진행한다.
      setStep(3);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSkipNotifications = async () => {
    // 갭분석 W15 ③: 퍼널 5단계(push_permission) 계측 — '나중에 하기'도 도달로 기록(측정만).
    void recordFunnelStep('push_permission', { outcome: 'skipped' });
    try {
      await notificationSettingsService.update({ isEnabled: false });
    } catch {
      // 실패해도 진행
    }
    setStep(3);
  };

  // Step 3: AOS 첫 화면인 종가 후 운영 브리핑으로 이동한다.
  const handleFinish = (exit: 'signals' | 'home') => {
    completeOnboarding();
    router.replace(onboardingExitRoute(exit));
  };

  // Step 3: 기기 Rule 판단과 조회 전용 포지션의 역할을 설명한다.
  if (step === 3) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
        <View style={styles.content}>
          <StepHeader step={3} onBack={handleBack} colors={colors} typo={typo} />

          <Text style={[typo.h1, { color: colors.text, marginTop: spacing.lg }]}>
            이제 투자 판단까지{'\n'}받아보세요
          </Text>
          <Text style={[typo.body, { color: colors.textSecondary, marginTop: spacing.sm }]}>
            공시를 나열하지 않고 Rule이 만든 종합 의견과{'\n'}조건부 실행 계획을 먼저 보여드려요.
          </Text>

          <View style={styles.valueList}>
            <ValueCard
              icon={<ChartLineUp size={28} color={colors.primary} weight="duotone" />}
              title="판단 — 기기 Rule 계산"
              description="종가 데이터와 진입 조건, Risk를 기기에서 다시 계산해 계획 여부를 구분해요."
              colors={colors}
              typo={typo}
            />
            <ValueCard
              icon={<Briefcase size={28} color={colors.primary} weight="duotone" />}
              title="포트폴리오 — 보유 종목 추적"
              description="보유 종목의 손익과 계획 중단 기준을 한눈에 확인해요."
              colors={colors}
              typo={typo}
            />
          </View>

          <View style={[styles.disclaimerMini, { backgroundColor: colors.surfaceSecondary }]}>
            <Ionicons name="information-circle-outline" size={14} color={colors.textTertiary} />
            <Text style={[typo.small, styles.disclaimerText, { color: colors.textTertiary }]}>
              Shadow 계획은 실주문이 아니며, 가격·조건이 달라지면 적용하지 않습니다
            </Text>
          </View>
        </View>

        <View style={styles.footer}>
          <Button
            title="오늘의 판단 보기"
            onPress={() => handleFinish('signals')}
            fullWidth
            size="lg"
          />
        </View>
      </SafeAreaView>
    );
  }

  // Step 2: 푸시 알림 동의
  if (step === 2) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
        <View style={styles.content}>
          <StepHeader step={2} onBack={handleBack} colors={colors} typo={typo} />

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

          {/* A-ONB-2: 권한 거부 시 무음 실패 대신 사유와 복구 경로(설정 열기)를 인라인 안내. */}
          {permissionDenied ? (
            <View style={[styles.permissionNotice, { backgroundColor: colors.warningSurface }]}>
              <Feather name="bell-off" size={18} color={colors.warning} />
              <View style={styles.permissionNoticeText}>
                <Text style={[typo.captionMedium, { color: colors.text }]}>
                  알림 권한이 꺼져 있어요
                </Text>
                <Text style={[typo.small, { color: colors.textSecondary }]}>
                  기기 설정에서 알림을 켜면 새 공시를 실시간으로 받아볼 수 있어요.
                </Text>
              </View>
              <TouchableOpacity
                onPress={() => Linking.openSettings()}
                accessibilityRole="button"
                accessibilityLabel="기기 설정 열기"
                style={styles.permissionSettingsButton}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <Text style={[typo.captionMedium, { color: colors.primary }]}>설정 열기</Text>
              </TouchableOpacity>
            </View>
          ) : null}
        </View>

        <View style={styles.footer}>
          <Button
            title="알림 받기"
            onPress={handleEnableNotifications}
            fullWidth
            size="lg"
            loading={isSubmitting}
          />
          {/* UXR-1/A-9: 3단계 스킵과 동일하게 role/label 부여 + 36pt 시각 높이의 터치 부족분 보정. */}
          <TouchableOpacity
            style={styles.skipButton}
            onPress={handleSkipNotifications}
            accessibilityRole="button"
            accessibilityLabel="알림 설정 나중에 하기"
            hitSlop={verticalHitSlopForHeight(SKIP_BUTTON_VISUAL_HEIGHT)}
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
        <StepHeader step={1} onBack={handleBack} colors={colors} typo={typo} />

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
            contentContainerStyle={popularCompanies.length === 0 ? styles.listEmptyContent : undefined}
            showsVerticalScrollIndicator={false}
            renderItem={renderCompany}
            // A-ONB-1: 빈/에러 상태에 빈 공백 대신 사유 + 재시도 경로 노출.
            ListEmptyComponent={
              isError ? (
                <ApiErrorState
                  error={error}
                  title="인기 기업을 불러오지 못했어요"
                  description="잠시 후 다시 시도해 주세요. 나중에 직접 추가할 수도 있어요."
                  onRetry={() => refetch()}
                />
              ) : (
                <EmptyState
                  icon="inbox"
                  title="표시할 인기 기업이 없어요"
                  description="잠시 후 다시 시도하거나, 나중에 검색으로 직접 추가할 수 있어요."
                  actionLabel="다시 불러오기"
                  onAction={() => refetch()}
                />
              )
            }
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

// A-ONB-4: 단계 헤더 — 좌상단 뒤로가기(2단계 이상에서만 노출) + 단계 표시 칩.
function StepHeader({ step, onBack, colors, typo }: {
  step: number;
  onBack: () => void;
  colors: ReturnType<typeof useTheme>['colors'];
  typo: ReturnType<typeof useTheme>['typography'];
}) {
  return (
    <View style={styles.stepHeader}>
      {step > 1 ? (
        <TouchableOpacity
          onPress={onBack}
          accessibilityRole="button"
          accessibilityLabel="이전 단계로"
          style={styles.backButton}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Feather name="arrow-left" size={24} color={colors.text} />
        </TouchableOpacity>
      ) : null}
      <View style={[styles.stepIndicator, { backgroundColor: colors.primaryLight }]}>
        <Text style={[typo.captionMedium, { color: colors.primary }]}>
          {step}단계 / {ONBOARDING_TOTAL_STEPS}
        </Text>
      </View>
    </View>
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
  stepHeader: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  backButton: {
    width: sizing.minTouchTarget,
    height: sizing.minTouchTarget,
    justifyContent: 'center',
    alignItems: 'center',
    marginLeft: -spacing.sm,
    marginRight: spacing.xs,
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
  listEmptyContent: {
    flexGrow: 1,
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
    minHeight: sizing.minTouchTarget,
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
    // 원형(폭/2=18) — 스케일 밖 매직넘버 대신 radius.full로 원형 의도 명시(L-5b E-1, 렌더 동일).
    borderRadius: radius.full,
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
  permissionNotice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    padding: spacing.base,
    borderRadius: radius.md,
    marginTop: spacing.xl,
  },
  permissionNoticeText: {
    flex: 1,
  },
  permissionSettingsButton: {
    minHeight: sizing.minTouchTarget,
    justifyContent: 'center',
    paddingHorizontal: spacing.sm,
  },
});
