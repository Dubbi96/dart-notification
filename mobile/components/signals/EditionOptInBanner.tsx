import React, { useCallback } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '@theme';
import { spacing, radius, sizing } from '@theme/spacing';
import { Button } from '@components/common/Button';
import { useDialog } from '@components/common/DialogProvider';
import { useEditionOptInBanner } from '@hooks/useEditionOptInBanner';
import {
  useNotificationSettings,
  useUpdateNotificationSettings,
} from '@hooks/useNotificationSettings';
import { EDITION_OPT_IN_BANNER, shouldShowEditionOptInBanner } from '@utils/editionOptInBanner';

// DAR-547: 신호탭 에디션 뷰 상단 '에디션 알림 옵트인' 배너.
// 에디션 푸시(DAR-523)는 기본 OFF 옵트인 — 발견성 0 방지가 목적. '알림 받기' 1탭으로
// editionPushEnabled=true 를 인라인 저장(useUpdateNotificationSettings)하고, 켠 뒤엔 dismiss 를
// 영속해 재노출하지 않는다(재강요 금지). 이미 ON 이거나 닫은 뒤엔 미노출(shouldShow… SSOT).
// 카드 톤·닫기 44pt hitSlop 은 SignalsCoachmark 패턴 재사용(동일 토큰·지오메트리).

// 닫기 터치 영역: 아이콘 md(18) + hitSlop 13*2 = 44pt(sizing.minTouchTarget) 보장.
const CLOSE_HIT_SLOP_INSET = (sizing.minTouchTarget - sizing.icon.md) / 2;
const CLOSE_HIT_SLOP = {
  top: CLOSE_HIT_SLOP_INSET,
  bottom: CLOSE_HIT_SLOP_INSET,
  left: CLOSE_HIT_SLOP_INSET,
  right: CLOSE_HIT_SLOP_INSET,
};

function EditionOptInBannerBase() {
  const { colors, typography: typo } = useTheme();
  const { showDialog } = useDialog();
  const { dismissed, dismiss } = useEditionOptInBanner();
  // BuyEditionView(인증 상태에서만 마운트)가 이미 조회 중 — 동일 queryKey 로 중복 없이 공유.
  const { data: settings, isSuccess } = useNotificationSettings();
  const updateSettings = useUpdateNotificationSettings();

  // '알림 받기' — 에디션 푸시 계열만 인라인 ON(1탭). 성공 시 확인 + 배너 영구 숨김(재강요 금지).
  const handleEnable = useCallback(() => {
    updateSettings.mutate(
      { editionPushEnabled: true },
      {
        onSuccess: () => {
          dismiss();
          showDialog({
            title: EDITION_OPT_IN_BANNER.confirmTitle,
            message: EDITION_OPT_IN_BANNER.confirmMessage,
            icon: { name: 'check-circle' },
          });
        },
        onError: () => {
          showDialog({
            title: EDITION_OPT_IN_BANNER.errorTitle,
            message: EDITION_OPT_IN_BANNER.errorMessage,
            icon: { name: 'alert-circle', color: colors.error },
          });
        },
      },
    );
  }, [updateSettings, dismiss, showDialog, colors.error]);

  const show = shouldShowEditionOptInBanner({
    dismissed,
    settingsLoaded: isSuccess,
    editionPushEnabled: settings?.editionPushEnabled === true,
  });
  if (!show) return null;

  return (
    <View style={[styles.card, { backgroundColor: colors.primaryLight, borderColor: colors.primary }]}>
      {/* 스크린리더 순서: 제목(header) → 설명 → CTA → 닫기(트리 마지막, 시각은 우상단 고정). */}
      <View style={styles.titleGroup}>
        <Feather name="bell" size={sizing.icon.md} color={colors.primary} />
        <Text
          accessibilityRole="header"
          style={[typo.captionMedium, { color: colors.primary, marginLeft: spacing.sm, flex: 1 }]}
        >
          {EDITION_OPT_IN_BANNER.title}
        </Text>
      </View>

      <Text style={[typo.caption, { color: colors.text, marginTop: spacing.sm }]}>
        {EDITION_OPT_IN_BANNER.description}
      </Text>

      <Button
        title={EDITION_OPT_IN_BANNER.enableLabel}
        onPress={handleEnable}
        variant="primary"
        size="sm"
        loading={updateSettings.isPending}
        disabled={updateSettings.isPending}
        style={styles.cta}
      />

      <TouchableOpacity
        style={styles.close}
        onPress={dismiss}
        hitSlop={CLOSE_HIT_SLOP}
        accessibilityRole="button"
        accessibilityLabel={EDITION_OPT_IN_BANNER.dismissA11yLabel}
      >
        <Feather name="x" size={sizing.icon.md} color={colors.primary} />
      </TouchableOpacity>
    </View>
  );
}

export const EditionOptInBanner = React.memo(EditionOptInBannerBase);

const styles = StyleSheet.create({
  // SignalsCoachmark 카드 스타일 재사용(동일 토큰) — 에디션 스트립 위 정적 장착.
  card: {
    borderRadius: radius.lg,
    borderWidth: 1,
    padding: spacing.base,
    marginHorizontal: spacing.lg,
    marginTop: spacing.md,
  },
  titleGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    // 우상단 고정 닫기 아이콘과 제목이 겹치지 않도록 여백 확보.
    paddingRight: spacing.xl,
  },
  cta: {
    alignSelf: 'flex-start',
    marginTop: spacing.md,
  },
  close: {
    position: 'absolute',
    top: spacing.base,
    right: spacing.base,
  },
});
