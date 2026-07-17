// backend/src/disclosure-events/extractors/event-classifier.ts
// 보고서명 + parsedJson 기반 이벤트 타입 1차 분류기 (Rule 전용, AI 미사용)

import { EventType } from '@prisma/client';
import { ParsedJson } from '../../disclosure-documents/types/parsed-json.type';

// ─── 보고서명 → eventType 정규식 룰 테이블 ──────────────────────────────────
// 우선순위: 위에서 아래 순서대로 적용, 첫 번째 매칭 채택

interface ReportNameRule {
  pattern: RegExp;
  eventType: EventType;
  polarity: 'POSITIVE' | 'NEGATIVE' | 'MIXED' | 'UNKNOWN';
  confidence: number;
}

export const REPORT_NAME_RULES: ReportNameRule[] = [
  // ── 계약 ──────────────────────────────────────────────────────────────────
  // 계약 해제·취소를 체결보다 먼저 검사해야 오매핑 방지
  {
    pattern: /단일판매.*공급계약.*(해제|취소|종료)|공급계약.*(해제|취소)/,
    eventType: EventType.CONTRACT_CANCELLATION,
    polarity: 'NEGATIVE',
    confidence: 0.93,
  },
  {
    pattern: /단일판매[·\s]*공급계약|공급계약\s*체결|판매계약\s*체결/,
    eventType: EventType.SUPPLY_CONTRACT,
    polarity: 'POSITIVE',
    confidence: 0.92,
  },

  // ── 자기주식 ──────────────────────────────────────────────────────────────
  {
    pattern: /자기주식\s*소각|자사주\s*소각/,
    eventType: EventType.SHARE_CANCELLATION,
    polarity: 'POSITIVE',
    confidence: 0.95,
  },
  {
    pattern: /자기주식\s*(취득|처분)|자사주\s*취득/,
    eventType: EventType.SHARE_BUYBACK,
    polarity: 'POSITIVE',
    confidence: 0.95,
  },

  // ── 배당 ──────────────────────────────────────────────────────────────────
  // 배당 축소·중단 패턴을 먼저 검사
  {
    pattern: /배당\s*(축소|중단|감소|취소)/,
    eventType: EventType.DIVIDEND_CUT,
    polarity: 'NEGATIVE',
    confidence: 0.90,
  },
  {
    pattern: /현금배당|현물배당|배당\s*결정|배당금\s*지급/,
    eventType: EventType.DIVIDEND_INCREASE,
    polarity: 'POSITIVE',
    confidence: 0.88,
  },

  // ── 유상증자 ──────────────────────────────────────────────────────────────
  // 제3자배정 유상증자를 주주배정·일반공모보다 먼저 검사
  {
    pattern: /유상증자.*제3자\s*배정|제3자\s*배정.*증자/,
    eventType: EventType.THIRD_PARTY_ALLOTMENT,
    polarity: 'NEGATIVE',
    confidence: 0.93,
  },
  {
    pattern: /유상증자.*(주주배정|일반공모)|주주배정\s*증자|일반공모\s*증자/,
    eventType: EventType.PAID_IN_CAPITAL_INCREASE,
    polarity: 'NEGATIVE',
    confidence: 0.93,
  },
  // 단순 "유상증자" (위 두 패턴에 걸리지 않은 나머지)
  {
    pattern: /유상증자/,
    eventType: EventType.PAID_IN_CAPITAL_INCREASE,
    polarity: 'NEGATIVE',
    confidence: 0.87,
  },

  // ── 전환사채·신주인수권부사채 ─────────────────────────────────────────────
  {
    pattern: /전환사채.*발행|CB.*발행/i,
    eventType: EventType.CB_ISSUANCE,
    polarity: 'NEGATIVE',
    confidence: 0.94,
  },
  {
    pattern: /신주인수권부사채.*발행|BW.*발행/i,
    eventType: EventType.BW_ISSUANCE,
    polarity: 'NEGATIVE',
    confidence: 0.94,
  },
  // 단순 "전환사채" / "신주인수권부사채" 매칭 (발행 명시 없는 경우)
  {
    pattern: /전환사채|CB[\s(]/,
    eventType: EventType.CB_ISSUANCE,
    polarity: 'NEGATIVE',
    confidence: 0.86,
  },
  {
    pattern: /신주인수권부사채|BW[\s(]/,
    eventType: EventType.BW_ISSUANCE,
    polarity: 'NEGATIVE',
    confidence: 0.86,
  },

  // ── 최대주주 변경 ─────────────────────────────────────────────────────────
  {
    pattern: /최대주주.*(변경|교체)|경영권\s*(변경|양수도)/,
    eventType: EventType.MAJOR_SHAREHOLDER_CHANGE,
    polarity: 'MIXED',
    confidence: 0.90,
  },

  // ── 실적 가이던스 (자사 전망 공정공시) ────────────────────────────────────
  // W9: '연결재무제표 기준 영업실적 등에 대한 전망(공정공시)'·'영업실적등에대한전망',
  //     '장래사업·경영계획(공정공시)' — 회사가 스스로 공시한 전망(가이던스)이다.
  //     애널리스트 추정 집계가 아니므로 '시장 기대치 대비'로 오인시키는 표기 금지.
  //     확정 실적(잠정실적) 룰보다 먼저 검사해 '전망' 공시가 실적 확정치로 새지 않게 한다.
  //     방향(상향/하향)은 제목만으로 미상 → MIXED, 수치는 guidance.ts 추출기가 게이팅.
  {
    pattern: /영업\s*실적\s*등?\s*에?\s*대한\s*전망|영업\s*실적\s*전망|실적\s*등?\s*에?\s*대한\s*전망/,
    eventType: EventType.EARNINGS_GUIDANCE,
    polarity: 'MIXED',
    confidence: 0.90,
  },
  {
    // 중점(·U+00B7 / ㆍU+318D / ・U+30FB)·공백·'및' 변형 허용 — '장래사업ㆍ경영계획(공정공시)'
    pattern: /장래\s*사업\s*[·ㆍ・.,&]?\s*(및\s*)?경영\s*계획/,
    eventType: EventType.EARNINGS_GUIDANCE,
    polarity: 'MIXED',
    confidence: 0.90,
  },

  // ── 실적 (서프라이즈·쇼크) ─────────────────────────────────────────────────
  // DAR-58: 방향성 명시(흑자/적자 전환·개선·악화) 우선, 그 외 일반 실적공시는
  //         방향 미상 → EARNINGS_SURPRISE(MIXED) 하향 confidence로 AI L1 보정 경로 진입.
  // W9 주의: EARNINGS_SURPRISE/SHOCK 판정 기준은 전년동기(YoY) 대비다(earnings.ts).
  //          시장 기대치 대비 판정이 아니므로 소비 표면 카피도 그 기준을 명시해야 한다.
  {
    pattern: /적자\s*전환|영업\s*손실|순\s*손실|실적\s*(쇼크|악화)|손익구조.*(악화|감소)|파생상품.*손실/,
    eventType: EventType.EARNINGS_SHOCK,
    polarity: 'NEGATIVE',
    confidence: 0.88,
  },
  {
    pattern: /흑자\s*전환|실적\s*(개선|호조|서프라이즈)|영업이익.*(증가|확대|급증)/,
    eventType: EventType.EARNINGS_SURPRISE,
    polarity: 'POSITIVE',
    confidence: 0.88,
  },
  {
    // 방향 미상 일반 실적공시 — 0.72(<0.85) → NEEDS_REVIEW→AI L1이 방향 확정
    pattern: /영업[\s(]*잠정[\s)]*실적|연결[\s(]*잠정[\s)]*실적|잠정\s*실적|매출액.*손익구조.*(변동|변경)|손익구조\s*(변동|변경)/,
    eventType: EventType.EARNINGS_SURPRISE,
    polarity: 'MIXED',
    confidence: 0.72,
  },

  // ── 소송·횡령·배임 ────────────────────────────────────────────────────────
  {
    pattern: /소송.*제기|횡령|배임|소제기/,
    eventType: EventType.LAWSUIT,
    polarity: 'NEGATIVE',
    confidence: 0.91,
  },

  // ── 감사의견 리스크 ───────────────────────────────────────────────────────
  {
    pattern: /감사\)?의견.*(거절|한정|부적정)|강조사항/,
    eventType: EventType.AUDIT_OPINION_RISK,
    polarity: 'NEGATIVE',
    confidence: 0.95,
  },

  // ── 거래정지 ──────────────────────────────────────────────────────────────
  {
    pattern: /거래정지|매매거래.*정지/,
    eventType: EventType.TRADING_SUSPENSION,
    polarity: 'NEGATIVE',
    confidence: 0.97,
  },

  // ── 상장폐지·관리종목 ────────────────────────────────────────────────────
  {
    pattern: /상장폐지|관리종목.*지정|투자경고|투자위험/,
    eventType: EventType.DELISTING_RISK,
    polarity: 'NEGATIVE',
    confidence: 0.97,
  },

  // ── 지분변동: 대량보유(5%룰) ──────────────────────────────────────
  // DAR-87: 보고서명만으로는 매수/매도 방향을 알 수 없어 polarity UNKNOWN.
  // 정확한 방향(증감 부호)은 정형 엔드포인트(majorstock.json) 수집 경로에서
  // InsiderHoldingChange로 보강된다(insider-holding.mapper).
  {
    pattern: /주식등의\s*대량보유|대량보유상황보고/,
    eventType: EventType.MAJOR_HOLDER_5PCT,
    polarity: 'UNKNOWN',
    confidence: 0.85,
  },

  // ════════════════════════════════════════════════════════════════════════
  // DAR-346: 미모델 공시유형 분류 확대 (OTHER 4225 축소)
  // 라이브 DisclosureEvent eventType=OTHER 상위 reportName 패턴 전수조사 기반.
  // 모두 기존 시그널 룰보다 *아래(낮은 우선순위)*에 둔다 → 특정 시그널 룰이 항상 우선.
  //
  // confidence 정책(서비스 라우팅 §4-7 + DAR-58 선례):
  //   - 0.85: AI L1이 의미 있게 분석할 "재료성" 행위 → NEEDS_REVIEW(AWAITING_AI_L1).
  //   - 0.80: 정형·절차성 공시(정기보고/IR/주총/시장안내 등) → 추출기 부재 시 FAILED.
  //           분류는 확정이나 수치/시그널 모델이 없어 AI 자동 라우팅 대상이 아님.
  // (정형 추출기는 후속 이터레이션 — 본 이슈 목표는 "분류조차 안 됨(OTHER)" 해소.)
  // ════════════════════════════════════════════════════════════════════════

  // ── 자기주식 소각/취득 — 보강(기존 "자기주식 소각" 룰이 못 잡는 변형) ──────
  // "주식소각결정"(자기주식 명시 없음) → 소각은 주주가치 환원
  {
    pattern: /주식\s*소각/,
    eventType: EventType.SHARE_CANCELLATION,
    polarity: 'POSITIVE',
    confidence: 0.88,
  },
  // 신탁계약 취득/해지(자기주식 신탁 매입 프로그램 라이프사이클)
  {
    pattern: /신탁계약.*(취득|해지|체결)/,
    eventType: EventType.SHARE_BUYBACK,
    polarity: 'POSITIVE',
    confidence: 0.85,
  },

  // ── 전환청구권 행사·전환/행사/교환가액 조정 ───────────────────────────────
  {
    pattern: /(전환청구권|교환청구권).*행사|(전환가액|행사가액|교환가액).*조정|신주인수권행사가액/,
    eventType: EventType.CONVERTIBLE_EXERCISE,
    polarity: 'UNKNOWN',
    confidence: 0.85,
  },

  // ── 감자(자본감소)·주식병합 ───────────────────────────────────────────────
  {
    pattern: /감자\s*(결정|완료)|자본\s*감소|주식\s*병합/,
    eventType: EventType.CAPITAL_REDUCTION,
    polarity: 'NEGATIVE',
    confidence: 0.85,
  },

  // ── 무상증자 ──────────────────────────────────────────────────────────────
  // (기존 "유상증자" 룰은 위에서 먼저 검사됨. "유무상증자"는 유상증자 토큰 미포함→여기 도달)
  {
    pattern: /무상증자/,
    eventType: EventType.BONUS_ISSUE,
    polarity: 'POSITIVE',
    confidence: 0.85,
  },

  // ── 합병·분할·자산/영업 양수도 (M&A) ──────────────────────────────────────
  {
    pattern: /합병|회사\s*분할|분할합병|물적분할|인적분할|자산양수도|영업양수도|영업양도|자산양도등/,
    eventType: EventType.MERGER_SPLIT,
    polarity: 'MIXED',
    confidence: 0.85,
  },

  // ── 주식매수선택권(스톡옵션) 부여 ─────────────────────────────────────────
  {
    pattern: /주식매수선택권/,
    eventType: EventType.STOCK_OPTION,
    polarity: 'UNKNOWN',
    confidence: 0.85,
  },

  // ── 투자 결정(타법인주식 취득·시설투자·유형/비유동자산 양수도) ────────────
  {
    pattern: /타법인\s*주식|신규\s*시설\s*투자|유형자산\s*(양수|양도|취득)|비유동자산\s*(취득|양수|처분)|투자판단\s*관련/,
    eventType: EventType.INVESTMENT_DECISION,
    polarity: 'MIXED',
    confidence: 0.85,
  },

  // ── 임원·주요주주 특정증권등 소유·거래 보고 (방향 미상) ───────────────────
  // 반드시 EXECUTIVE_CHANGE(임원 변경)보다 먼저 — "임원ㆍ주요주주특정증권등…"
  {
    pattern: /임원.*주요주주.*특정증권|특정증권등\s*(소유상황|거래계획)/,
    eventType: EventType.INSIDER_TRADING_REPORT,
    polarity: 'UNKNOWN',
    confidence: 0.85,
  },

  // ── 최대주주등 소유주식 변동신고 (지배 변경 아님 — 위 MAJOR_SHAREHOLDER_CHANGE와 구분) ──
  {
    pattern: /최대주주등\s*소유주식\s*변동|최대주주등의\s*주식보유\s*변동|주식보유\s*변동/,
    eventType: EventType.OWNERSHIP_DISCLOSURE,
    polarity: 'UNKNOWN',
    confidence: 0.85,
  },

  // ── 임원/대표이사/사외이사 변경 ───────────────────────────────────────────
  {
    pattern: /대표이사\s*변경|사외이사.*(선임|해임|중도퇴임)|임원.*(선임|해임|변경)/,
    eventType: EventType.EXECUTIVE_CHANGE,
    polarity: 'UNKNOWN',
    confidence: 0.80,
  },

  // ── 특수관계인 거래(자금·담보·상품용역)·동일인등 출자계열 거래 ────────────
  // 채무보증/담보 룰보다 먼저 — "특수관계인으로부터자금차입" 등은 특수관계인 거래로 분류
  {
    pattern: /특수관계인|동일인등\s*출자계열/,
    eventType: EventType.RELATED_PARTY_TRANSACTION,
    polarity: 'MIXED',
    confidence: 0.80,
  },

  // ── 채무보증·담보제공·자금/금전 대여·차입 ─────────────────────────────────
  {
    pattern: /채무보증|담보\s*제공|담보\s*취득|자금\s*(대여|차입)|금전\s*대여|차입금\s*증가/,
    eventType: EventType.DEBT_GUARANTEE,
    polarity: 'NEGATIVE',
    confidence: 0.85,
  },

  // ── 대규모기업집단 현황공시 ───────────────────────────────────────────────
  {
    pattern: /대규모기업집단/,
    eventType: EventType.AFFILIATE_GROUP_DISCLOSURE,
    polarity: 'UNKNOWN',
    confidence: 0.80,
  },

  // ── 주주총회·의결권대리행사·주주명부폐쇄/기준일 ───────────────────────────
  {
    pattern: /주주총회|의결권\s*대리행사|주주명부\s*폐쇄|기준일\s*(설정|결정)/,
    eventType: EventType.SHAREHOLDER_MEETING,
    polarity: 'UNKNOWN',
    confidence: 0.80,
  },

  // ── 기업설명회(IR) ────────────────────────────────────────────────────────
  {
    pattern: /기업설명회/,
    eventType: EventType.IR_EVENT,
    polarity: 'UNKNOWN',
    confidence: 0.80,
  },

  // ── 조회공시 요구·답변·풍문/보도 해명 ─────────────────────────────────────
  {
    pattern: /조회공시|풍문또는보도|풍문.*해명/,
    eventType: EventType.INQUIRY_DISCLOSURE,
    polarity: 'MIXED',
    confidence: 0.80,
  },

  // ── 정기/감사 보고 (사업·반기·분기보고서·(연결)감사보고서) ─────────────────
  {
    pattern: /사업보고서|반기보고서|분기보고서|감사보고서/,
    eventType: EventType.PERIODIC_DISCLOSURE,
    polarity: 'UNKNOWN',
    confidence: 0.80,
  },

  // ── 증권 발행/모집 서류 (증권신고서·투자설명서·발행실적·일괄신고·발행결과·자산유동화·파생결합) ──
  {
    pattern: /증권신고서|투자설명서|증권발행\s*실적|일괄신고|증권발행\s*결과|자산유동화|파생결합|소액공모|소액매출|채무증권\s*발행/,
    eventType: EventType.SECURITIES_OFFERING,
    polarity: 'UNKNOWN',
    confidence: 0.80,
  },

  // ── 거래소 기타 시장안내 ──────────────────────────────────────────────────
  // (거래정지/상장폐지 등 리스크 룰은 위에서 먼저 검사됨 — 여기는 잔여 안내성 공시)
  {
    pattern: /기타\s*시장안내|시장조치|기타\s*안내사항/,
    eventType: EventType.MARKET_NOTICE,
    polarity: 'UNKNOWN',
    confidence: 0.80,
  },

  // ════════════════════════════════════════════════════════════════════════
  // DAR-338: DAR-346 후속 — OTHER 재누적분(15530) reportName 재조사 기반 확대
  // 라이브 DB(2026-07-17) OTHER NEEDS_REVIEW reportName 재집계: 기존 룰 커버 3503건(486종,
  // 백로그·reprocess로 해소) 제외 미커버 12027건(701종) 상위 유형. 모두 기존 룰보다
  // *아래(낮은 우선순위)*에 둔다 — 특정 시그널 룰이 항상 우선.
  // confidence 정책은 DAR-346과 동일: 0.85=재료성(AI L1 라우팅) / 0.80 이하=절차성(FAILED, AI 미라우팅).
  // ════════════════════════════════════════════════════════════════════════

  // ── 소송등의 판결ㆍ결정 (제기 명시 없는 잔여) — SHAREHOLDER_MEETING/MERGER_SPLIT
  //    등 위 DAR-346 룰이 "(주주총회…)"·"(합병…)" 부기를 먼저 채가므로 반드시 그 아래에 위치 ──
  {
    pattern: /소송.*(판결|결정)/,
    eventType: EventType.LAWSUIT,
    polarity: 'NEGATIVE',
    confidence: 0.85,
  },

  // ── 회생절차ㆍ해산사유ㆍ불성실공시법인 지정 — DEBT_GUARANTEE/MARKET_NOTICE 등
  //    위 DAR-346 룰이 "담보제공"·"기타시장안내" 부기를 먼저 채가므로 반드시 그 아래에 위치 ──
  {
    pattern: /회생절차|해산사유|불성실공시법인/,
    eventType: EventType.DELISTING_RISK,
    polarity: 'NEGATIVE',
    confidence: 0.85,
  },

  // ── 단일판매ㆍ공급계약 해지("해제/취소"만 잡던 기존 룰의 표기 변형 보강) ·
  //    거래처와의 거래중단 — INQUIRY_DISCLOSURE(조회공시·풍문) 룰이 "~설" 풍문
  //    래핑을 먼저 채가므로 반드시 그 아래에 위치 ──
  {
    pattern: /공급계약.*해지|거래처.*거래\s*중단/,
    eventType: EventType.CONTRACT_CANCELLATION,
    polarity: 'NEGATIVE',
    confidence: 0.85,
  },

  // ── 기업가치제고계획(자율공시) — 밸류업 프로그램, 주주가치 제고 시그널 ──────
  {
    pattern: /기업가치제고계획/,
    eventType: EventType.VALUE_UP_PLAN,
    polarity: 'POSITIVE',
    confidence: 0.85,
  },

  // ── 결산실적공시예고 — 실적 확정 전 예고(안내), 방향 미상(잠정실적 룰보다 아래) ──
  {
    pattern: /결산실적공시예고/,
    eventType: EventType.EARNINGS_PREANNOUNCEMENT,
    polarity: 'UNKNOWN',
    confidence: 0.75,
  },

  // ── 기타경영사항(자율공시)ㆍ지속가능경영보고서 — 자율 경영사항 공시 ─────────
  {
    pattern: /기타경영사항\s*\(자율공시\)|지속가능경영보고서/,
    eventType: EventType.VOLUNTARY_MANAGEMENT_DISCLOSURE,
    polarity: 'MIXED',
    confidence: 0.75,
  },

  // ── 행정ㆍ규제 절차 공시(비재료성) — 지급수단/기간/금액 공시, 계열금융회사
  //    약관거래, 소속부/본점/상호 변경, 공정거래자율준수, SPAC 신탁계약 변경 등 ─────
  // (불성실공시법인 지정 계열은 위 DELISTING_RISK 룰이 먼저 잡는다)
  {
    pattern: /지급수단.*지급기간.*지급금액|약관에\s*의한\s*금융거래|계열금융회사|소속부\s*변경|본점\s*소재지\s*변경|상호\s*변경|공정거래\s*자율준수|기업인수목적회사.*신탁계약/,
    eventType: EventType.REGULATORY_ADMIN_NOTICE,
    polarity: 'UNKNOWN',
    confidence: 0.80,
  },
];

/** 분류 결과 (eventType + 방향성 + 신뢰도). */
export interface EventClassification {
  eventType: EventType;
  polarity: 'POSITIVE' | 'NEGATIVE' | 'MIXED' | 'UNKNOWN';
  confidence: number;
}

/**
 * 보고서명만으로 1차 이벤트 타입 분류 (문서 fetch 불필요·메타데이터 전용, L0 Rule).
 *
 * REPORT_NAME_RULES 정규식 테이블을 순차 적용해 첫 매칭을 채택한다. parsedJson 이
 * 없어도(=원문 미수집) 동작하므로, DART 쿼터 절약을 위한 fetch 우선순위 선별
 * (DAR-394)에서 재사용한다 — classifyEventType 과 동일 SSOT 라 분류 결과가 일관된다.
 *
 * @returns 매칭 시 EventClassification, 미매칭 시 null(호출부가 docType 보완·OTHER 결정).
 */
export function classifyByReportName(
  reportName: string,
): EventClassification | null {
  for (const rule of REPORT_NAME_RULES) {
    if (rule.pattern.test(reportName)) {
      return {
        eventType: rule.eventType,
        polarity: rule.polarity,
        confidence: rule.confidence,
      };
    }
  }
  return null;
}

/**
 * 보고서명 + parsedJson 기반 1차 이벤트 타입 분류
 *
 * 1. reportName 정규식 룰 테이블 순차 적용 (첫 매칭 채택)
 * 2. 매칭 실패 시 parsedJson.docType 활용 2차 보완
 * 3. 여전히 null → EventType.OTHER, confidence 0.40
 *
 * @returns { eventType, polarity, confidence }
 *   confidence: Rule 직접 매칭 ≥ 0.85, docType 보완 0.70, 미매칭 0.40
 */
export function classifyEventType(
  reportName: string,
  parsedJson: ParsedJson,
): EventClassification {
  // 1차: reportName 정규식 룰 테이블 순차 적용
  const byName = classifyByReportName(reportName);
  if (byName) return byName;

  // 2차: parsedJson.docType 보완
  if (parsedJson.docType) {
    const docType = parsedJson.docType;

    const docTypeMapping: Record<
      string,
      { eventType: EventType; polarity: 'POSITIVE' | 'NEGATIVE' | 'MIXED' | 'UNKNOWN' }
    > = {
      SUPPLY_CONTRACT:          { eventType: EventType.SUPPLY_CONTRACT,          polarity: 'POSITIVE' },
      SHARE_BUYBACK:            { eventType: EventType.SHARE_BUYBACK,            polarity: 'POSITIVE' },
      SHARE_CANCELLATION:       { eventType: EventType.SHARE_CANCELLATION,       polarity: 'POSITIVE' },
      DIVIDEND:                 { eventType: EventType.DIVIDEND_INCREASE,        polarity: 'POSITIVE' },
      PAID_IN_CAPITAL_INCREASE: { eventType: EventType.PAID_IN_CAPITAL_INCREASE, polarity: 'NEGATIVE' },
    };

    // CB_BW_ISSUANCE는 bondType으로 CB/BW 구분 (BLOCKER 수정: 항상 CB로 매핑하던 버그)
    if (docType === 'CB_BW_ISSUANCE') {
      const isBw = String(parsedJson.bondType ?? '').toUpperCase() === 'BW';
      return {
        eventType: isBw ? EventType.BW_ISSUANCE : EventType.CB_ISSUANCE,
        polarity: 'NEGATIVE',
        confidence: 0.7,
      };
    }

    const mapped = docTypeMapping[docType];
    if (mapped) {
      return {
        eventType: mapped.eventType,
        polarity: mapped.polarity,
        confidence: 0.70,
      };
    }
  }

  // 3차: 미매칭 → OTHER
  return {
    eventType: EventType.OTHER,
    polarity: 'UNKNOWN',
    confidence: 0.40,
  };
}
