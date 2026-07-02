import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { savedDisclosureService } from '@services/saved-disclosure.service';
import { useGuardedMutation } from '@hooks/useGuardedMutation';

import type { SavedDisclosure } from '@services/saved-disclosure.service';
import type { PaginationMeta } from '@app-types/api.types';

// 화면(목록·실행 취소)이 항목 타입을 훅 레이어 경유로 쓰도록 재노출.
export type { SavedDisclosure };

export const SAVED_DISCLOSURES_KEY = ['saved-disclosures'] as const;

interface SavedDisclosuresCache {
  data: SavedDisclosure[];
  meta?: PaginationMeta;
}

/**
 * 저장 변수 — rcpNo 문자열만 넘기면 기존 동작(상세 화면 토글),
 * 목록 문맥('실행 취소')에서는 항목을 함께 넘겨 목록에 낙관적 복원한다.
 */
export interface SaveDisclosureVars {
  rcpNo: string;
  optimisticItem?: SavedDisclosure;
}

export function useSavedDisclosures(options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: SAVED_DISCLOSURES_KEY,
    queryFn: savedDisclosureService.getList,
    enabled: options?.enabled ?? true,
  });
}

export function useCheckSaved(rcpNo: string, options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: ['saved-disclosures', 'check', rcpNo],
    queryFn: () => savedDisclosureService.checkSaved(rcpNo),
    enabled: !!rcpNo && (options?.enabled ?? true),
  });
}

// DAR-226: 저장/해제 토글도 오프라인 차단 — paused mutation 유실로 인한 조용한 롤백 방지.
// UXR-17(D-3): watchlist(useWatchlist.ts)와 동일한 onMutate 낙관적 캐시 수정 + onError 롤백 —
// 저장/해제가 서버 왕복을 기다리지 않고 목록에 즉시 반영되고, 실패 시 되돌린 뒤 재동기화한다.
export function useSaveDisclosure() {
  const queryClient = useQueryClient();
  return useGuardedMutation(useMutation({
    mutationFn: (vars: string | SaveDisclosureVars) =>
      savedDisclosureService.save(typeof vars === 'string' ? vars : vars.rcpNo),
    // 낙관적 삽입: 항목이 전달된 경우('실행 취소') 목록 맨 앞에 즉시 복원.
    onMutate: async (vars: string | SaveDisclosureVars) => {
      const item = typeof vars === 'string' ? undefined : vars.optimisticItem;
      await queryClient.cancelQueries({ queryKey: SAVED_DISCLOSURES_KEY });
      const prev = queryClient.getQueryData<SavedDisclosuresCache>(SAVED_DISCLOSURES_KEY);
      if (prev && item && !prev.data.some((i) => i.rcpNo === item.rcpNo)) {
        queryClient.setQueryData<SavedDisclosuresCache>(SAVED_DISCLOSURES_KEY, {
          data: [item, ...prev.data],
          meta: prev.meta
            ? { ...prev.meta, total: (prev.meta.total ?? prev.data.length) + 1 }
            : prev.meta,
        });
      }
      return { prev };
    },
    onError: (_error, _vars, context) => {
      // 서버 오류 시 롤백
      if (context?.prev) {
        queryClient.setQueryData(SAVED_DISCLOSURES_KEY, context.prev);
      }
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: SAVED_DISCLOSURES_KEY }),
  }));
}

export function useRemoveSavedDisclosure() {
  const queryClient = useQueryClient();
  return useGuardedMutation(useMutation({
    mutationFn: savedDisclosureService.remove,
    // 낙관적 제거: 캐시에서 즉시 제외 — '제거했어요' 안내와 목록 잔존의 불일치 방지.
    onMutate: async (id: string) => {
      await queryClient.cancelQueries({ queryKey: SAVED_DISCLOSURES_KEY });
      const prev = queryClient.getQueryData<SavedDisclosuresCache>(SAVED_DISCLOSURES_KEY);
      if (prev) {
        queryClient.setQueryData<SavedDisclosuresCache>(SAVED_DISCLOSURES_KEY, {
          data: prev.data.filter((i) => i.id !== id),
          meta: prev.meta
            ? { ...prev.meta, total: Math.max((prev.meta.total ?? prev.data.length) - 1, 0) }
            : prev.meta,
        });
      }
      return { prev };
    },
    onError: (_error, _id, context) => {
      if (context?.prev) {
        queryClient.setQueryData(SAVED_DISCLOSURES_KEY, context.prev);
      }
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: SAVED_DISCLOSURES_KEY }),
  }));
}

export function useUnsaveDisclosure() {
  const queryClient = useQueryClient();
  return useGuardedMutation(useMutation({
    mutationFn: savedDisclosureService.removeByRcpNo,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: SAVED_DISCLOSURES_KEY });
    },
  }));
}
