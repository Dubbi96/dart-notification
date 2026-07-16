// backend/src/notifications/push-body-template.ts
// DAR-525 (Wave B/B4·P1) — 푸시 본문 '한 줄 판단' 표준 SSOT.
//
// 목표: 잠금화면 1줄을 제품으로. 열지 않아도 가치를 전달하는 표준 본문:
//   '수주 1,200억 — 유사공시 D+5 평균 +2.1% (n=142)'
//   = <이벤트 리드(유형별 팩트)> — <유사공시 반응 통계 문구>
//
// 이 파일은 순수(I/O·시각·DI 없음). 결정론 단위테스트(push-body-template.spec.ts)로 고정한다.
// 통계 문구의 원천은 Wave A 유사공시 반응 통계(DAR-511 disclosure-reaction-stats)의 페이로드를
// 그대로 재사용한다(별도 재계산 금지 — SSOT).
//
// 수용기준 매핑:
//   (1) n<MIN_SAMPLE_SIZE(=30) → 통계 문구 자동 생략(정직 규약 승계 — 소표본 허수 미노출).
//   (2) 본문 길이 제한(Android/iOS 트렁케이션) 처리 — 가치문구(통계) 보존 우선 트렁케이션.
//   (3) 유형별 리드 템플릿(EVENT_PUSH_LEAD_LABEL/…_FACT) 문서화 + 단위테스트.
//   (4) 에디션 푸시(DAR-523)부터 적용 — 본 모듈을 edition-push 가 소비. 공시·PRICE_MOVE 는 점진.

import { EVENT_TYPE_NOTIFICATION_COPY } from './event-type-copy';

// ─── 이벤트 리드(유형별 팩트 문구) ─────────────────────────────────────

/**
 * 유형별 '한 줄 판단' 리드 라벨(핵심 수치 팩트가 없을 때 쓰는 간결 라벨).
 *
 * 모바일 표기 SSOT(`mobile/utils/disclosureType.ts` EVENT_TYPE_LABEL)와 의미를 맞추되,
 * 잠금화면 1줄 밀도를 위해 push 용으로 간결화했다. 실적류(EARNINGS_*)는 판정 기준(전년동기 대비/
 * 자사 전망)을 반드시 병기해야 시장 기대치 대비 판정으로 오인되지 않으므로 `event-type-copy.ts`
 * 의 정직 카피(EVENT_TYPE_NOTIFICATION_COPY)를 그대로 재사용한다(드리프트 0).
 */
export const EVENT_PUSH_LEAD_LABEL: Record<string, string> = {
  // ── 우선 추출 7종 ──
  SUPPLY_CONTRACT: '공급계약',
  SHARE_BUYBACK: '자사주 취득',
  SHARE_CANCELLATION: '자사주 소각',
  DIVIDEND_INCREASE: '배당 확대',
  PAID_IN_CAPITAL_INCREASE: '유상증자',
  CB_ISSUANCE: '전환사채 발행',
  BW_ISSUANCE: '신주인수권부사채 발행',
  // ── 확장/리스크 ──
  CONTRACT_CANCELLATION: '공급계약 해제·취소',
  DIVIDEND_CUT: '배당 축소·중단',
  THIRD_PARTY_ALLOTMENT: '제3자배정 유상증자',
  // 실적류는 정직 기준 병기(SSOT: event-type-copy.ts) — 아래 병합으로 주입.
  MAJOR_SHAREHOLDER_CHANGE: '최대주주 변경',
  LAWSUIT: '소송·횡령·배임',
  AUDIT_OPINION_RISK: '감사의견 거절·한정',
  TRADING_SUSPENSION: '거래정지',
  DELISTING_RISK: '상장폐지 위험',
  // ── 지분변동 3종 ──
  INSIDER_BUY: '내부자 매수',
  INSIDER_SELL: '내부자 매도',
  MAJOR_HOLDER_5PCT: '5% 대량보유',
  // ── 확장 이벤트(OTHER 축소) ──
  INSIDER_TRADING_REPORT: '임원·주요주주 거래 보고',
  SECURITIES_OFFERING: '증권 발행',
  PERIODIC_DISCLOSURE: '정기공시',
  SHAREHOLDER_MEETING: '주주총회',
  IR_EVENT: 'IR·기업설명회',
  RELATED_PARTY_TRANSACTION: '특수관계자 거래',
  AFFILIATE_GROUP_DISCLOSURE: '기업집단(계열) 공시',
  OWNERSHIP_DISCLOSURE: '지분·소유권 공시',
  DEBT_GUARANTEE: '채무보증',
  CAPITAL_REDUCTION: '감자',
  BONUS_ISSUE: '무상증자',
  MERGER_SPLIT: '합병·분할',
  INVESTMENT_DECISION: '신규 투자 결정',
  STOCK_OPTION: '주식매수선택권 부여',
  EXECUTIVE_CHANGE: '임원 변동',
  INQUIRY_DISCLOSURE: '조회공시',
  MARKET_NOTICE: '시장 안내·조치',
  CONVERTIBLE_EXERCISE: '전환권·신주인수권 행사',
  // EARNINGS_* 는 정직 카피로 병합(아래).
  ...EVENT_TYPE_NOTIFICATION_COPY,
};

/**
 * 유형별 '동사형 + 팩트' 리드 빌더(핵심 수치 팩트가 있을 때).
 * 예: SUPPLY_CONTRACT + '1,200억' → '수주 1,200억'.
 * 미등록 유형은 라벨 형태로 폴백(라벨 + 공백 + 팩트)한다.
 */
const EVENT_PUSH_FACT_LEAD: Record<string, (fact: string) => string> = {
  SUPPLY_CONTRACT: (f) => `수주 ${f}`,
  SHARE_BUYBACK: (f) => `자사주 매입 ${f}`,
  SHARE_CANCELLATION: (f) => `자사주 소각 ${f}`,
  PAID_IN_CAPITAL_INCREASE: (f) => `유상증자 ${f}`,
  CB_ISSUANCE: (f) => `전환사채 ${f}`,
  BW_ISSUANCE: (f) => `신주인수권부사채 ${f}`,
  INVESTMENT_DECISION: (f) => `투자 결정 ${f}`,
  DEBT_GUARANTEE: (f) => `채무보증 ${f}`,
};

/** 이벤트 리드 조립 입력. */
export interface EventLeadInput {
  /** DisclosureEvent.eventType(enum 문자열). */
  eventType?: string | null;
  /** 유형별 핵심 수치 팩트(선택) — 예: '1,200억'(금액), '10%'(비율). 이미 표기 완성 문자열. */
  factText?: string | null;
}

/**
 * 이벤트 유형 → '한 줄 판단' 리드 문구.
 *   - 팩트 있음 + 동사형 템플릿 등록: '수주 1,200억' 등.
 *   - 팩트 있음 + 동사형 미등록: '<라벨> <팩트>'.
 *   - 팩트 없음: '<라벨>'(간결 라벨).
 *   - eventType 미상/미등록 + 팩트 없음: undefined(리드 생략 — 무리한 표기 금지, 정직).
 */
export function buildEventLead(input: EventLeadInput): string | undefined {
  const eventType = input.eventType ?? undefined;
  const fact = normalizeFact(input.factText);
  const label = eventType ? EVENT_PUSH_LEAD_LABEL[eventType] : undefined;

  if (fact) {
    const verb = eventType ? EVENT_PUSH_FACT_LEAD[eventType] : undefined;
    if (verb) return verb(fact);
    if (label) return `${label} ${fact}`;
    return fact; // 라벨 미상이라도 팩트는 그대로 노출(예: '수주 1,200억' 원문 caller 조립).
  }
  return label;
}

/** 팩트 정규화 — 공백/빈문자 → undefined(빈 팩트로 '라벨 ' 꼬리 공백 방지). */
function normalizeFact(fact?: string | null): string | undefined {
  if (!fact) return undefined;
  const trimmed = fact.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

// ─── 금액 표기 헬퍼(억/조 단위 한국어 축약) ─────────────────────────────

const EOK = 100_000_000; // 1억
const JO = 1_000_000_000_000; // 1조

/**
 * 원(KRW) 금액 → 한국어 축약 표기('1,200억' / '1.2조' / '3,400만').
 * 공시 금액 팩트('수주 1,200억')의 결정론 조립용. 음수·비유한수는 undefined.
 * 조 단위는 소수 1자리(1.2조), 억/만 단위는 천단위 구분 정수.
 */
export function formatKoreanAmountShort(won: number): string | undefined {
  if (!Number.isFinite(won) || won < 0) return undefined;
  if (won >= JO) {
    const jo = won / JO;
    // 정확히 정수 조는 소수점 생략(2조), 아니면 1자리(1.2조).
    const text = Number.isInteger(jo) ? `${jo}` : `${Math.round(jo * 10) / 10}`;
    return `${text}조`;
  }
  if (won >= EOK) {
    return `${Math.round(won / EOK).toLocaleString('ko-KR')}억`;
  }
  if (won >= 10_000) {
    return `${Math.round(won / 10_000).toLocaleString('ko-KR')}만`;
  }
  return `${Math.round(won).toLocaleString('ko-KR')}원`;
}

// ─── 유사공시 반응 통계 문구 ───────────────────────────────────────────

/** 반응 통계 지평 라벨. */
export type ReactionHorizonLabel = 'D+1' | 'D+5' | 'D+20';

/**
 * 통계 문구 조립 입력 — Wave A disclosure-reaction-stats 페이로드에서 발췌한 값 그대로.
 * (재계산 금지: avgReturnPct 는 서비스가 산출한 D+N 누적 평균 단순수익률[%].)
 */
export interface ReactionStatInput {
  horizon: ReactionHorizonLabel;
  /** D+N 누적 평균 단순수익률(%) — 예: 2.1. */
  avgReturnPct: number;
  /** 표본수 n. */
  sampleCount: number;
  /** 노출 게이트 최소 표본수(=DisclosureReactionStatsService.MIN_SAMPLE_SIZE, 30). */
  minSampleSize: number;
}

/**
 * 유사공시 반응 통계 문구 — '유사공시 D+5 평균 +2.1% (n=142)'.
 *
 * ★수용기준 1(정직 규약 승계): n<minSampleSize 이면 null 을 반환해 문구를 통째 생략한다.
 *   소표본에서 '평균 +X%'를 노출하면 허수(승률 100% n=3 류)가 되므로 Wave A 노출 게이트
 *   (n≥30)와 동일 임계를 재사용한다. avgReturnPct 가 비유한수여도 생략(방어적).
 */
export function buildReactionStatPhrase(
  input: ReactionStatInput | null | undefined,
): string | null {
  if (!input) return null;
  const { horizon, avgReturnPct, sampleCount, minSampleSize } = input;
  if (!Number.isFinite(avgReturnPct)) return null;
  if (!Number.isFinite(sampleCount) || sampleCount < minSampleSize) return null;
  return `유사공시 ${horizon} 평균 ${formatSignedPct(avgReturnPct)} (n=${sampleCount})`;
}

/** 부호 명시 퍼센트(소수 1자리) — +2.1% / -0.8% / 0.0%. */
function formatSignedPct(pct: number): string {
  const rounded = Math.round(pct * 10) / 10;
  const magnitude = `${Math.abs(rounded).toFixed(1)}%`;
  if (rounded > 0) return `+${magnitude}`;
  if (rounded < 0) return `-${magnitude}`;
  return magnitude; // 0.0% 는 부호 없음.
}

// ─── 본문 조립 + 길이 트렁케이션 ───────────────────────────────────────

/**
 * 푸시 본문 길이 상한(문자 수). Android/iOS 잠금화면 트렁케이션 안전선.
 *
 * 근거: FCM 페이로드 상한(4KB)은 훨씬 크지만 잠금화면·collapsed 뷰는 훨씬 좁다. 표준 본문
 *   ('수주 1,200억 — 유사공시 D+5 평균 +2.1% (n=142)' ≈ 34자)은 이 상한에 여유롭게 들어가며,
 *   상한은 이례적으로 긴 리드(예: 아주 긴 기업명 + '외 N곳')에서 폭주를 막는 보수적 컷이다.
 *   트렁케이션은 가치문구(통계)를 보존하고 리드를 줄이는 방향으로만 동작한다(buildOneLineJudgmentBody).
 */
export const PUSH_BODY_MAX_LENGTH = 110;

/** 트렁케이션 말줄임(1문자). */
const ELLIPSIS = '…';

/** 리드/꼬리 결합 구분자. 통계 문구는 em dash, 대체 꼬리는 middot(가독 구분). */
const STAT_SEPARATOR = ' — ';
const FALLBACK_SEPARATOR = ' · ';

export interface OneLineJudgmentInput {
  /** 이벤트 리드(팩트/유형 라벨을 caller 가 조립한 문구). 예: '삼성전자 공급계약 외 4곳'. */
  lead: string;
  /** 통계 문구(buildReactionStatPhrase 산출). null 이면 fallbackTail 사용. */
  statPhrase?: string | null;
  /** 통계가 없을 때 리드 뒤에 붙일 대체 꼬리(선택). 예: '매수 후보 5곳'. */
  fallbackTail?: string | null;
  /** 본문 상한(기본 PUSH_BODY_MAX_LENGTH). */
  maxLength?: number;
}

export interface OneLineJudgmentResult {
  /** 완성 본문. */
  body: string;
  /** 통계 문구가 실제로 포함됐는가(가치문구 노출 여부). */
  statsIncluded: boolean;
  /** 길이 상한으로 트렁케이션이 일어났는가. */
  truncated: boolean;
}

/**
 * '한 줄 판단' 본문 조립(수용기준 2 — 길이 트렁케이션 포함).
 *
 *   통계 있음: '<lead> — <statPhrase>'. 상한 초과 시 ★통계 문구는 온전히 보존하고 리드만
 *     말줄임한다(가치문구 우선). 리드 자리가 1자도 안 남는 극단은 통계를 떨구고 리드만 컷.
 *   통계 없음: '<lead> · <fallbackTail>'(또는 lead 단독). 상한 초과 시 전체를 컷.
 */
export function buildOneLineJudgmentBody(input: OneLineJudgmentInput): OneLineJudgmentResult {
  const maxLength = input.maxLength ?? PUSH_BODY_MAX_LENGTH;
  const lead = input.lead.trim();
  const statPhrase = input.statPhrase ?? null;

  if (statPhrase) {
    const reserved = STAT_SEPARATOR.length + statPhrase.length;
    const leadBudget = maxLength - reserved;
    if (lead.length <= leadBudget) {
      return { body: `${lead}${STAT_SEPARATOR}${statPhrase}`, statsIncluded: true, truncated: false };
    }
    if (leadBudget >= 2) {
      // 리드 말줄임 + 통계 온전 보존(가치문구 우선).
      const truncatedLead = `${lead.slice(0, leadBudget - 1)}${ELLIPSIS}`;
      return {
        body: `${truncatedLead}${STAT_SEPARATOR}${statPhrase}`,
        statsIncluded: true,
        truncated: true,
      };
    }
    // 통계까지 넣으면 리드가 사라지는 극단 → 통계를 떨구고 리드만 컷(방어적).
    return { body: truncate(lead, maxLength), statsIncluded: false, truncated: true };
  }

  const tail = normalizeFact(input.fallbackTail);
  const candidate = tail ? `${lead}${FALLBACK_SEPARATOR}${tail}` : lead;
  if (candidate.length <= maxLength) {
    return { body: candidate, statsIncluded: false, truncated: false };
  }
  return { body: truncate(candidate, maxLength), statsIncluded: false, truncated: true };
}

/** 문자열을 상한 이내로 말줄임(상한 초과 시 마지막 1문자를 …로). */
function truncate(s: string, maxLength: number): string {
  if (s.length <= maxLength) return s;
  if (maxLength <= 1) return ELLIPSIS.slice(0, Math.max(0, maxLength));
  return `${s.slice(0, maxLength - 1)}${ELLIPSIS}`;
}
