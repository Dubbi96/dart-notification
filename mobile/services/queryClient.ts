import { QueryClient } from '@tanstack/react-query';

// 앱 전역 단일 QueryClient(SSOT). React 트리(`app/_layout.tsx`)의 QueryClientProvider 뿐 아니라
// axios 인터셉터(`services/api.ts`)·인증 스토어(`stores/authStore.ts`) 등 React 밖 모듈에서도
// 동일 캐시를 제어하기 위해 모듈 스코프로 노출한다. 인증 상태 전환 시 이전 세션 캐시를 비우는
// 보안 요구(DAR-262: 계정 전환 시 이전 유저 데이터 교차 노출 차단)의 전제.
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 2,
      staleTime: 1000 * 60 * 5, // 5 minutes
    },
  },
});
