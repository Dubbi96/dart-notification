import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { savedDisclosureService } from '@services/saved-disclosure.service';
import { useGuardedMutation } from '@hooks/useGuardedMutation';

export function useSavedDisclosures(options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: ['saved-disclosures'],
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
export function useSaveDisclosure() {
  const queryClient = useQueryClient();
  return useGuardedMutation(useMutation({
    mutationFn: savedDisclosureService.save,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['saved-disclosures'] });
    },
  }));
}

export function useRemoveSavedDisclosure() {
  const queryClient = useQueryClient();
  return useGuardedMutation(useMutation({
    mutationFn: savedDisclosureService.remove,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['saved-disclosures'] });
    },
  }));
}

export function useUnsaveDisclosure() {
  const queryClient = useQueryClient();
  return useGuardedMutation(useMutation({
    mutationFn: savedDisclosureService.removeByRcpNo,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['saved-disclosures'] });
    },
  }));
}
