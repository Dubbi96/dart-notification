// 장 시작 전 종합 프리플라이트 타입 (DAR-487, 견고화 W3·P26) — 08:30 KST 사전 점검.
//
// 배경(갭 E6): 장 시작 전 잡은 데이터 준비 성격(08:50 종목상태·08:40 시장분류)만 있고,
// 토큰·휴장일·전일 일봉 정합·리스크 상태를 한 번에 묶는 종합 프리플라이트가 없었다.
// 이 타입은 그 사전 점검 결과 스냅샷을 표현한다.
//
// ★점검 전용(read-only) — 매매 로직·판정 무변경(M10 클록 보호). 이상 발견 시에만 알림(정상=로그).
//   KIS 토큰 사전 워밍은 유효 캐시가 있으면 신규 발급을 하지 않는다(발급 제한 존중).

import { OpsAlertSeverity } from '../common/queues/queue.constants';

/** 개별 점검 상태. OK=정상 · WARN/FAIL=이상 · SKIPPED=대상 아님(휴장·미설정·데이터 없음). */
export type PreflightCheckStatus = 'OK' | 'WARN' | 'FAIL' | 'SKIPPED';

/** 프리플라이트 점검 항목 키. */
export type PreflightCheckKey =
  | 'kis-token'
  | 'daily-price-sanity'
  | 'kill-switch'
  | 'risk-gate';

/**
 * 이상 소견 1건. channel 로 발송 채널을 라우팅한다:
 *  - RISK: 킬스위치 발동·리스크 게이트 차단(P02 enqueueRiskAlert).
 *  - OPS : 토큰 워밍 실패·전일 일봉 정합 이상(P02 enqueueOpsAlert).
 */
export interface PreflightFinding {
  check: PreflightCheckKey;
  /** 발송 채널 — 이상 종류에 따라 RISK/OPS 로 분기. */
  channel: 'RISK' | 'OPS';
  /** 심각도(제목 라벨·중요도). */
  severity: OpsAlertSeverity;
  /** 사용자/운영자 표시 사유(한국어 평문). */
  message: string;
}

/** 세션 경계(자정 기준 분). market-calendar getMarketSession 반환 형태. */
export interface PreflightSession {
  openMin: number;
  closeMin: number;
}

/** 개별 점검 상태 묶음. */
export interface PreflightChecks {
  /** KIS 토큰 사전 워밍(유효 캐시 있으면 재발급 없이 OK · 미설정 SKIPPED). */
  kisToken: PreflightCheckStatus;
  /** 전일(최근) 일봉 OHLC 물리 정합 + 신선도(데이터 없으면 SKIPPED). */
  dailyPriceSanity: PreflightCheckStatus;
  /** 킬스위치 발동 여부(발동 중이면 FAIL). */
  killSwitch: PreflightCheckStatus;
  /** 리스크 게이트 차단 여부(차단 중이면 FAIL). */
  riskGate: PreflightCheckStatus;
}

/**
 * 프리플라이트 리포트 스냅샷. `now` 주입으로 결정론 테스트.
 * overall:
 *  - 'HOLIDAY' : 휴장일 → 이후 점검 스킵(정상, 무발송).
 *  - 'OK'      : 거래일 + 이상 0(무발송, 로그만).
 *  - 'ANOMALY' : 거래일 + 이상 1건 이상(RISK/OPS 알림 발송).
 */
export interface PreMarketPreflightReport {
  /** 집계 생성 시각 ISO8601. */
  generatedAt: string;
  /** 기준 거래일(KST, YYYY-MM-DD) — 멱등 자연키 버킷. */
  tradingDateKst: string;
  /** 오늘이 KRX 거래일인가(평일 && 공휴일 아님). false 면 이후 점검 스킵. */
  isTradingDay: boolean;
  /** 반일장/지연개장 여부(거래일일 때만 의미 — 수능 지연개장 등). */
  isHalfDay: boolean;
  /** 정규/override 세션 경계(거래일일 때). 비거래일이면 null. */
  session: PreflightSession | null;
  /** 각 점검 상태. */
  checks: PreflightChecks;
  /** 이상 소견 목록(정상 시 빈 배열). */
  findings: PreflightFinding[];
  /** 최상위 요약 — 발송 여부 결정. */
  overall: 'OK' | 'ANOMALY' | 'HOLIDAY';
  /** 사람이 읽는 로그 다이제스트(한국어 평문). */
  summary: string;
}
