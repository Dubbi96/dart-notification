import React from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  Image,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { Divider } from 'react-native-paper';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useTheme } from '@theme';
import { spacing, radius } from '@theme/spacing';
import { GlassCard } from '@components/common/GlassCard';
import { useAuthStore } from '@stores/authStore';
import { useLogout } from '@hooks/useAuth';

interface MenuItemProps {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  subtitle?: string;
  onPress: () => void;
  showBadge?: boolean;
}

function MenuItem({ icon, title, subtitle, onPress, showBadge }: MenuItemProps) {
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
        {showBadge && (
          <View style={[styles.badge, { backgroundColor: colors.primary }]}>
            <Text style={[typo.small, { color: '#FFF', fontWeight: '600' }]}>3</Text>
          </View>
        )}
        <Ionicons name="chevron-forward" size={18} color={colors.textTertiary} />
      </View>
    </TouchableOpacity>
  );
}

export default function SettingsScreen() {
  const { colors, typography: typo } = useTheme();
  const { user } = useAuthStore();
  const { mutate: logout } = useLogout();

  const handleLogout = () => {
    logout();
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={['top']}>
      <ScrollView showsVerticalScrollIndicator={false}>
        {/* Profile Header - Paychain style */}
        <LinearGradient
          colors={[colors.cardGradientStart, colors.cardGradientEnd]}
          style={styles.profileHeader}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
        >
          <View style={styles.profileRow}>
            <Text style={[typo.h2, { color: '#FFFFFF' }]}>프로필</Text>
            <TouchableOpacity>
              <Ionicons name="settings-outline" size={24} color="rgba(255,255,255,0.8)" />
            </TouchableOpacity>
          </View>

          <View style={styles.profileInfo}>
            <View style={[styles.avatar, { backgroundColor: 'rgba(255,255,255,0.2)' }]}>
              <Ionicons name="person" size={32} color="#FFFFFF" />
            </View>
            <View style={styles.profileText}>
              <Text style={[typo.h3, { color: '#FFFFFF' }]}>{user?.name || '사용자'}</Text>
              <Text style={[typo.caption, { color: 'rgba(255,255,255,0.7)' }]}>
                {user?.email || '-'}
              </Text>
            </View>
          </View>

          {/* Promo Banner - Glass + Holographic */}
          <GlassCard style={styles.promoBanner} intensity={25} variant="iridescent">
            <View style={styles.promoContent}>
              <View>
                <Text style={[typo.captionMedium, { color: '#FFFFFF' }]}>
                  Pro로 업그레이드
                </Text>
                <Text style={[typo.small, { color: 'rgba(255,255,255,0.8)' }]}>
                  무제한 관심기업 & 고급 필터
                </Text>
              </View>
              <Ionicons name="arrow-forward-circle" size={28} color="rgba(255,255,255,0.9)" />
            </View>
          </GlassCard>
        </LinearGradient>

        {/* Content area with top border radius */}
        <View style={[styles.contentArea, { backgroundColor: colors.background }]}>
        {/* Menu Section */}
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
              showBadge
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

        <View style={styles.section}>
          <Text style={[typo.captionMedium, styles.sectionTitle, { color: colors.textSecondary }]}>
            일반
          </Text>
          <View style={[styles.menuCard, { backgroundColor: colors.surface }]}>
            <MenuItem
              icon="moon-outline"
              title="화면 설정"
              subtitle="다크모드 & 테마"
              onPress={() => {}}
            />
            <Divider style={{ backgroundColor: colors.borderLight }} />
            <MenuItem
              icon="information-circle-outline"
              title="앱 정보"
              subtitle="Version 1.0.0"
              onPress={() => {}}
            />
            <Divider style={{ backgroundColor: colors.borderLight }} />
            <MenuItem
              icon="log-out-outline"
              title="로그아웃"
              onPress={handleLogout}
            />
          </View>
        </View>

        <View style={{ height: spacing['2xl'] }} />
        </View>
      </ScrollView>
    </SafeAreaView>
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
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    marginTop: -radius.xl,
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
