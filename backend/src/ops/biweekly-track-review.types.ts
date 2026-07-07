// 격주 트랙 성과 순위 리포트 타입 — 모의투자 전 트랙의 트레일링 14일(캘린더, KST) 실현 성과를
// 집계·순위화하고 시장국면(market-regime)을 태깅해 "지금 장에 맞는 트랙" 판단 데이터를 제공한다.
//
// 일일 운영 리포트(ops-daily-report, DAR-477)가 '어제 하루' 운영 관점이라면, 이 리포트는
// '최근 2주' 트랙 간 상대 성과 관점이다. 격주 일요일 10:00 KST 발송(OPS_ALERT 채널) +
// GET /ops/track-review 온디맨드 조회를 같은 구조체로 공유한다.
//
// ★read-only 관측·알림 전용 — 신규 수집·외부 실호출·체결·AI 개입 0. 마이그레이션 0.
//   ★실주문/Kill Switch 무직결(관측·알림 계층 전용) — M10 클록 보호(매매 행동 무변경).

import { MarketRegime } from '../engine5-trading-risk/paper-simulation/persona/market-regime';

/**
 * 트랙별 트레일링 14일 실현 성과 요약(전부 CLOSED/실현 기준 — OPEN 평가손익 미포함).
 *
 * 트랙 식별 키(trackKey)는 각 트랙의 styleTag SSOT 를 따른다:
 *  - 시스템 모의 'paper-simulation' · 철학 4종 'BUFFETT'|'LYNCH'|'GREENBLATT'|'DRUCKENMILLER'
 *  - 전략 forward 'strategy:<key>'(동적 수집) · 분봉 단타 'intraday-scalp'
 *  - 듀얼모멘텀 코어 'alloc:dual-momentum'
 */
export interface TrackReviewSummary {
  /** 트랙 식별 키(styleTag SSOT). */
  trackKey: string;
  /** 사람이 읽는 한국어 라벨(예: '시스템 모의' · '철학 버핏' · '전략 이벤트엣지'). */
  label: string;
  /** 윈도 내 청산(실현) 건수. */
  closedTrades: number;
  /** 윈도 내 순손익 > 0 청산 건수. */
  wins: number;
  /** 승률(%) — 청산 0건이면 null(가짜 비율 금지). */
  winRatePct: number | null;
  /** 윈도 내 실현손익 합(원, 순손익 기준). */
  realizedPnlKrw: number;
  /** 트랙 가상원금(원) — 각 트랙 모듈의 원금 상수(수익률 분모). */
  initialCapitalKrw: number;
  /** 수익률(%) = 실현손익 합 / 원금 × 100 (실현 기준). */
  returnPct: number;
  /** 평균 보유기간(일, 소수 허용 — 단타는 1일 미만). 산출 표본 없으면 null. */
  avgHoldDays: number | null;
  /** 표본부족 정직 표기 — 청산 < 5건(과신 방지, 순위에는 포함). */
  lowSample: boolean;
  /** 수익률 내림차순 순위(1-base). lowSample 트랙도 순위에 두되 플래그로 노출. */
  rank: number;
}

/** 격주 트랙 성과 순위 리포트 스냅샷. */
export interface BiweeklyTrackReview {
  /** 집계 생성 시각 ISO8601. */
  generatedAt: string;
  /** 집계 시작일(KST, YYYY-MM-DD) — 윈도 첫날 00:00 KST 포함. */
  periodStartKst: string;
  /** 집계 종료일(KST, YYYY-MM-DD) — 생성 시각까지 포함(리포트 당일). */
  periodEndKst: string;
  /** 트레일링 윈도 길이(캘린더 일). 항상 14. */
  windowDays: number;
  /** 현재 시장국면(market-regime Rule 재사용) — 판정 실패 시 null(graceful). */
  regime: MarketRegime | null;
  /** 트랙 요약 — 수익률 내림차순 순위순 정렬. */
  tracks: TrackReviewSummary[];
  /** 발송 본문(한국어 평문 다이제스트, 이모지 미사용) — enqueueOpsAlert message. */
  body: string;
}
