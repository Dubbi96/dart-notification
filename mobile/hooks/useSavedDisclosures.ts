import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { savedDisclosureService } from '@services/saved-disclosure.service';

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

export function useSaveDisclosure() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: savedDisclosureService.save,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['saved-disclosures'] });
    },
  });
}

export function useRemoveSavedDisclosure() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: savedDisclosureService.remove,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['saved-disclosures'] });
    },
  });
}

export function useUnsaveDisclosure() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: savedDisclosureService.removeByRcpNo,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['saved-disclosures'] });
    },
  });
}
