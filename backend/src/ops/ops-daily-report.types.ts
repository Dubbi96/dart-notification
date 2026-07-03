// 일일 운영 리포트 타입 (DAR-477, 견고화 W0·P05) — 장마감 후 운영 요약.
//
// pull 대시보드(GET /ops/metrics, DAR-111)는 상시 조회형이다. 이 리포트는 그 집계를
// 재사용(OpsMetricsService.getMetrics)해 하루 1회 능동 발송(OPS_ALERT 채널, DAR-473 P01)한다.
//
// ★read-only 관측 — 신규 수집·외부 실호출·체결·AI 개입 0. 마이그레이션 0.
//   ★실주문/Kill Switch 무직결(관측·알림 계층 전용) — M10 클록 보호(매매 행동 무변경).

import { SlippageSummary } from './ops-metrics.types';

/** 리포트 심각도 — 발송 라벨/중요도. 크론 실패·정체가 있으면 WARNING, 아니면 INFO. */
export type OpsDailyReportSeverity = 'INFO' | 'WARNING';

/**
 * 트랙별 손익 요약. 트랙 = Position 소속 포트폴리오(시스템 모의·전략 4종·철학 4종) 또는
 * 분봉 단타(IntradayScalpTrade). CLOSED 포지션의 unrealizedPnl 은 청산 시점에 고정된
 * 실현손익이다(strategy-forward equity 산식과 동일 관점).
 */
export interface TrackPnlSummary {
  /** 트랙 식별 키 — 포트폴리오 id 또는 styleTag. */
  trackKey: string;
  /** 사람이 읽는 라벨 — Portfolio.name 또는 styleTag. */
  label: string;
  /** 누적 실현손익(원) — 청산(CLOSED) 포지션 손익 합. */
  realizedPnlKrw: number;
  /** 현재 평가손익(원) — 보유(OPEN) 포지션 미실현 손익 합. */
  unrealizedPnlKrw: number;
  /** 보유(OPEN) 포지션 수. */
  openPositions: number;
  /** 청산(CLOSED) 포지션 수. */
  closedPositions: number;
}

/** 트랙별 최근 체결 건수(styleTag 기준). */
export interface TrackFillSummary {
  /** 트랙 식별 태그(styleTag). null 태그는 '(untagged)'. */
  styleTag: string;
  /** 집계 윈도 내 체결 건수. */
  fills: number;
}

/** 크론 실행 실패·정체 요약(오류율). */
export interface CronErrorSummary {
  /** 집계 윈도(시간). */
  windowHours: number;
  /** 윈도 내 총 실행 수(성공+실패+스킵). */
  totalRuns: number;
  /** 윈도 내 실패(FAILED) 실행 수. */
  failedRuns: number;
  /** 오류율(%) = failed/total*100. 총 실행 0이면 null(가짜 비율 금지). */
  errorRatePct: number | null;
  /** 윈도 내 1회 이상 실패한 잡 키 목록(오름차순). */
  failedJobKeys: string[];
  /** 신선도 판정상 정체(stale)로 잡힌 잡 키 목록(freshness 연계). */
  staleJobs: string[];
}

/** 일일 운영 리포트 스냅샷. */
export interface OpsDailyReport {
  /** 집계 생성 시각 ISO8601. */
  generatedAt: string;
  /** 리포트 기준 거래일(KST, YYYY-MM-DD) — 멱등 자연키 버킷. */
  reportDateKst: string;
  /** 심각도(INFO|WARNING). */
  severity: OpsDailyReportSeverity;
  /** 트랙별 손익 — 누적 실현 + 현재 평가. */
  pnl: {
    byTrack: TrackPnlSummary[];
    totalRealizedPnlKrw: number;
    totalUnrealizedPnlKrw: number;
  };
  /** 최근 24h 체결 — 총합 + 트랙별. */
  fills: {
    windowHours: number;
    total: number;
    byTrack: TrackFillSummary[];
  };
  /** 크론 실패·정체(오류율). */
  cron: CronErrorSummary;
  /** 슬리피지 분포(누적, DAR-474 P03 표면 재사용) — 집계 실패 시 null. */
  slippage: SlippageSummary | null;
  /** 최근 24h 생성 신호 수(getMetrics 재사용). */
  signals24h: number;
  /** 누적 AI 비용(USD, getMetrics 재사용). */
  aiCostUsdTotal: number;
  /** 발송 본문(한국어 평문 다이제스트) — enqueueOpsAlert message. */
  body: string;
}
