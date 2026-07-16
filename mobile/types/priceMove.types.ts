// PRICE_MOVE 역방향 리즈닝 '왜 움직였나' 카드 계약 (DAR-524, Wave C/C2·P0).
//
// C1(DAR-522)이 engine3 급변동(±5%) 발화 → 48h 공시 원인 역추적 AI Task 로 생성한
// price_move_reasonings 행(등락 이벤트 refId 당 1건, 멱등)을 FE 가 조회 소비하는 타입.
// resultJson 은 status 로 판별하는 유니온이며, ANALYZED 는 설명층(원인 해석·근거)뿐 —
// 매수/매도/보유 권고·목표가·투자의견·점수·주문 필드가 없다(AI 금지영역 무접점).

/** 리즈닝 결과 상태(백엔드 price_move_reasonings.status 1:1). */
export type PriceMoveReasoningStatus = 'ANALYZED' | 'NO_DISCLOSURE' | 'CAP_SKIPPED';

/** 공시-등락 연관 강도(설명용 라벨 — 권고 아님). */
export type PriceMoveEventLinkage = 'STRONG' | 'MODERATE' | 'WEAK' | 'UNCLEAR';

/** ANALYZED — AI 원인 해석(설명층 한정). resultJson = { status, eventType, ...draft }. */
export interface PriceMoveReasoningAnalyzed {
  status: 'ANALYZED';
  /** 대표 이벤트 유형(미추출 시 'UNKNOWN'). */
  eventType: string;
  /** 공시가 이 방향/폭의 등락을 유발했다고 보는 근거 동반 원인 해석(2~4문장). */
  cause: string;
  /** 근거 목록(공시 이벤트·EventStudy 유사사례 통계 인용). */
  evidence: string[];
  /** 공시-등락 연관 강도(설명용 라벨). */
  eventLinkage: PriceMoveEventLinkage;
  /** 정직 한계 고지(상관≠인과·시장/수급 요인 가능성). */
  caveat: string;
}

/** NO_DISCLOSURE — 48h 무공시. AI 호출 0, 포맷 응답(분석 위장 금지). */
export interface PriceMoveReasoningNoDisclosure {
  status: 'NO_DISCLOSURE';
  /** '관련 공시 없음(48h)'. */
  label: string;
  /** '<corpName> <±X.X%> — 관련 공시 없음(48h)'. */
  message: string;
}

/** CAP_SKIPPED — 일일 비용 상한 초과로 AI 호출 0. 정직 고지(분석 위장 금지). */
export interface PriceMoveReasoningCapSkipped {
  status: 'CAP_SKIPPED';
  message: string;
}

/** price_move_reasonings.resultJson — status 판별 유니온. */
export type PriceMoveReasoningResult =
  | PriceMoveReasoningAnalyzed
  | PriceMoveReasoningNoDisclosure
  | PriceMoveReasoningCapSkipped;

/**
 * GET /price-move-reasonings/:refId 응답 data — price_move_reasonings 행 1건.
 * 백엔드 모델(DAR-522) 1:1 + 표시용 corpName(엔드포인트 조인 제공 시). 읽기 전용.
 */
export interface PriceMoveReasoning {
  /** 등락 이벤트 자연키 `<stockCode>-<YYYYMMDD>`(종목당 1일 1회). */
  refId: string;
  stockCode: string;
  /** DART 고유번호(논리 FK). */
  corpCode: string;
  /** 표시용 기업명(백엔드 조인 제공 시). 없으면 stockCode 로 대체 표기. */
  corpName?: string | null;
  /** 발화 거래일 KST YYYYMMDD. */
  tradeDate: string;
  /** 전일 종가 대비 등락률(%) — 방향·폭. */
  changePct: number;
  /** causal 공시 접수번호(무공시 케이스는 null) — 유사공시 통계 섹션 키. */
  rcpNo: string | null;
  status: PriceMoveReasoningStatus;
  /** 원인 해석·근거(ANALYZED) 또는 무공시/스킵 포맷 응답. */
  resultJson: PriceMoveReasoningResult;
  createdAt: string;
}
