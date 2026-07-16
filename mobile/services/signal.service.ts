import type { ApiResponse, PaginationMeta } from '@app-types/api.types';
import type {
  TradingSignal,
  ExitSignal,
  SignalFilters,
  SignalExploreFilters,
  CompanySignalBadge,
  DailyEditionSummary,
  DailyEditionsMeta,
  DailyEditionsPage,
  DailyEditionMeta,
  DailyEdition,
} from '@app-types/signal.types';

import { api } from './api';

export const signalService = {
  getBuySignals: (filters?: SignalFilters) =>
    api
      .get<ApiResponse<TradingSignal[]>>('/signals', {
        params: {
          ...(filters?.personaType && { personaType: filters.personaType }),
          // 다중 등급은 콤마 직렬화('STRONG_BUY,BUY') — 백엔드가 signal.in 으로 해석(DAR-193).
          ...(filters?.grade && {
            grade: Array.isArray(filters.grade)
              ? filters.grade.join(',')
              : filters.grade,
          }),
          ...(filters?.sort && { sort: filters.sort }),
          ...(filters?.entryReady && { entryReady: true }),
          // 최신성 윈도우(일) — 0(해제)도 유효값이므로 falsy 체크 대신 undefined 체크로 전달.
          ...(filters?.sinceDays !== undefined && { sinceDays: filters.sinceDays }),
        },
      })
      .then((r) => r.data.data),

  /**
   * 등급무관 전체 시그널 탐색(DAR-46) — 페이지네이션 + 등급/페르소나/이벤트유형 필터 + 정렬.
   * 무한스크롤을 위해 meta(page/totalPages)를 함께 반환한다.
   */
  getSignals: (filters: SignalExploreFilters, page = 1, limit = 20) =>
    api
      .get<ApiResponse<TradingSignal[]>>('/signals', {
        params: {
          page,
          limit,
          ...(filters.grade && { grade: filters.grade }),
          ...(filters.personaType && { personaType: filters.personaType }),
          ...(filters.eventType && { eventType: filters.eventType }),
          ...(filters.sort && { sort: filters.sort }),
        },
      })
      .then((r) => ({ data: r.data.data, meta: r.data.meta as PaginationMeta })),

  getBuySignalDetail: (id: string) =>
    api.get<ApiResponse<TradingSignal>>(`/signals/${id}`).then((r) => r.data.data),

  /**
   * 일일 에디션 날짜 목록(DAR-505/507) — GET /signals/daily-editions. 판단 존재일만 최신순.
   * meta 는 PaginationMeta 가 아닌 에디션 전용 커서 메타(latestDate/todayDate/nextCursor…)라
   * 응답 envelope 를 명시 타이핑해 items·meta 를 정규화 반환한다(빈 날은 목록에 없음).
   * @param before 커서: 이 날짜(YYYYMMDD) 미만만. 미지정=최신부터.
   * @param limit 페이지 크기(기본 7·최대 90, 백엔드 클램프).
   */
  getDailyEditions: (before?: string, limit?: number): Promise<DailyEditionsPage> =>
    api
      .get<{ success: boolean; data: DailyEditionSummary[]; meta: DailyEditionsMeta }>(
        '/signals/daily-editions',
        {
          params: {
            ...(before && { before }),
            ...(limit !== undefined && { limit }),
          },
        },
      )
      .then((r) => ({ items: r.data.data, meta: r.data.meta })),

  /**
   * 특정 KST 거래일 에디션(DAR-505/507) — GET /signals/daily/:date. 매수등급 랭킹 + meta.
   * item 은 TradingSignal(+rcpDt). 빈 날이면 items=[] + meta.emptyReason 로 사유(휴장/조용/…) 구분.
   * meta 는 date/isToday/isEmpty/emptyReason/prev·nextEditionDate 로 별도 타이핑.
   * @param date KST 거래일(YYYYMMDD).
   */
  getEdition: (date: string): Promise<DailyEdition> =>
    api
      .get<{ success: boolean; data: TradingSignal[]; meta: DailyEditionMeta }>(
        `/signals/daily/${date}`,
      )
      .then((r) => ({ items: r.data.data, meta: r.data.meta })),

  getExitSignals: () =>
    api.get<ApiResponse<ExitSignal[]>>('/signals/exit').then((r) => r.data.data),

  /**
   * 종목별 최신 신호 단건(DAR-159) — 종목 상세 신호 배지용. 백필 제외(백엔드 방어).
   * 해당 종목 신호가 없으면 data=null → 호출측이 빈상태로 흡수.
   */
  getCompanySignal: (corpCode: string) =>
    api
      .get<ApiResponse<CompanySignalBadge | null>>(`/signals/by-corp/${corpCode}`)
      .then((r) => r.data.data),

  /**
   * 공시(rcpNo)로 생성된 최신 매수 신호 단건(DAR-208) — 공시 상세 → 신호 역링크용.
   * 공시 → 신호 동선(intro Slide2의 "공시→AI 매수점수" 약속)을 복원한다.
   * 해당 공시 신호가 없으면 data=null → 진입 카드 미표시(빈상태 흡수).
   */
  getSignalByDisclosure: (rcpNo: string) =>
    api
      .get<ApiResponse<CompanySignalBadge | null>>(`/signals/by-disclosure/${rcpNo}`)
      .then((r) => r.data.data),
};
