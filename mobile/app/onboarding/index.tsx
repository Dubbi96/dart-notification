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
import { Bell } from 'phosphor-react-native';
import { router } from 'expo-router';
import * as Notifications from 'expo-notifications';
import { useTheme } from '@theme';
import { spacing, radius } from '@theme/spacing';
import { Button } from '@components/common/Button';
import { useAddToWatchlist } from '@hooks/useWatchlist';
import { usePopularCompanies } from '@hooks/useCompanySearch';
import { useAuthStore } from '@stores/authStore';
import { deviceService } from '@services/device.service';
import { notificationSettingsService } from '@services/notification-settings.service';

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

  const handleStep1Continue = async () => {
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

  const handleStep1Skip = () => {
    setStep(2);
  };

  const handleEnableNotifications = async () => {
    setIsSubmitting(true);
    try {
      const { status } = await Notifications.requestPermissionsAsync();
      if (status === 'granted') {
        const tokenData = await Notifications.getExpoPushTokenAsync({ projectId: PROJECT_ID });
        const token = tokenData.data;
        const platform = Platform.OS === 'ios' ? 'ios' : 'android';
        await deviceService.register(token, platform);
        setExpoPushToken(token);
      }
    } catch (err) {
      console.warn('푸시 알림 설정 실패:', err);
    } finally {
      setIsSubmitting(false);
      completeOnboarding();
      router.replace('/(tabs)/home');
    }
  };

  const handleSkipNotifications = async () => {
    try {
      await notificationSettingsService.update({ isEnabled: false });
    } catch {
      // 실패해도 진행
    }
    completeOnboarding();
    router.replace('/(tabs)/home');
  };

  // Step 2: 푸시 알림 동의
  if (step === 2) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
        <View style={styles.content}>
          <View style={[styles.stepIndicator, { backgroundColor: colors.primaryLight }]}>
            <Text style={[typo.captionMedium, { color: colors.primary }]}>2단계 / 2</Text>
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
          <Text style={[typo.captionMedium, { color: colors.primary }]}>1단계 / 2</Text>
        </View>

        <Text style={[typo.h1, { color: colors.text, marginTop: spacing.lg }]}>
          관심 기업을{'\n'}등록하세요
        </Text>
        <Text style={[typo.body, { color: colors.textSecondary, marginTop: spacing.sm }]}>
          공시 알림을 받으려면 최소 1개 기업을 선택하세요
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
          {selected.length}개 선택됨
        </Text>
        <Button
          title="계속하기"
          onPress={handleStep1Continue}
          fullWidth
          size="lg"
          disabled={selected.length === 0}
          loading={isSubmitting}
        />
        <TouchableOpacity
          style={styles.skipButton}
          onPress={handleStep1Skip}
        >
          <Text style={[typo.captionMedium, { color: colors.textSecondary }]}>나중에 하기</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

function FeatureItem({ icon, text, colors, typo }: {
  icon: string;
  text: string;
  colors: any;
  typo: any;
}) {
  return (
    <View style={styles.featureItem}>
      <View style={[styles.featureIcon, { backgroundColor: colors.primaryLight }]}>
        <Ionicons name={icon as any} size={18} color={colors.primary} />
      </View>
      <Text style={[typo.body, { color: colors.text, marginLeft: spacing.md }]}>{text}</Text>
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
