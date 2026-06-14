// backend/src/disclosure-events/extractors/supply-contract.ts
// 단일판매·공급계약 수치 추출 파서 (Rule/정규식 전용, AI 미사용)

import { ParsedJson } from '../../disclosure-documents/types/parsed-json.type';

/**
 * 거래상대방 유형: 이름 키워드로 신뢰 가능한 분류만 노출한다.
 * - DOMESTIC_LARGE: 공정위 대기업집단 등 국내 대기업군 키워드 매칭
 * - FOREIGN: 영문 표기 또는 외국법인 한글약칭(다국적기업 음차) 매칭
 * - UNKNOWN: 위에 해당하지 않음(중소·중견·공공·미상 등 이름만으로 구분 불가)
 *
 * ※ DOMESTIC_SME는 이름만으로 신뢰 분류 불가(국내 비대기업 ≠ 중소기업: 중견·공공기관·
 *   협동조합 등 포함)하여 enum에서 제거했다. 허위 enum 방지(DAR-248).
 */
export type CounterpartyType = 'DOMESTIC_LARGE' | 'FOREIGN' | 'UNKNOWN';

export interface SupplyContractData {
  contractAmount: number | null;       // 계약금액 (원 단위 정규화)
  recentSales: number | null;          // 최근 매출액 (원)
  salesRatio: number | null;           // 파생값: contractAmount / recentSales * 100
  counterparty: string | null;         // 거래상대방
  counterpartyType: CounterpartyType;
  contractStartDate: string | null;    // YYYY-MM-DD
  contractEndDate: string | null;      // YYYY-MM-DD
  contractDurationMonths: number | null; // 파생값: 날짜 차이 (월)
  productOrService: string | null;     // 제품·서비스 설명
  isAmendment: boolean;
  derivedDataMissing: boolean;         // recentSales null 시 true
}

/**
 * parsedJson에서 단일판매·공급계약 수치를 추출한다.
 *
 * 공통 규칙:
 * - parsedJson 필드 직접 매핑 우선 → 없으면 null
 * - 금액 단위 정규화: 이미 parsedJson 내에서 원 단위 정규화됨 (key-value.mapper 책임)
 * - 날짜 정규화: YYYY.MM.DD / YYYY/MM/DD / YYYYMMDD → YYYY-MM-DD
 * - 예외 throw 금지 — try/catch 후 해당 필드 null 처리
 */
export function extract(parsedJson: ParsedJson, _reportName: string): SupplyContractData {
  try {
    const contractAmount = parsedJson.contractAmount ?? null;
    const recentSales = parsedJson.recentSales ?? null;
    const counterparty = parsedJson.counterparty ?? null;
    const contractStartDate = normalizeDate(parsedJson.contractStartDate ?? null);
    const contractEndDate = normalizeDate(parsedJson.contractEndDate ?? null);

    // 파생값: salesRatio
    const salesRatio =
      contractAmount !== null && recentSales !== null && recentSales !== 0
        ? round2(contractAmount / recentSales * 100)
        : null;

    // 파생값: contractDurationMonths
    const contractDurationMonths =
      contractStartDate && contractEndDate
        ? calcDurationMonths(contractStartDate, contractEndDate)
        : null;

    // 거래상대방 유형 추정 (단순 키워드 기반)
    const counterpartyType = inferCounterpartyType(counterparty);

    const derivedDataMissing = recentSales === null;

    return {
      contractAmount,
      recentSales,
      salesRatio,
      counterparty,
      counterpartyType,
      contractStartDate,
      contractEndDate,
      contractDurationMonths,
      productOrService: null, // rawText 추출은 DQ 파서 고도화 단계에서 구현
      isAmendment: false,     // Disclosure.rmk 기반 판별은 서비스 레이어에서 처리
      derivedDataMissing,
    };
  } catch {
    // 파서 오류 시 빈 결과 반환 (throw 금지)
    return emptyResult();
  }
}

// ─── 내부 유틸 ──────────────────────────────────────────────────────────────

/**
 * 날짜 문자열을 YYYY-MM-DD 형식으로 정규화
 * 지원: YYYY.MM.DD / YYYY/MM/DD / YYYYMMDD / YYYY-MM-DD
 */
function normalizeDate(raw: string | null | undefined): string | null {
  if (!raw) return null;
  try {
    // YYYY.MM.DD 또는 YYYY/MM/DD
    const dotSlash = raw.match(/^(\d{4})[./](\d{2})[./](\d{2})$/);
    if (dotSlash) return `${dotSlash[1]}-${dotSlash[2]}-${dotSlash[3]}`;

    // YYYYMMDD
    const compact = raw.match(/^(\d{4})(\d{2})(\d{2})$/);
    if (compact) return `${compact[1]}-${compact[2]}-${compact[3]}`;

    // 이미 YYYY-MM-DD
    if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;

    return null;
  } catch {
    return null;
  }
}

/** 두 날짜 사이의 개월 수 (Math.round) */
function calcDurationMonths(start: string, end: string): number | null {
  try {
    const s = new Date(start);
    const e = new Date(end);
    if (isNaN(s.getTime()) || isNaN(e.getTime())) return null;
    const diffMs = e.getTime() - s.getTime();
    const diffMonths = diffMs / (1000 * 60 * 60 * 24 * 30.4375);
    return Math.round(diffMonths);
  } catch {
    return null;
  }
}

/**
 * 국내 대기업집단(공정위 상호출자제한기업집단 등) 대표 그룹 키워드.
 * 거래상대방명에 그룹명/대표 계열 키워드가 포함되면 DOMESTIC_LARGE로 분류한다.
 * 보수적 포지티브 매칭만 수행(중소·중견은 추정 불가하므로 UNKNOWN 유지).
 */
const DOMESTIC_LARGE_KEYWORDS = [
  '삼성',
  '에스케이',
  '현대자동차',
  '기아',
  '현대모비스',
  '현대중공업',
  '현대건설',
  '엘지',
  '롯데',
  '포스코',
  '한화',
  '지에스',
  '에이치디현대',
  '신세계',
  '씨제이',
  '한진',
  '카카오',
  '엘에스',
  '두산',
  '디엘',
  '에쓰오일',
  '에스오일',
  '현대백화점',
  '금호',
  '효성',
  '하림',
  '영풍',
  '코오롱',
  '오씨아이',
  '교보생명',
  '케이티',
  '케이티앤지',
  '대우건설',
  '셀트리온',
  '네이버',
  '엔에이치엔',
  '미래에셋',
] as const;

/**
 * 외국법인 한글약칭(다국적기업 한글 음차) 키워드.
 * 영문 표기가 없어 Latin 매칭으로 못 잡는 외국법인을 FOREIGN으로 보강한다.
 * '코리아' 접미사 등 국내 법인일 수 있는 모호 키워드는 의도적으로 제외한다.
 */
const FOREIGN_ALIAS_KEYWORDS = [
  '애플',
  '구글',
  '마이크로소프트',
  '아마존',
  '메타',
  '엔비디아',
  '인텔',
  '퀄컴',
  '테슬라',
  '도요타',
  '소니',
  '파나소닉',
  '지멘스',
  '보쉬',
  '바스프',
  '필립스',
  '노키아',
  '에릭슨',
  '화웨이',
  '샤오미',
  '폭스콘',
  '티에스엠시',
  '타이완',
  '베트남',
  '인도네시아',
] as const;

/** 거래상대방명으로 유형 추정 (이름 키워드 기반, 신뢰 가능한 분류만) */
function inferCounterpartyType(name: string | null): CounterpartyType {
  if (!name) return 'UNKNOWN';

  // 1) 국내 대기업군 키워드 (포지티브 매칭) — 영문/외국 키워드보다 우선
  if (DOMESTIC_LARGE_KEYWORDS.some((kw) => name.includes(kw))) {
    return 'DOMESTIC_LARGE';
  }

  // 2) 외국 법인: 영문 표기(Inc., Corp., Ltd. 등) 또는 외국법인 한글약칭
  if (/[A-Za-z]{3,}|Inc\.|Corp\.|Ltd\.|LLC|GmbH/.test(name)) return 'FOREIGN';
  if (FOREIGN_ALIAS_KEYWORDS.some((kw) => name.includes(kw))) return 'FOREIGN';

  // 3) 그 외: 이름만으로 신뢰 분류 불가
  return 'UNKNOWN';
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function emptyResult(): SupplyContractData {
  return {
    contractAmount: null,
    recentSales: null,
    salesRatio: null,
    counterparty: null,
    counterpartyType: 'UNKNOWN',
    contractStartDate: null,
    contractEndDate: null,
    contractDurationMonths: null,
    productOrService: null,
    isAmendment: false,
    derivedDataMissing: true,
  };
}
