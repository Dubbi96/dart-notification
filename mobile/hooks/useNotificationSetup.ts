import { useEffect, useRef } from 'react';
import { Platform } from 'react-native';
import Constants, { ExecutionEnvironment } from 'expo-constants';
import { useRouter, type Href } from 'expo-router';
import { useAuthStore } from '@stores/authStore';
import {
  usePendingDeepLinkStore,
  shouldConsumePendingDeepLink,
} from '@stores/pendingDeepLinkStore';
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
  const onboardingCompleted = useAuthStore((s) => s.onboardingCompleted);
  const expoPushToken = useAuthStore((s) => s.expoPushToken);
  const setExpoPushToken = useAuthStore((s) => s.setExpoPushToken);
  const pendingDeepLink = usePendingDeepLinkStore((s) => s.pendingDeepLink);
  const setPendingDeepLink = usePendingDeepLinkStore((s) => s.setPendingDeepLink);
  const consumePendingDeepLink = usePendingDeepLinkStore((s) => s.consumePendingDeepLink);
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

  // 콜드스타트: 앱 종료 상태에서 알림 탭으로 열린 경우 (DAR-154)
  // 즉시 push 하지 않는다 — 인증/하이드레이션/온보딩 게이트와 경쟁하면 비로그인 상태로
  // 대상에 진입(401)하거나 게이트 리다이렉트에 push 가 덮여 사라진다. 대신 보류 대상으로
  // 저장하고, 게이트 통과(인증+온보딩 완료) 후 아래 소비 effect 가 한 번만 push 한다.
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
          setPendingDeepLink(target);
        }
      }
    }

    handleColdStart();
  }, [setPendingDeepLink]);

  // 보류된 콜드스타트 딥링크 소비 (DAR-154)
  // app/index.tsx 인증 게이트의 '홈 진입' 조건(인증+온보딩 완료)과 1:1 일치하는 시점에만
  // push 한다. 비로그인·온보딩 미완이면 보류를 유지 → 로그인/온보딩 완료 후 자연히 소비.
  // 고정 지연(500ms) 없이 상태 변화로 트리거되며, consume 가 보류를 비우므로 1회만 실행된다.
  useEffect(() => {
    if (
      !shouldConsumePendingDeepLink({
        pendingDeepLink,
        isAuthenticated,
        onboardingCompleted,
      })
    ) {
      return;
    }
    const target = consumePendingDeepLink();
    if (target) {
      router.push(target as Href);
    }
  }, [
    pendingDeepLink,
    isAuthenticated,
    onboardingCompleted,
    router,
    consumePendingDeepLink,
  ]);
}
