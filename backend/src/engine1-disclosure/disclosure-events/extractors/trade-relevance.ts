// backend/src/engine1-disclosure/disclosure-events/extractors/trade-relevance.ts
// DAR-394: 거래대상(신호 생산) 이벤트유형 식별 — 문서 fetch 전 메타데이터(보고서명) 전용 선별.
//
// 배경: DART 일일 문서 fetch 쿼터가 하드 상한이라, 백필 공시 24만 건 전부를 무차별
//   fetch 하면 쿼터가 비신호 공시(대다수)에 낭비된다. 백테스트 신호는 '거래대상'
//   이벤트유형(공급계약·자사주·유상증자·CB/BW·실적 등)에서만 나오므로, 보고서명만으로
//   거래대상 후보를 선별해 그쪽을 우선 fetch 하면 동일 쿼터로 신호 커버리지를 최대화한다.

import { EventType } from '@prisma/client';
import { classifyByReportName } from './event-classifier';

/**
 * 백테스트 신호를 생산하는 '거래대상' 이벤트유형 집합 (L0, Rule 전용).
 *
 * ★SSOT 정합: persona-view.rule 의 FAVORED ∪ DILUTIVE ∪ NEGATIVE 와 1:1 대응한다.
 *   이 집합 밖 이벤트는 4 Persona view 가 전부 NEUTRAL → 신호 0 → 문서를 fetch 해도
 *   백테스트 신호가 나오지 않는다(쿼터 낭비). 새 거래대상 유형이 persona-view 에
 *   추가되면 이 집합도 함께 갱신해야 한다(분류↔신호 발산 방지).
 */
export const TRADE_RELEVANT_EVENT_TYPES: ReadonlySet<EventType> = new Set<EventType>([
  // ── 긍정 촉매 (FAVORED) ──────────────────────────────────────────
  EventType.SUPPLY_CONTRACT,
  EventType.EARNINGS_SURPRISE,
  EventType.DIVIDEND_INCREASE,
  EventType.SHARE_BUYBACK,
  EventType.SHARE_CANCELLATION,
  EventType.MAJOR_SHAREHOLDER_CHANGE,
  // ── 희석성 (DILUTIVE) ────────────────────────────────────────────
  EventType.PAID_IN_CAPITAL_INCREASE,
  EventType.THIRD_PARTY_ALLOTMENT,
  EventType.CB_ISSUANCE,
  EventType.BW_ISSUANCE,
  // ── 악재 (NEGATIVE) ──────────────────────────────────────────────
  EventType.EARNINGS_SHOCK,
  EventType.CONTRACT_CANCELLATION,
  EventType.AUDIT_OPINION_RISK,
  EventType.TRADING_SUSPENSION,
  EventType.DELISTING_RISK,
  EventType.LAWSUIT,
  EventType.DIVIDEND_CUT,
]);

/**
 * 보고서명 메타데이터만으로(문서 fetch 전) 거래대상 후보 여부 판정 (L0).
 *
 * classifyByReportName 으로 보고서명을 1차 분류한 뒤 TRADE_RELEVANT_EVENT_TYPES
 * 소속이면 true. 보고서명이 어떤 룰에도 매칭되지 않으면(null) 비거래대상으로 본다
 * (원문 없이는 더 알 수 없으므로 보수적으로 후순위 처리).
 */
export function isTradeRelevantReportName(reportName: string | null | undefined): boolean {
  if (!reportName) return false;
  const cls = classifyByReportName(reportName);
  return cls != null && TRADE_RELEVANT_EVENT_TYPES.has(cls.eventType);
}

/**
 * SQL 사전선별용 거래대상 보고서명 키워드 (DB-level prefilter).
 *
 * 240K PENDING 문서 전수에 정규식을 앱에서 돌리는 대신, 이 키워드 OR contains 로
 * Postgres 가 거래대상 후보를 먼저 좁힌다(상위집합). 정밀 판정은 항상
 * isTradeRelevantReportName(정규식 SSOT)으로 앱에서 확정하므로, 키워드는
 * '거짓양성은 허용하되 거짓음성을 최소화'하도록 거래대상 룰 패턴에서 도출한 넓은 집합이다.
 *
 * ★불변식(trade-relevance.spec): TRADE_RELEVANT_EVENT_TYPES 의 대표 보고서명은
 *   반드시 최소 1개 키워드에 매칭되어야 한다(키워드↔룰 발산 시 우선순위 누락 감지).
 */
export const TRADE_RELEVANT_REPORT_NAME_KEYWORDS: readonly string[] = [
  // 계약
  '공급계약',
  '판매계약',
  // 자기주식·소각·신탁
  '자기주식',
  '자사주',
  '주식소각',
  '신탁계약',
  // 배당
  '배당',
  // 증자(유상·제3자배정)
  '유상증자',
  '제3자배정',
  '주주배정',
  // 메자닌(CB/BW)
  '전환사채',
  '신주인수권부사채',
  // 최대주주·경영권
  '최대주주',
  '경영권',
  // 실적
  '실적',
  '손익구조',
  '영업이익',
  '영업손실',
  '순손실',
  '흑자전환',
  '적자전환',
  // 소송·횡령·배임
  '소송',
  '횡령',
  '배임',
  '소제기',
  // 감사의견
  '감사의견',
  '강조사항',
  // 거래정지
  '거래정지',
  '매매거래',
  // 상장폐지·관리종목
  '상장폐지',
  '관리종목',
  '투자경고',
  '투자위험',
];

/**
 * 거래대상 보고서명 Prisma where 필터(키워드 OR contains).
 * Disclosure(또는 그 relation) 의 reportName 사전선별에 사용한다. 대소문자 무시
 * (CB/BW 등 영문 토큰 대비). 순수 객체 반환 — Prisma 타입 결합 없이 재사용.
 */
export function tradeRelevantReportNameFilter(): {
  OR: { reportName: { contains: string; mode: 'insensitive' } }[];
} {
  return {
    OR: TRADE_RELEVANT_REPORT_NAME_KEYWORDS.map((kw) => ({
      reportName: { contains: kw, mode: 'insensitive' as const },
    })),
  };
}
