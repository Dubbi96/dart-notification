import { useEffect, useRef } from 'react';
import { Platform } from 'react-native';
import Constants, { ExecutionEnvironment } from 'expo-constants';
import { useRouter, type Href } from 'expo-router';
import { useAuthStore } from '@stores/authStore';
import { deviceService } from '@services/device.service';
import { resolveDeepLink } from '@utils/deeplink';

const PROJECT_ID = 'dbdd30ba-72aa-4f90-ae45-54aa8fd43aa7';

// Expo Go(안드로이드)는 SDK 53부터 expo-notifications 가 **import(모듈 평가) 시점에 throw**한다.
// 따라서 정적 import 하지 말고, 지원 환경에서만 조건부 require 로 모듈을 불러온다.
// (Metro require 는 호출 시점에만 모듈을 평가하므로, 미지원 환경에선 아예 평가되지 않아 throw 회피)
const isExpoGo =
  Constants.executionEnvironment === ExecutionEnvironment.StoreClient;
const pushUnsupported = isExpoGo && Platform.OS === 'android';

type NotificationsModule = typeof import('expo-notifications');
let Notifications: NotificationsModule | null = null;

if (!pushUnsupported) {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    Notifications = require('expo-notifications') as NotificationsModule;
    Notifications.setNotificationHandler({
      handleNotification: async () => ({
        shouldShowAlert: true,
        shouldPlaySound: true,
        shouldSetBadge: true,
        shouldShowBanner: true,
        shouldShowList: true,
      }),
    });
  } catch {
    // 미지원 환경(Expo Go 안드로이드 등) — 알림 비활성화
    Notifications = null;
  }
}

export function useNotificationSetup() {
  const router = useRouter();
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const expoPushToken = useAuthStore((s) => s.expoPushToken);
  const setExpoPushToken = useAuthStore((s) => s.setExpoPushToken);
  const coldStartHandled = useRef(false);

  // 이미 권한이 있는 경우만 토큰 등록 (권한 요청은 온보딩에서 처리)
  useEffect(() => {
    if (!isAuthenticated || !Notifications) return;
    const N = Notifications;

    async function registerTokenIfPermitted() {
      const { status } = await N.getPermissionsAsync();
      if (status !== 'granted') return;

      try {
        const tokenData = await N.getExpoPushTokenAsync({ projectId: PROJECT_ID });
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

  // 알림 탭 → 범용 딥링크 라우팅 (앱 포그라운드/백그라운드 진입)
  // data.deepLink(화이트리스트 검증) 우선, 없으면 data.disclosureRcpNo 공시 폴백
  useEffect(() => {
    if (!Notifications) return;
    const subscription = Notifications.addNotificationResponseReceivedListener(
      (response) => {
        const data = response.notification.request.content.data;
        const target = resolveDeepLink(data);
        if (target) {
          router.push(target as Href);
        }
      },
    );

    return () => subscription.remove();
  }, [router]);

  // 콜드스타트: 앱 종료 상태에서 알림 탭으로 열린 경우
  useEffect(() => {
    if (!Notifications || coldStartHandled.current) return;
    const N = Notifications;

    async function handleColdStart() {
      const response = await N.getLastNotificationResponseAsync();
      if (response) {
        coldStartHandled.current = true;
        const data = response.notification.request.content.data;
        const target = resolveDeepLink(data);
        if (target) {
          setTimeout(() => router.push(target as Href), 500);
        }
      }
    }

    handleColdStart();
  }, [router]);
}
