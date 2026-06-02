import { api } from './api';
import type { ApiResponse } from '@app-types/api.types';

export interface SavedDisclosure {
  id: string;
  savedAt: string;
  rcpNo: string;
  corpCode: string;
  corpName: string;
  reportName: string;
  rcpDt: string;
  disclosureType: string;
}

export const savedDisclosureService = {
  getList: () =>
    api
      .get<ApiResponse<SavedDisclosure[]>>('/saved-disclosures')
      .then((r) => ({ data: r.data.data, meta: r.data.meta })),

  save: (rcpNo: string) =>
    api
      .post<ApiResponse<SavedDisclosure>>('/saved-disclosures', { rcpNo })
      .then((r) => r.data.data),

  remove: (id: string) =>
    api.delete(`/saved-disclosures/${id}`),

  removeByRcpNo: (rcpNo: string) =>
    api.delete(`/saved-disclosures/rcpNo/${rcpNo}`),

  checkSaved: (rcpNo: string) =>
    api
      .get<ApiResponse<{ isSaved: boolean }>>(`/saved-disclosures/check/${rcpNo}`)
      .then((r) => r.data.data.isSaved),
};
