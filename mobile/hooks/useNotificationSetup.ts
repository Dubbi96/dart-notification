import { useEffect, useRef } from 'react';
import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import Constants from 'expo-constants';
import { useRouter } from 'expo-router';
import { useAuthStore } from '@stores/authStore';
import { deviceService } from '@services/device.service';

const PROJECT_ID = 'dbdd30ba-72aa-4f90-ae45-54aa8fd43aa7';
const isExpoGo = Constants.appOwnership === 'expo';

// Expo Go(안드로이드)는 SDK 53부터 expo-notifications 원격 푸시가 제거됨 → 호출 시 throw.
// 해당 환경에서는 알림 관련 호출을 전부 건너뛴다(앱 크래시 방지). 푸시는 Dev Build에서 동작.
const pushUnsupported = isExpoGo && Platform.OS === 'android';

if (!pushUnsupported) {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowAlert: true,
      shouldPlaySound: true,
      shouldSetBadge: true,
      shouldShowBanner: true,
      shouldShowList: true,
    }),
  });
}

export function useNotificationSetup() {
  const router = useRouter();
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const expoPushToken = useAuthStore((s) => s.expoPushToken);
  const setExpoPushToken = useAuthStore((s) => s.setExpoPushToken);
  const coldStartHandled = useRef(false);

  // 이미 권한이 있는 경우만 토큰 등록 (권한 요청은 온보딩에서 처리)
  // Expo Go + Android에서는 SDK 53부터 푸시 알림 미지원
  useEffect(() => {
    if (!isAuthenticated) return;
    if (pushUnsupported) return;

    async function registerTokenIfPermitted() {
      const { status } = await Notifications.getPermissionsAsync();
      if (status !== 'granted') return;

      try {
        const tokenData = await Notifications.getExpoPushTokenAsync({ projectId: PROJECT_ID });
        const token = tokenData.data;

        if (token === expoPushToken) return;

        const platform = Platform.OS === 'ios' ? 'ios' : 'android';
        await deviceService.register(token, platform);
        setExpoPushToken(token);
      } catch (err) {
        console.warn('푸시 토큰 등록 실패:', err);
      }
    }

    registerTokenIfPermitted();
  }, [isAuthenticated]);

  // 알림 탭 → 공시 상세 이동 (앱 실행 중)
  useEffect(() => {
    if (pushUnsupported) return;
    const subscription = Notifications.addNotificationResponseReceivedListener((response) => {
      const data = response.notification.request.content.data;
      if (data?.disclosureRcpNo) {
        router.push(`/disclosure/${data.disclosureRcpNo}`);
      }
    });

    return () => subscription.remove();
  }, [router]);

  // 콜드스타트: 앱 종료 상태에서 알림 탭으로 열린 경우
  useEffect(() => {
    if (pushUnsupported) return;
    if (coldStartHandled.current) return;

    async function handleColdStart() {
      const response = await Notifications.getLastNotificationResponseAsync();
      if (response) {
        coldStartHandled.current = true;
        const data = response.notification.request.content.data;
        if (data?.disclosureRcpNo) {
          setTimeout(() => router.push(`/disclosure/${data.disclosureRcpNo}`), 500);
        }
      }
    }

    handleColdStart();
  }, [router]);
}
