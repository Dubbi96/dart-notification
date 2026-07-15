import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { proWaitlistService } from '@services/pro-waitlist.service';
import { useGuardedMutation } from '@hooks/useGuardedMutation';

import type { ProWaitlistStatus } from '@app-types/user.types';

export const PRO_WAITLIST_KEY = ['proWaitlist'] as const;

/**
 * Pro 출시 알림 사전신청 상태(갭분석 W1) — 서버가 정본.
 * 결제 준비 전까지 변할 일이 거의 없는 데이터라 staleTime 을 넉넉히 둔다.
 */
export function useProWaitlistStatus(options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: PRO_WAITLIST_KEY,
    queryFn: proWaitlistService.getStatus,
    enabled: options?.enabled ?? true,
    staleTime: 5 * 60 * 1000,
  });
}

/**
 * 사전신청 토글(신청 true / 철회 false).
 * 기존 로컬 토글 UX(즉시 반영)를 유지하기 위해 onMutate 에서 캐시를 낙관적으로
 * 갱신하고, 실패 시 롤백한다. 로컬 상태(Zustand)는 더 이상 정본이 아니며
 * React Query 캐시만 낙관적 사본으로 쓴다. DAR-226 오프라인 가드 적용 —
 * paused mutation 유실로 인한 '조용한 롤백'을 차단한다.
 */
export function useToggleProWaitlist() {
  const queryClient = useQueryClient();
  return useGuardedMutation(
    useMutation({
      mutationFn: (optIn: boolean) =>
        optIn ? proWaitlistService.join() : proWaitlistService.withdraw(),
      onMutate: async (optIn: boolean) => {
        await queryClient.cancelQueries({ queryKey: PRO_WAITLIST_KEY });
        const prev = queryClient.getQueryData<ProWaitlistStatus>(PRO_WAITLIST_KEY);
        queryClient.setQueryData<ProWaitlistStatus>(PRO_WAITLIST_KEY, {
          optedIn: optIn,
          createdAt: optIn ? prev?.createdAt ?? new Date().toISOString() : null,
        });
        return { prev };
      },
      onError: (_error, _optIn, context) => {
        if (context?.prev !== undefined) {
          queryClient.setQueryData(PRO_WAITLIST_KEY, context.prev);
        }
      },
      onSettled: () =>
        queryClient.invalidateQueries({ queryKey: PRO_WAITLIST_KEY }),
    }),
  );
}
