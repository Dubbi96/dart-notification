import React, { useCallback } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '@theme';
import { spacing, radius, sizing } from '@theme/spacing';
import { Button } from '@components/common/Button';
import { HelpButton } from '@components/common/HelpButton';
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
// 닫기는 실측 가능한 48dp 영역을 쓰며 제목의 우측 여백과 겹치지 않는다.

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
    <View
      style={[styles.card, { backgroundColor: colors.primaryLight, borderColor: colors.primary }]}
    >
      {/* 제목 → 알림 받기 → 설명 보기 → 닫기. 긴 설명은 요청할 때만 연다. */}
      <View style={styles.titleGroup}>
        <Feather name="bell" size={sizing.icon.md} color={colors.primaryDark} />
        <Text
          accessibilityRole="header"
          style={[typo.bodyMedium, styles.titleText, { color: colors.primaryDark }]}
        >
          {EDITION_OPT_IN_BANNER.title}
        </Text>
      </View>

      <View style={styles.actions}>
        <Button
          title={EDITION_OPT_IN_BANNER.enableLabel}
          onPress={handleEnable}
          variant="primary"
          size="sm"
          loading={updateSettings.isPending}
          disabled={updateSettings.isPending}
        />
        <HelpButton
          title="판단 알림"
          sections={[
            { heading: '알림 내용', body: EDITION_OPT_IN_BANNER.description },
            {
              heading: '발송 시각',
              body: '평일 저녁 7시 이후, 발행할 판단이 있는 날 알림을 보냅니다.',
            },
          ]}
        />
      </View>

      <TouchableOpacity
        style={styles.close}
        onPress={dismiss}
        accessibilityRole="button"
        accessibilityLabel={EDITION_OPT_IN_BANNER.dismissA11yLabel}
      >
        <Feather name="x" size={sizing.icon.md} color={colors.primaryDark} />
      </TouchableOpacity>
    </View>
  );
}

export const EditionOptInBanner = React.memo(EditionOptInBannerBase);

const styles = StyleSheet.create({
  // 목록의 스크롤 헤더가 외부 여백을 담당한다.
  card: {
    borderRadius: radius.lg,
    borderWidth: 1,
    padding: spacing.base,
  },
  titleGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    // 우상단 고정 닫기 아이콘과 제목이 겹치지 않도록 여백 확보.
    paddingRight: 48,
    minHeight: 48,
  },
  titleText: {
    flex: 1,
    minWidth: 0,
    marginLeft: spacing.sm,
  },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  close: {
    position: 'absolute',
    top: spacing.xs,
    right: spacing.xs,
    width: 48,
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
