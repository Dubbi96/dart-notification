import { useCallback } from 'react';
import { useNetworkStatus } from '@hooks/useNetworkStatus';
import { useSnackbar } from '@components/common/SnackbarProvider';
import {
  OFFLINE_MUTATION_NOTICE,
  OFFLINE_MUTATION_NOTICE_DURATION,
  OfflineMutationBlockedError,
  shouldBlockMutation,
} from '@utils/offlineMutation';

import type { UseMutationResult } from '@tanstack/react-query';

// DAR-226: 오프라인일 때 쓰기(mutation)를 낙관적 업데이트 전에 차단하는 공통 가드.
// React Query 의 paused mutation 유실로 인한 '조용한 롤백'을 근본 차단하기 위해, 오프라인이면
// 원본 mutate/mutateAsync 를 호출하지 않고(=onMutate 미실행=낙관적 변경 없음) 평문 스낵바만 띄운다.
// 온라인 경로는 원본 그대로 통과(낙관적 업데이트·onError 롤백·onSettled invalidate 무손상).
// mutateAsync 는 센티넬 에러로 reject 해 await 소비처가 멈추지 않게 하고, 소비처는 센티넬을 구분해
// 일반 '실패' 메시지로 차단 안내를 덮지 않는다(isOfflineMutationBlockedError).
export function useGuardedMutation<TData, TError, TVariables, TContext>(
  mutation: UseMutationResult<TData, TError, TVariables, TContext>,
): UseMutationResult<TData, TError, TVariables, TContext> {
  const { isOffline } = useNetworkStatus();
  const { showSnackbar } = useSnackbar();
  const blocked = shouldBlockMutation(isOffline);

  const notify = useCallback(() => {
    showSnackbar(OFFLINE_MUTATION_NOTICE, { duration: OFFLINE_MUTATION_NOTICE_DURATION });
  }, [showSnackbar]);

  const { mutate: originalMutate, mutateAsync: originalMutateAsync } = mutation;

  const mutate = useCallback<typeof originalMutate>(
    (variables, options) => {
      if (blocked) {
        notify();
        return;
      }
      return originalMutate(variables, options);
    },
    [blocked, notify, originalMutate],
  );

  const mutateAsync = useCallback<typeof originalMutateAsync>(
    (variables, options) => {
      if (blocked) {
        notify();
        return Promise.reject(new OfflineMutationBlockedError());
      }
      return originalMutateAsync(variables, options);
    },
    [blocked, notify, originalMutateAsync],
  );

  return { ...mutation, mutate, mutateAsync };
}
