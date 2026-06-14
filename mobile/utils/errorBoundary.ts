// DAR-224: Expo Router ErrorBoundary 폴백 UI의 순수 로직(테마/카피).
// 컴포넌트(ErrorFallback.tsx)는 RN 의존이라 노드에서 직접 검증이 어려우므로,
// 테마 선택과 표시 카피를 RN-비의존 순수 모듈로 분리해 결정론적 체크가 가능하게 한다.

import type { ColorScheme } from '@theme';

// 폴백은 ThemeContext.Provider 바깥(루트 레이아웃 자체가 throw)에서도 렌더되므로
// context 대신 시스템 컬러스킴을 'light' | 'dark' 로 정규화한다.
// RN useColorScheme 은 'light' | 'dark' | 'unspecified' | null | undefined 를 반환 →
// 'dark' 만 dark, 그 외 미확정값은 모두 라이트로 폴백.
export function resolveFallbackScheme(scheme: string | null | undefined): ColorScheme {
  return scheme === 'dark' ? 'dark' : 'light';
}

// 폴백 화면 표시 카피(한국어). 시각 텍스트=낭독 텍스트 단일 출처.
export const ERROR_FALLBACK_COPY = {
  title: '화면을 표시하지 못했습니다',
  description: '예기치 못한 오류가 발생했어요. 다시 시도해 주세요.',
  retry: '다시 시도',
} as const;
