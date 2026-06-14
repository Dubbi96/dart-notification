import React, { useCallback } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { Divider } from 'react-native-paper';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useTheme } from '@theme';
import { palette } from '@theme/colors';
import { spacing, radius } from '@theme/spacing';
import { GlassCard } from '@components/common/GlassCard';
import { DevConnectionStatus } from '@components/common/DevConnectionStatus';
import { useAuthStore } from '@stores/authStore';
import { useSettingsStore } from '@stores/settingsStore';
import { useLogout, useMe } from '@hooks/useAuth';
import { useWatchlist } from '@hooks/useWatchlist';
import type { ColorScheme } from '@theme';

interface MenuItemProps {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  subtitle?: string;
  onPress: () => void;
  badgeCount?: number;
  showChevron?: boolean;
}

function MenuItem({ icon, title, subtitle, onPress, badgeCount, showChevron = true }: MenuItemProps) {
  const { colors, typography: typo } = useTheme();

  return (
    <TouchableOpacity
      style={styles.menuItem}
      onPress={onPress}
      activeOpacity={0.7}
    >
      <View style={[styles.menuIcon, { backgroundColor: colors.primaryLight }]}>
        <Ionicons name={icon} size={20} color={colors.primary} />
      </View>
      <View style={styles.menuContent}>
        <Text style={[typo.bodyMedium, { color: colors.text }]}>{title}</Text>
        {subtitle && (
          <Text style={[typo.small, { color: colors.textSecondary }]}>{subtitle}</Text>
        )}
      </View>
      <View style={styles.menuRight}>
        {badgeCount != null && badgeCount > 0 && (
          <View style={[styles.badge, { backgroundColor: colors.primary }]}>
            <Text style={[typo.small, { color: colors.primaryForeground, fontWeight: '600' }]}>{badgeCount}</Text>
          </View>
        )}
        {showChevron && <Ionicons name="chevron-forward" size={18} color={colors.textTertiary} />}
      </View>
    </TouchableOpacity>
  );
}

export default function SettingsScreen() {
  const { colors, typography: typo } = useTheme();
  const { isAuthenticated } = useAuthStore();
  const { colorSchemeOverride, setColorScheme, textScaleOverride, setTextScaleOverride } =
    useSettingsStore();
  const { mutate: logout } = useLogout();
  // 서버 User SSOT = useMe().data (authStore 복제 제거, DAR-262).
  const { data: user, refetch: refetchMe } = useMe();
  const insets = useSafeAreaInsets();
  const { data: watchlistData } = useWatchlist({ enabled: isAuthenticated });
  const watchlistCount = watchlistData?.meta?.total ?? 0;

  // 설정 탭 포커스 시 유저 정보 갱신
  useFocusEffect(
    useCallback(() => {
      if (isAuthenticated) refetchMe();
    }, [refetchMe, isAuthenticated]),
  );

  const themeLabel = colorSchemeOverride === 'system' ? '시스템' : colorSchemeOverride === 'dark' ? '다크' : '라이트';
  const cycleTheme = () => {
    const order: (ColorScheme | 'system')[] = ['system', 'light', 'dark'];
    const idx = order.indexOf(colorSchemeOverride);
    setColorScheme(order[(idx + 1) % order.length]);
  };

  // 글자 크기(§9) — 시스템 따름 → 크게(1.25x) → 아주 크게(1.5x) 순환. 1.5x 클램프는 테마에서 보장.
  const textScaleLabel =
    textScaleOverride === null
      ? '시스템 따름'
      : textScaleOverride === 1.25
        ? '크게 (1.25x)'
        : '아주 크게 (1.5x)';
  const cycleTextScale = () => {
    const order: (typeof textScaleOverride)[] = [null, 1.25, 1.5];
    const idx = order.indexOf(textScaleOverride);
    setTextScaleOverride(order[(idx + 1) % order.length]);
  };

  const handleLogout = () => {
    logout();
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {/* Profile Header - 고정 영역 */}
      <LinearGradient
        colors={[colors.cardGradientStart, colors.cardGradientEnd]}
        style={[styles.profileHeader, { paddingTop: insets.top + spacing.base }]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
      >
        <View style={styles.profileRow}>
          <Text style={[typo.h2, { color: palette.white }]}>프로필</Text>
        </View>

        {isAuthenticated ? (
          <>
            <View style={styles.profileInfo}>
              <View style={[styles.avatar, { backgroundColor: 'rgba(255,255,255,0.2)' }]}>
                <Ionicons name="person" size={32} color={palette.white} />
              </View>
              <View style={styles.profileText}>
                <Text style={[typo.h3, { color: palette.white }]}>{user?.name || '사용자'}</Text>
                <Text style={[typo.caption, { color: 'rgba(255,255,255,0.7)' }]}>
                  {user?.email?.includes('@kakao.user') ? '카카오 로그인' : user?.email || '-'}
                </Text>
              </View>
            </View>

            <TouchableOpacity
              activeOpacity={0.8}
              onPress={() => router.push('/settings-detail/pro')}
              accessibilityRole="button"
              accessibilityLabel="Pro 혜택 보기"
            >
              <GlassCard style={styles.promoBanner} intensity={25} variant="iridescent">
                <View style={styles.promoContent}>
                  <View>
                    <Text style={[typo.captionMedium, { color: palette.white }]}>
                      Pro로 업그레이드
                    </Text>
                    <Text style={[typo.small, { color: 'rgba(255,255,255,0.8)' }]}>
                      무제한 관심기업 & 고급 필터
                    </Text>
                  </View>
                  <Ionicons name="arrow-forward-circle" size={28} color="rgba(255,255,255,0.9)" />
                </View>
              </GlassCard>
            </TouchableOpacity>
          </>
        ) : (
          <View style={styles.profileInfo}>
            <View style={[styles.avatar, { backgroundColor: 'rgba(255,255,255,0.2)' }]}>
              <Ionicons name="person" size={32} color={palette.white} />
            </View>
            <View style={styles.profileText}>
              <Text style={[typo.h3, { color: palette.white }]}>GUEST</Text>
              <TouchableOpacity onPress={() => {
                useAuthStore.getState().clearAuth();
                router.push('/auth/sign-in');
              }}>
                <Text style={[typo.caption, { color: 'rgba(255,255,255,0.9)', textDecorationLine: 'underline' }]}>
                  로그인하기
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        )}
      </LinearGradient>

      {/* Content area - 스크롤 영역 */}
      <View style={[styles.contentArea, { backgroundColor: colors.background }]}>
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scrollContent}>
          {isAuthenticated && (
            <View style={styles.section}>
              <Text style={[typo.captionMedium, styles.sectionTitle, { color: colors.textSecondary }]}>
                계정 관리
              </Text>
              <View style={[styles.menuCard, { backgroundColor: colors.surface }]}>
                <MenuItem
                  icon="person-outline"
                  title="프로필 정보"
                  subtitle="계정 정보 관리"
                  onPress={() => router.push('/settings-detail/profile')}
                />
                <Divider style={{ backgroundColor: colors.borderLight }} />
                <MenuItem
                  icon="star-outline"
                  title="관심목록"
                  subtitle="관심 기업 관리"
                  onPress={() => router.push('/settings-detail/watchlist')}
                  badgeCount={watchlistCount}
                />
                <Divider style={{ backgroundColor: colors.borderLight }} />
                <MenuItem
                  icon="notifications-outline"
                  title="알림 설정"
                  subtitle="알림 환경 설정"
                  onPress={() => router.push('/settings-detail/notification-settings')}
                />
              </View>
            </View>
          )}

          <View style={styles.section}>
            <Text style={[typo.captionMedium, styles.sectionTitle, { color: colors.textSecondary }]}>
              일반
            </Text>
            <View style={[styles.menuCard, { backgroundColor: colors.surface }]}>
              <MenuItem
                icon="moon-outline"
                title="화면 설정"
                subtitle={`현재: ${themeLabel} 모드`}
                onPress={cycleTheme}
                showChevron={false}
              />
              <Divider style={{ backgroundColor: colors.borderLight }} />
              <MenuItem
                icon="text-outline"
                title="글자 크기"
                subtitle={`현재: ${textScaleLabel}`}
                onPress={cycleTextScale}
                showChevron={false}
              />
              <Divider style={{ backgroundColor: colors.borderLight }} />
              <MenuItem
                icon="pulse-outline"
                title="수집 현황"
                subtitle="공시·재무·지표·모의 커버리지"
                onPress={() => router.push('/settings-detail/collection-status')}
              />
              <Divider style={{ backgroundColor: colors.borderLight }} />
              <MenuItem
                icon="analytics-outline"
                title="AI 비용/거버넌스"
                subtitle="AI 분석 비용·한도 소진율"
                onPress={() => router.push('/settings-detail/ai-cost')}
              />
              <Divider style={{ backgroundColor: colors.borderLight }} />
              <MenuItem
                icon="document-text-outline"
                title="이용약관"
                onPress={() => router.push('/legal/terms')}
              />
              <Divider style={{ backgroundColor: colors.borderLight }} />
              <MenuItem
                icon="shield-checkmark-outline"
                title="개인정보 처리방침"
                onPress={() => router.push('/legal/privacy')}
              />
              <Divider style={{ backgroundColor: colors.borderLight }} />
              <MenuItem
                icon="information-circle-outline"
                title="앱 정보"
                subtitle="Version 1.0.0"
                onPress={() => {}}
                showChevron={false}
              />
              <Divider style={{ backgroundColor: colors.borderLight }} />
              {isAuthenticated ? (
                <MenuItem
                  icon="log-out-outline"
                  title="로그아웃"
                  onPress={handleLogout}
                />
              ) : (
                <MenuItem
                  icon="log-in-outline"
                  title="로그인"
                  onPress={() => {
                    useAuthStore.getState().clearAuth();
                    router.push('/auth/sign-in');
                  }}
                />
              )}
            </View>
          </View>

          {/* 개발용 연결 진단(DAR-43 §4) — 프로덕션 빌드에는 노출되지 않음 */}
          {__DEV__ && (
            <View style={styles.section}>
              <Text style={[typo.captionMedium, styles.sectionTitle, { color: colors.textSecondary }]}>
                개발자
              </Text>
              <DevConnectionStatus />
            </View>
          )}

          <View style={{ height: spacing['2xl'] }} />
        </ScrollView>
      </View>

    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  profileHeader: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.base,
    paddingBottom: spacing.xl + radius.xl,
  },
  profileRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  profileInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: spacing.xl,
  },
  avatar: {
    width: 64,
    height: 64,
    borderRadius: 32,
    justifyContent: 'center',
    alignItems: 'center',
  },
  profileText: {
    marginLeft: spacing.base,
  },
  promoBanner: {
    marginTop: spacing.lg,
    borderRadius: radius.lg,
  },
  promoContent: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: spacing.base,
  },
  contentArea: {
    flex: 1,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    marginTop: -radius.xl,
  },
  scrollContent: {
    paddingBottom: spacing.xl,
  },
  section: {
    marginTop: spacing.xl,
    paddingHorizontal: spacing.lg,
  },
  sectionTitle: {
    marginBottom: spacing.sm,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  menuCard: {
    borderRadius: radius.lg,
    overflow: 'hidden',
  },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.base,
  },
  menuIcon: {
    width: 40,
    height: 40,
    borderRadius: radius.sm,
    justifyContent: 'center',
    alignItems: 'center',
  },
  menuContent: {
    flex: 1,
    marginLeft: spacing.md,
  },
  menuRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  badge: {
    minWidth: 22,
    height: 22,
    borderRadius: 11,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 6,
  },
});
