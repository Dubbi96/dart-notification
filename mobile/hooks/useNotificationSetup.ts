import { useEffect, useRef } from 'react';
import { Platform } from 'react-native';
import Constants, { ExecutionEnvironment } from 'expo-constants';
import { useQueryClient, onlineManager } from '@tanstack/react-query';
import { useRouter, type Href } from 'expo-router';
import { useAuthStore } from '@stores/authStore';
import {
  usePendingDeepLinkStore,
  shouldConsumePendingDeepLink,
} from '@stores/pendingDeepLinkStore';
import { deviceService } from '@services/device.service';
import { resolveDeepLink } from '@utils/deeplink';
import { REGISTER_BACKOFF_MS, shouldRetryOnReconnect } from '@utils/pushTokenRetry';

const PROJECT_ID = 'dbdd30ba-72aa-4f90-ae45-54aa8fd43aa7';

// DAR-430: Android 알림 채널(카테고리 3 버킷). 채널 ID 는 백엔드 Expo push channelId 와
// 정확히 일치해야 OS 가 채널별로 묶어 표시·누적·중요도를 분리한다(공시=기본·신호/체결=높음·소리).
// importanceKey 는 런타임에 Notifications.AndroidImportance[key] 로 해소(모듈 미평가 환경 회피).
const ANDROID_CHANNELS: ReadonlyArray<{
  id: string;
  name: string;
  importanceKey: 'HIGH' | 'DEFAULT';
}> = [
  { id: 'disclosure', name: '공시', importanceKey: 'DEFAULT' },
  { id: 'signal', name: '신호', importanceKey: 'HIGH' },
  { id: 'trade', name: '체결', importanceKey: 'HIGH' },
];

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
  const queryClient = useQueryClient();
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const onboardingCompleted = useAuthStore((s) => s.onboardingCompleted);
  const expoPushToken = useAuthStore((s) => s.expoPushToken);
  const setExpoPushToken = useAuthStore((s) => s.setExpoPushToken);
  const pendingDeepLink = usePendingDeepLinkStore((s) => s.pendingDeepLink);
  const setPendingDeepLink = usePendingDeepLinkStore((s) => s.setPendingDeepLink);
  const consumePendingDeepLink = usePendingDeepLinkStore((s) => s.consumePendingDeepLink);
  const coldStartHandled = useRef(false);
  // 이번 디바이스에 이미 등록 완료한 토큰(미등록=null). onlineManager 복구 콜백이 중복 등록을
  // 피하고, 콜드스타트 단절로 미등록이면 복구 후 재시도할지 판정하는 데 쓴다(DAR-225).
  const registeredTokenRef = useRef<string | null>(null);

  // DAR-430: Android 알림 채널(공시/신호/체결) 등록 — 앱 시작 시 1회. OS 가 채널별로 묶어
  // 표시·누적하고 중요도를 분리한다. iOS 는 채널 개념이 없어 no-op(채널은 push payload 의
  // channelId 가 무시됨) — 카테고리 구분은 인앱 아이콘·필터가 담당한다(크로스플랫폼 폴백).
  useEffect(() => {
    if (!Notifications || Platform.OS !== 'android') return;
    const N = Notifications;
    let cancelled = false;
    (async () => {
      try {
        for (const ch of ANDROID_CHANNELS) {
          if (cancelled) return;
          await N.setNotificationChannelAsync(ch.id, {
            name: ch.name,
            importance: N.AndroidImportance[ch.importanceKey],
            sound: 'default',
          });
        }
      } catch (err) {
        console.warn('Android 알림 채널 등록 실패:', err);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // 이미 권한이 있는 경우만 토큰 등록 (권한 요청은 온보딩에서 처리)
  // DAR-225: 콜드스타트시 네트워크가 잠깐 끊겨 1회 실패하면 deps=[isAuthenticated]만으론
  // 세션 내내 재실행되지 않아 디바이스가 영구 미등록(푸시 미수신)된다. 해결:
  //   (1) 등록 실패 시 백오프(REGISTER_BACKOFF_MS)로 1~2회 자동 재시도
  //   (2) onlineManager(NetInfo 연동, DAR-173) 복구 브로드캐스트 구독 → 미등록이면 재시도
  useEffect(() => {
    if (!isAuthenticated || !Notifications) return;
    const N = Notifications;

    let cancelled = false;
    let inFlight = false;
    const timers: ReturnType<typeof setTimeout>[] = [];

    // 1회 등록 시도. 성공/권한없음/이미등록이면 true(재시도 불필요), 네트워크 등 실패면 throw.
    async function attemptRegister(): Promise<boolean> {
      const { status } = await N.getPermissionsAsync();
      if (status !== 'granted') return true; // 권한 없음 — 재시도해도 의미 없음

      const tokenData = await N.getExpoPushTokenAsync({ projectId: PROJECT_ID });
      const token = tokenData.data;

      if (token === expoPushToken) {
        registeredTokenRef.current = token; // 이미 서버에 등록된 토큰
        return true;
      }

      const platform = Platform.OS === 'ios' ? 'ios' : 'android';
      await deviceService.register(token, platform);
      setExpoPushToken(token);
      registeredTokenRef.current = token;
      return true;
    }

    // 즉시 1회 + 실패 시 REGISTER_BACKOFF_MS 순서로 백오프 재시도. 동시 실행(중복 등록) 방지.
    async function registerWithBackoff() {
      if (inFlight || cancelled || registeredTokenRef.current) return;
      inFlight = true;
      try {
        for (let i = 0; i <= REGISTER_BACKOFF_MS.length; i += 1) {
          if (cancelled || registeredTokenRef.current) return;
          if (i > 0) {
            const delay = REGISTER_BACKOFF_MS[i - 1];
            await new Promise<void>((resolve) => {
              const t = setTimeout(resolve, delay);
              timers.push(t);
            });
            if (cancelled || registeredTokenRef.current) return;
          }
          try {
            if (await attemptRegister()) return; // 성공/권한없음/이미등록 — 종료
          } catch (err) {
            console.warn('푸시 토큰 등록 실패(재시도 예정):', err);
          }
        }
      } finally {
        inFlight = false;
      }
    }

    registerWithBackoff();

    // 네트워크 복구 시 아직 미등록이면 재시도(콜드스타트 단절 → 복구 자동 등록).
    const unsubscribe = onlineManager.subscribe((isOnline) => {
      if (shouldRetryOnReconnect(isOnline, registeredTokenRef.current)) {
        registerWithBackoff();
      }
    });

    return () => {
      cancelled = true;
      timers.forEach(clearTimeout);
      unsubscribe();
    };
  }, [isAuthenticated, expoPushToken, setExpoPushToken]);

  // DAR-216: 포그라운드 푸시 수신 시 미읽음 배지·목록을 즉시 갱신한다.
  // 배지는 React Query 단일원천(useUnreadCount/useNotifications)이므로, 수신 핸들러가
  // ['notifications'] 프리픽스를 invalidate 하면 어느 탭에 있든 탭 배지·홈 헤더 배지가 함께 갱신된다.
  useEffect(() => {
    if (!Notifications) return;
    const subscription = Notifications.addNotificationReceivedListener(() => {
      queryClient.invalidateQueries({ queryKey: ['notifications'] });
    });

    return () => subscription.remove();
  }, [queryClient]);

  // 알림 탭 → 범용 딥링크 라우팅 (앱 포그라운드/백그라운드 진입)
  // data.deepLink(화이트리스트 검증) 우선, 없으면 data.disclosureRcpNo 공시 폴백
  // 탭 진입은 읽음 상태/목록을 바꿀 수 있으므로 배지도 함께 무효화한다.
  useEffect(() => {
    if (!Notifications) return;
    const subscription = Notifications.addNotificationResponseReceivedListener(
      (response) => {
        queryClient.invalidateQueries({ queryKey: ['notifications'] });
        const data = response.notification.request.content.data;
        const target = resolveDeepLink(data);
        if (target) {
          router.push(target as Href);
        }
      },
    );

    return () => subscription.remove();
  }, [router, queryClient]);

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
