// 운영 메트릭 응답 타입 (DAR-111) — 경량 JSON 카운터.
// 외부키/실호출 0, AI 0, 마이그레이션 0. 기존 테이블·도메인 서비스 read-only 집계만.

import { PipelineHealth } from '../engine1-disclosure/pipeline/pipeline.types';

/** AIUsageLog 누적 카운터(전체 기간). 표본 0건이면 모두 0(graceful). */
export interface AiUsageCounters {
  /** 누적 AI 호출 건수 */
  totalCalls: number;
  /** 누적 비용(USD) */
  totalCostUsd: number;
  /** 누적 입력 토큰 */
  totalInputTokens: number;
  /** 누적 출력 토큰 */
  totalOutputTokens: number;
}

/** 최근 신호 카운터. */
export interface SignalCounters {
  /** 최근 24시간 생성 신호 수 */
  last24h: number;
  /** 최근 7일 생성 신호 수 */
  last7d: number;
  /** 누적 신호 수 */
  total: number;
}

/** 모의 포지션 카운터(★실주문 모듈 미구축 — 전 포지션이 모의). */
export interface SimulationPositionCounters {
  /** 보유 중(OPEN) 포지션 수 */
  open: number;
  /** 청산(CLOSED) 포지션 수 */
  closed: number;
  /** 전체 포지션 수 */
  total: number;
}

/** 수집 신선도 요약(DAR-110 연계) — 마지막 수집 시각·정체 여부. */
export interface CollectionFreshnessSummary {
  /** 적용 가능한 잡 중 하나라도 stale 이면 true */
  anyStale: boolean;
  /** stale 로 판정된 잡 키 목록 */
  staleJobs: string[];
  /** 잡별 마지막 성공시각·정체 여부(경량) */
  jobs: Array<{
    jobKey: string;
    lastSuccessAt: string | null;
    isStale: boolean;
    ageMinutes: number | null;
  }>;
}

/** 졸업 게이트 현재값 요약(G1/G2/G3/G5) — 표본수 포함, 과신 방지(측정불가=null). */
export interface GraduationGateSummary {
  id: string;
  label: string;
  /** 현재 측정값(측정 불가·표본 부족이면 null) */
  currentValue: number | null;
  threshold: number;
  /** 통과 여부(측정 불가·표본 부족이면 null) */
  pass: boolean | null;
  /** 표본수(표본 기반 게이트만, 그 외 null) */
  sampleSize: number | null;
}

/**
 * DAR-474 — 슬리피지 분포 집계(트랙 공통 형태). 체결 완료 거래 단위.
 *
 * 두 가지 관점을 **혼동 없이 분리**해 노출한다:
 *   · Krw(원): 체결 시 기록된 `slippage` 원가 절대값(체결일 기준가 대비 체결 마찰).
 *   · Bps(1/10000): 신호시점 기대가(`expectedPrice`) 대비 실현 슬리피지(부호=불리 방향 양수) —
 *     실전 전환 게이트("슬리피지 기대 이내 시 증액")가 소비하는 정규화 지표.
 *     expectedPrice 보존분(신규 예약·체결)만 산정 — 레거시/미보존 트랙은 null(graceful).
 */
export interface SlippageDistribution {
  /** 집계 대상 체결 건수(slippage 기록이 있는 체결·청산 완료 거래). */
  tradeCount: number;
  /** 평균 슬리피지 원가(KRW, 절대값). 표본 0이면 null. */
  avgSlippageKrw: number | null;
  /** p95 슬리피지 원가(KRW). 표본 0이면 null. */
  p95SlippageKrw: number | null;
  /** ★슬리피지와 구분 유지 — 수수료+세금 합(KRW). 단타 트랙 totalFees SSOT와 정합. */
  totalFeesKrw: number;
  /** 신호시점 기대가 대비 평균 실현 슬리피지(bps). bps 표본 0이면 null. */
  avgSlippageBps: number | null;
  /** 신호시점 기대가 대비 p95 실현 슬리피지(bps). bps 표본 0이면 null. */
  p95SlippageBps: number | null;
  /** bps 산정 표본수(expectedPrice·filledPrice 모두 있는 건). */
  bpsSampleSize: number;
}

/** 트랙(styleTag)별 슬리피지 분포 — 전체 합산 관점 포함. */
export interface SlippageTrackDistribution extends SlippageDistribution {
  /** 트랙 식별 태그(styleTag): 시스템 모의·전략 4종·철학 4종·분봉 단타. */
  styleTag: string;
}

/** 슬리피지 측정 표면(DAR-474) — 전체 합산 + 트랙별 분포. */
export interface SlippageSummary {
  /** 전 트랙 합산 분포. */
  overall: SlippageDistribution;
  /** 트랙(styleTag)별 분포 — styleTag 오름차순. */
  byTrack: SlippageTrackDistribution[];
}

/** 운영 메트릭 스냅샷. */
export interface OpsMetrics {
  /** 집계 생성 시각 ISO8601 */
  generatedAt: string;
  aiUsage: AiUsageCounters;
  signals: SignalCounters;
  simulationPositions: SimulationPositionCounters;
  /** DAR-110 freshness 연계 — 집계 실패 시 null(graceful) */
  collection: CollectionFreshnessSummary | null;
  /** G1/G2/G3/G5 현재값·표본수 — 산출 실패/데이터 부족 시 null(graceful) */
  graduation: GraduationGateSummary[] | null;
  /**
   * DAR-126 — 수집→파싱→이벤트→AI 단계별 건수·지연·실패 행.
   * PipelineModule 미배선/집계 실패 시 null(graceful) — 카운터 본체는 항상 반환.
   */
  pipeline: PipelineHealth | null;
  /**
   * DAR-474 — 슬리피지 분포(트랙별·전체). 신호시점 기대가 대비 실현 슬리피지 측정 표면.
   * 집계 실패 시 null(graceful) — 카운터 본체는 항상 반환.
   */
  slippage: SlippageSummary | null;
}
