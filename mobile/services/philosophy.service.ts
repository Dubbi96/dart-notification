// 투자거장 철학(P-A)·철학 적합도(P-B) 조회 서비스 (DAR-54)
// 모두 GET·읽기 전용. 게스트 열람 가능(백엔드 OptionalJwtAuthGuard) — 토큰 없이도 호출된다.
import type { ApiResponse } from '@app-types/api.types';
import type {
  Philosophy,
  PhilosophyFitResult,
  CompanyPhilosophyFit,
  CompanyPersonaPhilosophyFusion,
} from '@app-types/philosophy.types';

import { api } from './api';

export const philosophyService = {
  /** 투자자 철학 목록(4종 — 버핏·린치·그린블라트·드러켄밀러). styleTag 로 선택 필터. */
  getPhilosophies: (styleTag?: string) =>
    api
      .get<ApiResponse<Philosophy[]>>('/philosophies', {
        params: { ...(styleTag && { styleTag }) },
      })
      .then((r) => r.data.data),

  /** 철학 1종 × 종목 1건 적합도(점수 + 통과/미달 근거). */
  getPhilosophyFit: (philosophyId: string, corpCode: string, fsDiv?: string) =>
    api
      .get<ApiResponse<PhilosophyFitResult>>(`/philosophies/${philosophyId}/fit`, {
        params: { corpCode, ...(fsDiv && { fsDiv }) },
      })
      .then((r) => r.data.data),

  /** 종목 × 거장별 적합도(전체 철학, 점수 내림차순). */
  getCompanyFit: (corpCode: string, fsDiv?: string) =>
    api
      .get<ApiResponse<CompanyPhilosophyFit>>(`/companies/${corpCode}/philosophy-fit`, {
        params: { ...(fsDiv && { fsDiv }) },
      })
      .then((r) => r.data.data),

  /**
   * 종목 × 거장 철학 × AI 관점 결합(P-C, DAR-72/82).
   * 신규 AI 호출 0 — 저장된 personaViews + 철학 적합도(Rule)만 결합한다.
   */
  getCompanyFusion: (corpCode: string, fsDiv?: string) =>
    api
      .get<ApiResponse<CompanyPersonaPhilosophyFusion>>(
        `/companies/${corpCode}/persona-philosophy-fusion`,
        { params: { ...(fsDiv && { fsDiv }) } },
      )
      .then((r) => r.data.data),
};
