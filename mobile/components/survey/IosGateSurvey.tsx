import React, { useCallback, useEffect, useState } from 'react';
import { Platform, StyleSheet } from 'react-native';
import { Dialog, Portal, Button, Text } from 'react-native-paper';
import * as SecureStore from 'expo-secure-store';
import { useTheme } from '@theme';
import { spacing, radius } from '@theme/spacing';
import { useAuthStore } from '@stores/authStore';
import { recordTesterEvent } from '@services/testerEvents.service';

/**
 * IosGateSurvey — iOS 게이트 1문항 설문 (DAR-516, Wave A/A6 수용기준: iOS 1문항 설문).
 *
 * 테스터 코호트는 Play(안드로이드) 12인이다. iOS 는 아직 배포 대상이 아니므로 iOS 사용자에게는
 * 앱 대신(정확히는 앱 진입 후 1회) '정식 출시되면 쓰실래요?' 1문항 설문 게이트를 띄운다.
 * 응답은 이벤트명으로만 기록(survey_ios_answer_yes/no) — 자유텍스트·PII 미수집(수용기준 1).
 *
 * ★표시 조건: iOS + 인증 사용자 + 미응답(SecureStore 플래그). 설문 노출 시 survey_ios_shown 기록.
 * ★한 번만: 응답/닫기 후 플래그 영속 → 재노출 금지(계측 전용 — 앱 흐름 비간섭).
 * ★안드로이드/게스트에서는 아무것도 렌더하지 않는다(null).
 */

/** 설문 응답/닫기 영속 플래그(SecureStore). 값 존재 = 이미 처리됨. v1 = 문항 버전. */
const IOS_SURVEY_SEEN_KEY = 'tester.survey.ios.v1';

export function IosGateSurvey() {
  const { colors, typography: typo } = useTheme();
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    // 안드로이드/게스트는 대상 아님 — 조회조차 하지 않는다.
    if (Platform.OS !== 'ios' || !isAuthenticated) return;
    let cancelled = false;
    (async () => {
      try {
        const seen = await SecureStore.getItemAsync(IOS_SURVEY_SEEN_KEY);
        if (cancelled || seen) return;
        setVisible(true);
        void recordTesterEvent('survey_ios_shown');
      } catch {
        // SecureStore 오류는 무시 — 설문 미노출(계측 손실만, 앱 흐름 무영향).
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isAuthenticated]);

  const persistSeen = useCallback(async () => {
    try {
      await SecureStore.setItemAsync(IOS_SURVEY_SEEN_KEY, '1');
    } catch {
      // 영속 실패는 무시(다음 실행에 재노출될 수 있으나 무해).
    }
  }, []);

  const answer = useCallback(
    (interested: boolean) => {
      setVisible(false);
      void recordTesterEvent(interested ? 'survey_ios_answer_yes' : 'survey_ios_answer_no');
      void persistSeen();
    },
    [persistSeen],
  );

  // 바깥 탭으로 닫기 = 무응답 스킵. 응답 이벤트는 없지만 재노출 방지 플래그는 남긴다.
  const dismiss = useCallback(() => {
    setVisible(false);
    void persistSeen();
  }, [persistSeen]);

  if (Platform.OS !== 'ios') return null;

  return (
    <Portal>
      <Dialog
        visible={visible}
        onDismiss={dismiss}
        style={[styles.dialog, { backgroundColor: colors.surface }]}
      >
        <Dialog.Title style={[typo.h3, { color: colors.text }]}>iOS 출시 관심 조사</Dialog.Title>
        <Dialog.Content>
          <Text style={[typo.body, { color: colors.textSecondary }]}>
            지금은 안드로이드에서 먼저 테스트 중이에요. iOS 정식 버전이 나오면 사용해 보시겠어요?
          </Text>
        </Dialog.Content>
        <Dialog.Actions style={styles.actions}>
          <Button
            onPress={() => answer(false)}
            textColor={colors.textSecondary}
            accessibilityLabel="지금은 관심 없음"
          >
            지금은 아니에요
          </Button>
          <Button
            mode="contained"
            onPress={() => answer(true)}
            accessibilityLabel="iOS 출시에 관심 있음"
          >
            네, 관심 있어요
          </Button>
        </Dialog.Actions>
      </Dialog>
    </Portal>
  );
}

const styles = StyleSheet.create({
  dialog: {
    borderRadius: radius.lg,
  },
  actions: {
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.sm,
    gap: spacing.sm,
  },
});
