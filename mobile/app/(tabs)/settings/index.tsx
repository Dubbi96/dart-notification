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
import { Feather } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useTheme, MAX_CHIP_FONT_SCALE } from '@theme';
import { palette } from '@theme/colors';
import { spacing, radius } from '@theme/spacing';
import { GlassCard } from '@components/common/GlassCard';
import { DevConnectionStatus } from '@components/common/DevConnectionStatus';
import { useDialog } from '@components/common/DialogProvider';
import { useAuthStore } from '@stores/authStore';
import { useSettingsStore } from '@stores/settingsStore';
import { useLogout, useMe } from '@hooks/useAuth';
import { useWatchlist } from '@hooks/useWatchlist';
import { verticalHitSlopForHeight } from '@utils/touchTarget';
import type { ColorScheme } from '@theme';

// DAR-470: 현재값 칩 최대 폭(긴 옵션 라벨 줄임 기준). 매직넘버 금지 → 명명 상수.
const VALUE_CHIP_MAX_WIDTH = 160;

// D7(L-4): 게스트 헤더 '로그인하기' 링크 — caption 한 줄(lineHeight 20)이라 실터치 높이가 44pt 미만.
// 시각 크기는 유지하고 세로 hitSlop 으로 유효 터치 영역만 44pt 로 확장한다(DAR-146 규약).
const GUEST_LOGIN_LINK_VISUAL_HEIGHT = 20;
const GUEST_LOGIN_LINK_HIT_SLOP = verticalHitSlopForHeight(GUEST_LOGIN_LINK_VISUAL_HEIGHT);

interface MenuItemProps {
  icon: keyof typeof Feather.glyphMap;
  title: string;
  subtitle?: string;
  onPress?: () => void;
  badgeCount?: number;
  showChevron?: boolean;
  /** cycle 행 우측 현재값 칩(있으면 순환 아이콘 동반) — 탭 시 값이 순환함을 알리는 affordance (D8). */
  valueChip?: string;
  /** 보조 동작 설명(스크린리더). 예: cycle 행 "탭하면 다음 옵션으로 전환" (D8). */
  accessibilityHint?: string;
  /** 비터치 정보 행(예: 앱 정보) — View 로 렌더해 dead tap 제거 (D9). */
  nonInteractive?: boolean;
}

function MenuItem({
  icon,
  title,
  subtitle,
  onPress,
  badgeCount,
  showChevron = true,
  valueChip,
  accessibilityHint,
  nonInteractive = false,
}: MenuItemProps) {
  const { colors, typography: typo } = useTheme();

  // D2: title/subtitle/현재값을 합쳐 스크린리더가 행 전체를 하나의 버튼으로 읽도록 라벨 구성.
  const a11yLabel = [title, subtitle, valueChip ? `현재 ${valueChip}` : null]
    .filter(Boolean)
    .join(', ');

  const body = (
    <>
      <View style={[styles.menuIcon, { backgroundColor: colors.primaryLight }]}>
        <Feather name={icon} size={20} color={colors.primary} />
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
            {/* DAR-305: 고정 원형 배지 — OS 글꼴 확대 시 숫자 세로 클리핑 방지 배율 상한(DAR-174 정본). */}
            <Text
              style={[typo.small, { color: colors.primaryForeground, fontWeight: '600' }]}
              maxFontSizeMultiplier={MAX_CHIP_FONT_SCALE}
            >
              {badgeCount}
            </Text>
          </View>
        )}
        {valueChip != null && (
          // D8: 현재값 칩 + 순환 아이콘으로 cycle affordance 제공(chevron 대체).
          <View style={[styles.valueChip, { backgroundColor: colors.primaryLight }]}>
            <Text
              style={[typo.small, styles.valueChipText, { color: colors.primary }]}
              maxFontSizeMultiplier={MAX_CHIP_FONT_SCALE}
              numberOfLines={1}
            >
              {valueChip}
            </Text>
            <Feather name="refresh-cw" size={14} color={colors.primary} />
          </View>
        )}
        {showChevron && <Feather name="chevron-right" size={18} color={colors.textTertiary} />}
      </View>
    </>
  );

  // D9: 비터치 정보 행은 버튼이 아닌 정적 텍스트 행으로 렌더(빈 onPress dead tap 제거).
  if (nonInteractive) {
    return (
      <View style={styles.menuItem} accessible accessibilityLabel={a11yLabel}>
        {body}
      </View>
    );
  }

  return (
    <TouchableOpacity
      style={styles.menuItem}
      onPress={onPress}
      activeOpacity={0.7}
      accessibilityRole="button"
      accessibilityLabel={a11yLabel}
      accessibilityHint={accessibilityHint}
    >
      {body}
    </TouchableOpacity>
  );
}

export default function SettingsScreen() {
  const { colors, typography: typo } = useTheme();
  const { isAuthenticated } = useAuthStore();
  const { colorSchemeOverride, setColorScheme, textScaleOverride, setTextScaleOverride } =
    useSettingsStore();
  const { mutate: logout } = useLogout();
  const { showDialog } = useDialog();
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

  // D3: 파괴적 액션 — 오탭 한 번에 로그아웃되지 않도록 확인 다이얼로그 게이트.
  const handleLogout = () => {
    showDialog({
      title: '로그아웃',
      message: '로그아웃하시겠어요?',
      icon: { name: 'log-out', color: colors.error },
      buttons: [
        { text: '취소', style: 'cancel' },
        { text: '로그아웃', style: 'destructive', onPress: () => logout() },
      ],
    });
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]} testID="settings-screen">
      {/* Profile Header - 고정 영역 */}
      <LinearGradient
        colors={[colors.cardGradientStart, colors.cardGradientEnd]}
        style={[styles.profileHeader, { paddingTop: insets.top + spacing.base }]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
      >
        <View style={styles.profileRow}>
          {/* D1: 탭 라벨(설정)과 일치 — 하단 '프로필 정보' 행과의 혼동 제거. */}
          <Text style={[typo.h2, { color: palette.white }]}>설정</Text>
        </View>

        {isAuthenticated ? (
          <>
            <View style={styles.profileInfo}>
              <View style={[styles.avatar, { backgroundColor: colors.avatarOnColor }]}>
                <Feather name="user" size={32} color={palette.white} />
              </View>
              <View style={styles.profileText}>
                <Text style={[typo.h3, { color: palette.white }]}>{user?.name || '사용자'}</Text>
                <Text style={[typo.caption, { color: colors.onColorSubtle }]}>
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
                    <Text style={[typo.small, { color: colors.onColorMuted }]}>
                      무제한 관심기업 & 고급 필터
                    </Text>
                  </View>
                  <Feather name="arrow-right-circle" size={28} color={colors.onColorStrong} />
                </View>
              </GlassCard>
            </TouchableOpacity>
          </>
        ) : (
          <View style={styles.profileInfo}>
            <View style={[styles.avatar, { backgroundColor: colors.avatarOnColor }]}>
              <Feather name="user" size={32} color={palette.white} />
            </View>
            <View style={styles.profileText}>
              <Text style={[typo.h3, { color: palette.white }]}>GUEST</Text>
              {/* D7(L-4): 게스트의 유일한 헤더 로그인 동선 — hitSlop 44pt + 버튼 role/label 로 스크린리더 발견성 확보. */}
              <TouchableOpacity
                onPress={() => {
                  useAuthStore.getState().clearAuth();
                  router.push('/auth/sign-in');
                }}
                hitSlop={GUEST_LOGIN_LINK_HIT_SLOP}
                accessibilityRole="button"
                accessibilityLabel="로그인하기"
              >
                <Text style={[typo.caption, { color: colors.onColorStrong, textDecorationLine: 'underline' }]}>
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
                  icon="user"
                  title="프로필 정보"
                  subtitle="계정 정보 관리"
                  onPress={() => router.push('/settings-detail/profile')}
                />
                <Divider style={{ backgroundColor: colors.borderLight }} />
                <MenuItem
                  icon="star"
                  title="관심목록"
                  subtitle="관심 기업 관리"
                  onPress={() => router.push('/settings-detail/watchlist')}
                  badgeCount={watchlistCount}
                />
                <Divider style={{ backgroundColor: colors.borderLight }} />
                <MenuItem
                  icon="bell"
                  title="알림 설정"
                  subtitle="알림 환경 설정"
                  onPress={() => router.push('/settings-detail/notification-settings')}
                />
                <Divider style={{ backgroundColor: colors.borderLight }} />
                {/* D12: 저장된 공시 진입점을 설정에 노출(기존엔 홈·공시상세에서만 접근 가능해 발견성 낮음). */}
                <MenuItem
                  icon="bookmark"
                  title="저장된 공시"
                  subtitle="북마크한 공시 모아보기"
                  onPress={() => router.push('/settings-detail/saved-disclosures')}
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
                icon="moon"
                title="화면 설정"
                subtitle="테마 모드 전환"
                valueChip={themeLabel}
                accessibilityHint="탭하면 다음 옵션으로 전환"
                onPress={cycleTheme}
                showChevron={false}
              />
              <Divider style={{ backgroundColor: colors.borderLight }} />
              <MenuItem
                icon="type"
                title="글자 크기"
                subtitle="본문 글자 배율"
                valueChip={textScaleLabel}
                accessibilityHint="탭하면 다음 옵션으로 전환"
                onPress={cycleTextScale}
                showChevron={false}
              />
              <Divider style={{ backgroundColor: colors.borderLight }} />
              <MenuItem
                icon="activity"
                title="수집 현황"
                subtitle="공시·재무·지표·모의 커버리지"
                onPress={() => router.push('/settings-detail/collection-status')}
              />
              <Divider style={{ backgroundColor: colors.borderLight }} />
              <MenuItem
                icon="bar-chart-2"
                title="AI 비용/거버넌스"
                subtitle="AI 분석 비용·한도 소진율"
                onPress={() => router.push('/settings-detail/ai-cost')}
              />
              <Divider style={{ backgroundColor: colors.borderLight }} />
              <MenuItem
                icon="file-text"
                title="이용약관"
                onPress={() => router.push('/legal/terms')}
              />
              <Divider style={{ backgroundColor: colors.borderLight }} />
              <MenuItem
                icon="shield"
                title="개인정보 처리방침"
                onPress={() => router.push('/legal/privacy')}
              />
              <Divider style={{ backgroundColor: colors.borderLight }} />
              {/* D9: dead tap 제거 — 버전 표시는 정보 행이므로 비터치(View)로 렌더. */}
              <MenuItem
                icon="info"
                title="앱 정보"
                subtitle="Version 1.0.0"
                nonInteractive
                showChevron={false}
              />
              <Divider style={{ backgroundColor: colors.borderLight }} />
              {isAuthenticated ? (
                <MenuItem
                  icon="log-out"
                  title="로그아웃"
                  onPress={handleLogout}
                />
              ) : (
                <MenuItem
                  icon="log-in"
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
  valueChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: radius.full,
    maxWidth: VALUE_CHIP_MAX_WIDTH,
  },
  valueChipText: {
    fontWeight: '600',
  },
});
