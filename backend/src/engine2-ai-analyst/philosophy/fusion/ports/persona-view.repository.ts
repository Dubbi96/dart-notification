/**
 * Persona 철학 엔진 P-C — 저장된 AI personaViews 조회 포트 (DAR-72)
 *
 * 결합 레이어는 **DB에 저장된 산출물만** 읽는다(신규 AI 호출 0, 엔진 경계 준수).
 * 읽기 전용 — 쓰기는 engine2 AI 파이프라인(persona-interpretation)이 담당한다.
 */
import { StoredPersonaView } from '../persona-philosophy.scorer';

/** 종목 1건의 최신 AI personaViews(없으면 null) */
export interface LatestPersonaViews {
  rcpNo: string;
  corpCode: string;
  views: StoredPersonaView[];
  createdAt: Date;
}

export abstract class PersonaViewRepository {
  /**
   * 종목(corpCode)의 **가장 최근** personaAnalysis 산출물을 반환.
   * AI 해석이 아직 없으면 null(결측 폴백 대상).
   */
  abstract findLatestByCorpCode(
    corpCode: string,
  ): Promise<LatestPersonaViews | null>;
}
