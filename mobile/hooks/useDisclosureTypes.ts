import { useQuery } from '@tanstack/react-query';
import { disclosureService } from '@services/disclosure.service';

export function useDisclosureTypes() {
  return useQuery({
    queryKey: ['disclosureTypes'],
    queryFn: disclosureService.getTypes,
    staleTime: 24 * 60 * 60 * 1000,
    gcTime: Infinity,
  });
}
