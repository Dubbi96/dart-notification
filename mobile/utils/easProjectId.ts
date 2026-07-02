// UXR-1/A-1: EAS projectId 동적 해소 단일원천.
// 푸시 토큰은 빌드된 EAS 프로젝트와 같은 projectId 로 발급해야 한다 — app.json(extra.eas.projectId)
// 에서 동적으로 읽어 프로젝트 재링크/소유자 변경에 자동 추종하고(DAR-447), 온보딩·useNotificationSetup
// 등 모든 발급 지점이 이 값 하나를 공유해 프로젝트 불일치(무효/혼재 토큰 등록)를 방지한다.

import Constants from 'expo-constants';

/** 빌드 설정에서 projectId 를 읽지 못한 경우의 최후 폴백(@duvbi/dart-alert). */
const FALLBACK_EAS_PROJECT_ID = '2807bcb5-05c4-479f-b3be-2b40686cc7ed';

/** 푸시 토큰 발급(getExpoPushTokenAsync)에 사용할 EAS projectId. */
export const EAS_PROJECT_ID: string =
  (Constants.expoConfig?.extra?.eas?.projectId as string | undefined) ??
  Constants.easConfig?.projectId ??
  FALLBACK_EAS_PROJECT_ID;
