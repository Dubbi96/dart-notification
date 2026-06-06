import type { ApiResponse } from '@app-types/api.types';
import type { CollectionStatus } from '@app-types/collection-status.types';

import { api } from './api';

// 수집 현황 집계 조회 — DAR-63. read-only 집계 엔드포인트.
// 컴포넌트 직접 fetch 금지: useCollectionStatus 훅으로만 소비.
export const collectionStatusService = {
  getStatus: () =>
    api
      .get<ApiResponse<CollectionStatus>>('/collection/status')
      .then((r) => r.data.data),
};
