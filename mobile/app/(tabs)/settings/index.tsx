import React, { useCallback } from 'react';
import { View, Text, ScrollView, StyleSheet, TouchableOpacity } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import Constants from 'expo-constants';
import { Divider } from 'react-native-paper';
import { Feather } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useTheme, MAX_CHIP_FONT_SCALE } from '@theme';
import { palette } from '@theme/colors';
import { spacing, radius } from '@theme/spacing';
import { DevConnectionStatus } from '@components/common/DevConnectionStatus';
import { useDialog } from '@components/common/DialogProvider';
import { HelpButton } from '@components/common/HelpButton';
import { useAuthStore } from '@stores/authStore';
import { useSettingsStore } from '@stores/settingsStore';
import { useLogout, useMe } from '@hooks/useAuth';
import { useWatchlist } from '@hooks/useWatchlist';

import type { ColorScheme } from '@theme';

const SETTINGS_HELP_SECTIONS = [
  {
    heading: '화면 설정',
    body: '누를 때마다 시스템, 라이트, 다크 순서로 바뀝니다.',
  },
  {
    heading: '글자 크기',
    body: '누를 때마다 시스템 따름, 크게(1.25배), 아주 크게(1.5배) 순서로 바뀝니다.',
  },
];

interface MenuItemProps {
  icon: keyof typeof Feather.glyphMap;
  title: string;
  subtitle?: string;
  onPress?: () => void;
  badgeCount?: number;
  showChevron?: boolean;
  /** 현재값 칩과 순환 아이콘 — 탭 시 값이 순환함을 알린다. */
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
          <Text style={[typo.caption, { color: colors.textSecondary }]}>{subtitle}</Text>
        )}
        {valueChip != null && (
          // 현재값은 본문 아래에 배치해 좁은 화면에서도 제목과 공간을 경쟁하지 않는다.
          <View style={[styles.valueChip, { backgroundColor: colors.primaryLight }]}>
            <Text style={[typo.captionMedium, styles.valueChipText, { color: colors.primary }]}>
              {valueChip}
            </Text>
            <Feather name="refresh-cw" size={14} color={colors.primary} />
          </View>
        )}
      </View>
      <View style={styles.menuRight}>
        {badgeCount != null && badgeCount > 0 && (
          <View style={[styles.badge, { backgroundColor: colors.primary }]}>
            <Text
              style={[typo.captionMedium, { color: colors.primaryForeground }]}
              maxFontSizeMultiplier={MAX_CHIP_FONT_SCALE}
            >
              {badgeCount}
            </Text>
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

  const themeLabel =
    colorSchemeOverride === 'system'
      ? '시스템'
      : colorSchemeOverride === 'dark'
        ? '다크'
        : '라이트';
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
    <ScrollView
      style={[styles.container, { backgroundColor: colors.background }]}
      contentContainerStyle={styles.scrollContent}
      showsVerticalScrollIndicator={false}
      testID="settings-screen"
    >
      {/* 프로필도 함께 스크롤해 큰 글자·긴 이름에서 설정 항목을 가리지 않는다. */}
      <LinearGradient
        colors={[colors.cardGradientStart, colors.cardGradientEnd]}
        style={[styles.profileHeader, { paddingTop: insets.top + spacing.base }]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
      >
        <View style={styles.profileRow}>
          {/* D1: 탭 라벨(설정)과 일치 — 하단 '프로필 정보' 행과의 혼동 제거. */}
          <Text style={[typo.h2, { color: palette.white }]}>제어 및 설정</Text>
        </View>

        {isAuthenticated ? (
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
        ) : (
          <View style={styles.profileInfo}>
            <View style={[styles.avatar, { backgroundColor: colors.avatarOnColor }]}>
              <Feather name="user" size={32} color={palette.white} />
            </View>
            <View style={styles.profileText}>
              <Text style={[typo.h3, { color: palette.white }]}>GUEST</Text>
              <TouchableOpacity
                style={styles.loginLink}
                onPress={() => {
                  useAuthStore.getState().clearAuth();
                  router.push('/auth/sign-in');
                }}
                accessibilityRole="button"
                accessibilityLabel="로그인하기"
              >
                <Text
                  style={[
                    typo.caption,
                    { color: colors.onColorStrong, textDecorationLine: 'underline' },
                  ]}
                >
                  로그인하기
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        )}
      </LinearGradient>

      {/* Content area - 스크롤 영역 */}
      <View style={[styles.contentArea, { backgroundColor: colors.background }]}>
        {isAuthenticated && (
          <View style={styles.section}>
            <Text
              style={[typo.captionMedium, styles.sectionTitle, { color: colors.textSecondary }]}
            >
              운영 제어
            </Text>
            <View style={[styles.menuCard, { backgroundColor: colors.surface }]}>
              <MenuItem
                icon="shield"
                title="비상 제어"
                subtitle="상태 확인 · 운영자 신규 진입 중단"
                onPress={() => router.push('/settings-detail/emergency-control')}
              />
            </View>
          </View>
        )}

        {isAuthenticated && (
          <View style={styles.section}>
            <Text
              style={[typo.captionMedium, styles.sectionTitle, { color: colors.textSecondary }]}
            >
              계정 관리
            </Text>
            <View style={[styles.menuCard, { backgroundColor: colors.surface }]}>
              <MenuItem
                icon="user"
                title="프로필 정보"
                onPress={() => router.push('/settings-detail/profile')}
              />
              <Divider style={{ backgroundColor: colors.borderLight }} />
              <MenuItem
                icon="star"
                title="관심목록"
                onPress={() => router.push('/settings-detail/watchlist')}
                badgeCount={watchlistCount}
              />
              <Divider style={{ backgroundColor: colors.borderLight }} />
              <MenuItem
                icon="bell"
                title="알림 설정"
                onPress={() => router.push('/settings-detail/notification-settings')}
              />
              <Divider style={{ backgroundColor: colors.borderLight }} />
              {/* D12/DAR-520: '보관함'(저장한 공시) 진입점을 설정에 노출(홈 summaryCard 1탭과 병행 — 발견성·재방문 훅 보존). */}
              <MenuItem
                icon="bookmark"
                title="보관함"
                accessibilityHint="저장한 공시를 엽니다"
                onPress={() => router.push('/settings-detail/saved-disclosures')}
              />
            </View>
          </View>
        )}

        <View style={styles.section}>
          <View style={styles.sectionHeading}>
            <Text
              style={[
                typo.captionMedium,
                styles.sectionHeadingTitle,
                { color: colors.textSecondary },
              ]}
            >
              일반
            </Text>
            <HelpButton title="화면·글자 설정" sections={SETTINGS_HELP_SECTIONS} />
          </View>
          <View style={[styles.menuCard, { backgroundColor: colors.surface }]}>
            <MenuItem
              icon="moon"
              title="화면 설정"
              valueChip={themeLabel}
              accessibilityHint="탭하면 다음 옵션으로 전환"
              onPress={cycleTheme}
              showChevron={false}
            />
            <Divider style={{ backgroundColor: colors.borderLight }} />
            <MenuItem
              icon="type"
              title="글자 크기"
              valueChip={textScaleLabel}
              accessibilityHint="탭하면 다음 옵션으로 전환"
              onPress={cycleTextScale}
              showChevron={false}
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
            {/* W11: 앱 내 문의 표면 — 이메일 문의·시스템 상태 페이지·버전 정보. */}
            <MenuItem
              icon="help-circle"
              title="문의·지원"
              accessibilityHint="이메일 문의와 시스템 상태를 확인합니다"
              onPress={() => router.push('/settings-detail/support')}
            />
            <Divider style={{ backgroundColor: colors.borderLight }} />
            {/* W2 컴플라이언스(M0 정책 §4): 시세·공시 데이터 출처·지연 고지·면책 화면 진입점. */}
            <MenuItem
              icon="database"
              title="데이터 출처"
              accessibilityHint="시세와 공시의 출처 및 지연 안내를 엽니다"
              onPress={() => router.push('/legal/data-sources')}
            />
            <Divider style={{ backgroundColor: colors.borderLight }} />
            {/* D9: dead tap 제거 — 버전 표시는 정보 행이므로 비터치(View)로 렌더. */}
            <MenuItem
              icon="info"
              title="앱 정보"
              subtitle={`Version ${Constants.expoConfig?.version ?? '확인 불가'}`}
              nonInteractive
              showChevron={false}
            />
            <Divider style={{ backgroundColor: colors.borderLight }} />
            {isAuthenticated ? (
              <MenuItem icon="log-out" title="로그아웃" onPress={handleLogout} />
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
            <Text
              style={[typo.captionMedium, styles.sectionTitle, { color: colors.textSecondary }]}
            >
              개발자
            </Text>
            <DevConnectionStatus />
          </View>
        )}

        <View style={{ height: spacing['2xl'] }} />
      </View>
    </ScrollView>
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
    flexShrink: 0,
  },
  profileText: {
    flex: 1,
    minWidth: 0,
    marginLeft: spacing.base,
  },
  loginLink: {
    minHeight: 48,
    justifyContent: 'center',
    alignSelf: 'flex-start',
  },
  contentArea: {
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    marginTop: -radius.xl,
  },
  scrollContent: {
    flexGrow: 1,
    paddingBottom: spacing.xl,
  },
  section: {
    marginTop: spacing.xl,
    paddingHorizontal: spacing.lg,
  },
  sectionTitle: {
    marginBottom: spacing.sm,
  },
  sectionHeading: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  sectionHeadingTitle: {
    flex: 1,
    minWidth: 0,
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
    flexShrink: 0,
  },
  menuContent: {
    flex: 1,
    minWidth: 0,
    gap: spacing.xs,
    marginLeft: spacing.md,
  },
  menuRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    flexShrink: 0,
  },
  badge: {
    minWidth: 22,
    minHeight: 22,
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
    borderRadius: radius.sm,
    alignSelf: 'flex-start',
    maxWidth: '100%',
  },
  valueChipText: {
    flexShrink: 1,
    minWidth: 0,
  },
});
