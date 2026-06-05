// Engine5 — 이벤트 화이트리스트/블랙리스트 (M11, DAR-18)
// M12 자동매매 게이트용 구조 + 평가 함수. AI 금지영역: 순수 Rule.

import { EventKind, EventGateResult } from './risk-check.types';

// 화이트리스트 (6종) — 자동매매 허용 이벤트
const WHITELIST: Set<EventKind> = new Set([
  'EARNINGS_BEAT',
  'REVENUE_GROWTH',
  'NEW_CONTRACT',
  'DIVIDEND_INCREASE',
  'SHARE_BUYBACK',
  'MANAGEMENT_BUYOUT',
]);

// 블랙리스트 (9종) — 자동매매 차단 이벤트
const BLACKLIST: Set<EventKind> = new Set([
  'ACCOUNTING_FRAUD',
  'REGULATORY_ACTION',
  'DELISTING_RISK',
  'MAJOR_LITIGATION',
  'EARNINGS_MISS',
  'DIVIDEND_CUT',
  'CAPITAL_REDUCTION',
  'MANAGEMENT_SCANDAL',
  'TRADING_SUSPENSION',
]);

const WHITELIST_REASONS: Record<string, string> = {
  EARNINGS_BEAT: '실적 서프라이즈 — 시장 예상 초과 달성',
  REVENUE_GROWTH: '매출 성장 확인',
  NEW_CONTRACT: '신규 계약·수주 공시',
  DIVIDEND_INCREASE: '배당 증가 발표',
  SHARE_BUYBACK: '자사주 매입 공시',
  MANAGEMENT_BUYOUT: '경영진 자사주 매입 (내부자 신뢰 신호)',
};

const BLACKLIST_REASONS: Record<string, string> = {
  ACCOUNTING_FRAUD: '회계 부정 적발 — 신뢰성 붕괴',
  REGULATORY_ACTION: '규제 제재 — 영업 위험',
  DELISTING_RISK: '상장폐지 위험 공시',
  MAJOR_LITIGATION: '중대 소송 — 대규모 배상 위험',
  EARNINGS_MISS: '실적 쇼크 — 예상 대비 큰 괴리',
  DIVIDEND_CUT: '배당 삭감 — 현금흐름 악화 신호',
  CAPITAL_REDUCTION: '감자 — 주주가치 훼손',
  MANAGEMENT_SCANDAL: '경영진 스캔들 — 거버넌스 리스크',
  TRADING_SUSPENSION: '거래정지 위험',
};

/**
 * evaluateEventGate — 이벤트 종류로 자동매매 허용/차단 판정 (순수 함수)
 */
export function evaluateEventGate(eventKind: EventKind): EventGateResult {
  if (WHITELIST.has(eventKind)) {
    return {
      eventKind,
      allowed: true,
      reason: WHITELIST_REASONS[eventKind] ?? '화이트리스트 이벤트',
    };
  }

  if (BLACKLIST.has(eventKind)) {
    return {
      eventKind,
      allowed: false,
      reason: BLACKLIST_REASONS[eventKind] ?? '블랙리스트 이벤트',
    };
  }

  // 명시적 분류 없음 → 기본 차단 (보수적)
  return {
    eventKind,
    allowed: false,
    reason: '분류되지 않은 이벤트 — 보수적 차단',
  };
}

export function isWhitelisted(eventKind: EventKind): boolean {
  return WHITELIST.has(eventKind);
}

export function isBlacklisted(eventKind: EventKind): boolean {
  return BLACKLIST.has(eventKind);
}

export const WHITELIST_EVENTS: EventKind[] = Array.from(WHITELIST) as EventKind[];
export const BLACKLIST_EVENTS: EventKind[] = Array.from(BLACKLIST) as EventKind[];
