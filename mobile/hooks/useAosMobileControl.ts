import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { aosMobileControlService } from '@services/aosMobileControl.service';

export const AOS_MOBILE_CONTROL_QUERY_KEY = ['aos', 'mobile-control'] as const;

export function useAosMobileControl(enabled: boolean) {
  return useQuery({
    queryKey: AOS_MOBILE_CONTROL_QUERY_KEY,
    queryFn: aosMobileControlService.getBootstrap,
    enabled,
    retry: false,
    staleTime: 15_000,
  });
}

export function useActivateMobileKillSwitch() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: aosMobileControlService.activateNewEntryHalt,
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: AOS_MOBILE_CONTROL_QUERY_KEY }),
        queryClient.invalidateQueries({ queryKey: ['auto-trading-status'] }),
      ]);
    },
  });
}
