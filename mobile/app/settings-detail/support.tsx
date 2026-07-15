import React, { useCallback } from 'react';
import { View, Text, ScrollView, StyleSheet, TouchableOpacity, Linking } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Constants from 'expo-constants';
import { Feather } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useTheme } from '@theme';
import { spacing, radius } from '@theme/spacing';
import { ScreenHeader } from '@components/common/ScreenHeader';
import { useSnackbar } from '@components/common/SnackbarProvider';
import { API_BASE_URL } from '@services/api';
import { APP_BRAND_NAME } from '@utils/copy';

// [W11] 문의·지원 화면 — 앱 내 문의 표면 신설(운영 확장성 갭: 문의 채널 전무 해소).
// 구성: 이메일 문의(mailto) · 공개 시스템 상태 페이지(외부 브라우저) · 버전 정보.
// read-only + OS 링크만 사용(신규 API 호출 없음). 테마 토큰만, 하드코딩 색상 0.

// 문의 수신 메일 — 운영자 단일 채널(1인 운영 전제, CS 채널 SSOT).
const SUPPORT_EMAIL = 'yrs03001@hanyang.ac.kr';
// 공개 시스템 상태 페이지 — 백엔드 비인증 GET /status (글로벌 prefix 밖).
// API_BASE_URL('https://host/api')에서 '/api' 접미사만 걷어내 origin 을 얻는다.
const STATUS_PAGE_URL = `${API_BASE_URL.replace(/\/api\/?$/, '')}/status`;
// 앱 버전 — app.json(version) 주입값. 설정 화면 '앱 정보'와 동일 소스.
const APP_VERSION = Constants.expoConfig?.version ?? '1.0.0';

interface SupportRowProps {
  icon: keyof typeof Feather.glyphMap;
  title: string;
  subtitle?: string;
  onPress?: () => void;
  /** 외부로 나가는 링크 행 — 우측 external-link 아이콘으로 표시. */
  isExternal?: boolean;
  /** 정보 표시 전용 행(버전 등) — 비터치 View 렌더(dead tap 제거, 설정 D9 패턴). */
  nonInteractive?: boolean;
  isLast?: boolean;
}

function SupportRow({
  icon,
  title,
  subtitle,
  onPress,
  isExternal = false,
  nonInteractive = false,
  isLast = false,
}: SupportRowProps) {
  const { colors, typography: typo } = useTheme();

  const a11yLabel = [title, subtitle].filter(Boolean).join(', ');
  const body = (
    <>
      <View style={[styles.rowIcon, { backgroundColor: colors.primaryLight }]}>
        <Feather name={icon} size={18} color={colors.primary} />
      </View>
      <View style={styles.rowContent}>
        <Text style={[typo.bodyMedium, { color: colors.text }]}>{title}</Text>
        {subtitle && (
          <Text style={[typo.small, styles.rowSubtitle, { color: colors.textSecondary }]}>
            {subtitle}
          </Text>
        )}
      </View>
      {!nonInteractive && (
        <Feather
          name={isExternal ? 'external-link' : 'chevron-right'}
          size={18}
          color={colors.textTertiary}
        />
      )}
    </>
  );

  const borderStyle = {
    borderBottomColor: colors.borderLight,
    borderBottomWidth: isLast ? 0 : StyleSheet.hairlineWidth,
  };

  if (nonInteractive) {
    return (
      <View style={[styles.row, borderStyle]} accessible accessibilityLabel={a11yLabel}>
        {body}
      </View>
    );
  }

  return (
    <TouchableOpacity
      style={[styles.row, borderStyle]}
      onPress={onPress}
      activeOpacity={0.7}
      accessibilityRole={isExternal ? 'link' : 'button'}
      accessibilityLabel={a11yLabel}
      accessibilityHint={isExternal ? '외부 앱 또는 브라우저가 열립니다' : undefined}
    >
      {body}
    </TouchableOpacity>
  );
}

export default function SupportScreen() {
  const { colors, typography: typo } = useTheme();
  const { showSnackbar } = useSnackbar();

  const handleEmail = useCallback(async () => {
    const subject = encodeURIComponent(`[${APP_BRAND_NAME}] 문의`);
    const body = encodeURIComponent(`앱 버전: v${APP_VERSION}\n\n문의 내용:\n`);
    try {
      await Linking.openURL(`mailto:${SUPPORT_EMAIL}?subject=${subject}&body=${body}`);
    } catch {
      // 메일 앱 미설치(에뮬레이터 등) — 주소를 안내해 수동 문의 동선 유지.
      showSnackbar(`메일 앱을 열 수 없습니다. ${SUPPORT_EMAIL} 로 문의해 주세요.`);
    }
  }, [showSnackbar]);

  const handleStatusPage = useCallback(async () => {
    try {
      await Linking.openURL(STATUS_PAGE_URL);
    } catch {
      showSnackbar('브라우저를 열 수 없습니다. 잠시 후 다시 시도해 주세요.');
    }
  }, [showSnackbar]);

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={['top']}>
      <ScreenHeader title="문의·지원" onBack={() => router.back()} />

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Text style={[typo.caption, styles.sectionLead, { color: colors.textSecondary }]}>
          이용 중 불편이나 궁금한 점이 있으면 이메일로 문의해 주세요. 서비스 가동 상태는
          시스템 상태 페이지에서 언제든 확인할 수 있습니다.
        </Text>

        <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <SupportRow
            icon="mail"
            title="이메일 문의"
            subtitle={SUPPORT_EMAIL}
            onPress={handleEmail}
            isExternal
          />
          <SupportRow
            icon="activity"
            title="시스템 상태"
            subtitle="공시 수집·배치 가동 현황 (외부 브라우저)"
            onPress={handleStatusPage}
            isExternal
          />
          <SupportRow
            icon="info"
            title="버전 정보"
            subtitle={`v${APP_VERSION}`}
            nonInteractive
            isLast
          />
        </View>

        <View style={[styles.noticeRow, { backgroundColor: colors.surfaceSecondary }]}>
          <Feather name="clock" size={16} color={colors.textSecondary} />
          <Text style={[typo.small, styles.noticeText, { color: colors.textSecondary }]}>
            문의는 확인 순서대로 답변드리며, 다소 시간이 걸릴 수 있습니다.
          </Text>
        </View>

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
  sectionLead: {
    marginBottom: spacing.md,
  },
  card: {
    borderRadius: radius.lg,
    borderWidth: 1,
    paddingHorizontal: spacing.base,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.base,
    minHeight: 56,
  },
  rowIcon: {
    width: 36,
    height: 36,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.md,
  },
  rowContent: {
    flex: 1,
  },
  rowSubtitle: {
    marginTop: spacing.xs,
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
});
