import type { ApiResponse } from '@app-types/api.types';
import type { AosAllocationSummary } from '@app-types/allocation.types';

import { api } from './api';

export const aosAllocationService = {
  getSummary: () =>
    api
      .get<ApiResponse<AosAllocationSummary>>('/aos/allocation/summary')
      .then((response) => response.data.data),
};
