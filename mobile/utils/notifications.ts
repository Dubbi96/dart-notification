import { Platform } from 'react-native';
import Constants, { ExecutionEnvironment } from 'expo-constants';

/**
 * expo-notifications 안전 접근 헬퍼.
 *
 * SDK 53+ 부터 Expo Go(안드로이드)에서는 expo-notifications 가 **import(모듈 평가) 시점에 throw** 한다.
 * 따라서 어디서도 `import * as Notifications from 'expo-notifications'` 를 정적으로 하지 말고,
 * 반드시 이 헬퍼의 getNotifications() 로 접근한다. (Metro require 는 호출 시점에만 평가 → 미지원 환경에선 평가 자체를 건너뜀)
 */
const isExpoGo =
  Constants.executionEnvironment === ExecutionEnvironment.StoreClient;

/** Expo Go 안드로이드는 원격 푸시 미지원 → false */
export const pushSupported = !(isExpoGo && Platform.OS === 'android');

type NotificationsModule = typeof import('expo-notifications');
let cached: NotificationsModule | null | undefined;

/** 지원 환경에서만 expo-notifications 모듈을 반환, 아니면 null */
export function getNotifications(): NotificationsModule | null {
  if (cached !== undefined) return cached;
  if (!pushSupported) {
    cached = null;
    return null;
  }
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    cached = require('expo-notifications') as NotificationsModule;
  } catch {
    cached = null;
  }
  return cached;
}
