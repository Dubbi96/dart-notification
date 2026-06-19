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

/**
 * 계약금액 출처(DAR-342): contractAmount 직접조회만으로 FAILED 되던 공급계약 57건 복구.
 * - DIRECT: parsedJson.contractAmount 직접 매핑(정상 경로)
 * - ALT_KEY: 표 헤더 대체키(판매금액/수주금액/매출액 등) 스캔으로 회수
 * - REPORT_NAME: 보고서명 괄호 금액('단일판매공급계약(123억원)'→123억)에서 회수
 * - NONE: 어떤 경로로도 금액 미회수(여전히 FAILED → 상위 NEEDS_REVIEW)
 */
export type ContractAmountSource = 'DIRECT' | 'ALT_KEY' | 'REPORT_NAME' | 'NONE';

export interface SupplyContractData {
  contractAmount: number | null;       // 계약금액 (원 단위 정규화)
  contractAmountSource: ContractAmountSource; // 계약금액 회수 경로 (DAR-342)
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
 *
 * 계약금액 회수 폴백(DAR-342): contractAmount 직접조회만으로 결측 시 FAILED 되던 공급계약 복구.
 *   1) DIRECT     : parsedJson.contractAmount
 *   2) ALT_KEY    : 표 헤더 대체키(계약금액/판매금액/수주금액/매출액) 스캔 — docType 오분류(판매/수주)로
 *                   계약금액이 다른 라벨에 들어가 매핑 누락된 경우 회수
 *   3) REPORT_NAME: 보고서명 괄호 금액('단일판매공급계약(123억원)'→123억) 정규식 추출
 */
export function extract(parsedJson: ParsedJson, _reportName: string): SupplyContractData {
  try {
    const { amount: contractAmount, source: contractAmountSource } =
      resolveContractAmount(parsedJson, _reportName);
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
      contractAmountSource,
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

// ─── 계약금액 회수 폴백 (DAR-342) ───────────────────────────────────────────

/**
 * 표 헤더 대체키: docType 오분류(판매/수주)나 라벨 변형으로 계약금액이 표준
 * contractAmount 필드에 매핑되지 못한 경우, parsedJson에 잔존할 수 있는 대체
 * 헤더 키를 우선순위대로 스캔한다. 계약금액 의미가 더 직접적인 키를 앞에 둔다.
 * (매출액은 회사 연매출이 아닌 '판매·공급 계약 매출' 라벨일 때를 위한 최후 후보)
 */
const ALT_CONTRACT_AMOUNT_KEYS = [
  '계약금액',
  '총계약금액',
  '판매금액',
  '공급금액',
  '수주금액',
  '계약규모',
  '매출액',
] as const;

/**
 * 계약금액을 DIRECT → ALT_KEY → REPORT_NAME 순으로 회수한다.
 * 어느 경로로도 양수 금액을 얻지 못하면 NONE.
 */
function resolveContractAmount(
  parsedJson: ParsedJson,
  reportName: string,
): { amount: number | null; source: ContractAmountSource } {
  // 1) DIRECT: 표준 매핑 필드
  const direct = coerceAmount(parsedJson.contractAmount);
  if (direct !== null) return { amount: direct, source: 'DIRECT' };

  // 2) ALT_KEY: 대체 헤더 키 스캔 (런타임 JSON에는 미매핑 원시 키가 잔존할 수 있음)
  const raw = parsedJson as unknown as Record<string, unknown>;
  for (const key of ALT_CONTRACT_AMOUNT_KEYS) {
    const alt = coerceAmount(raw[key]);
    if (alt !== null) return { amount: alt, source: 'ALT_KEY' };
  }

  // 3) REPORT_NAME: 보고서명 괄호 금액 정규식
  const fromName = extractAmountFromReportName(reportName);
  if (fromName !== null) return { amount: fromName, source: 'REPORT_NAME' };

  return { amount: null, source: 'NONE' };
}

/**
 * 값을 원(原) 단위 양수 금액으로 강제 변환. 숫자/문자열 모두 허용.
 * 0·음수·NaN·파싱불가 → null.
 */
function coerceAmount(value: unknown): number | null {
  if (typeof value === 'number') {
    return Number.isFinite(value) && value > 0 ? Math.round(value) : null;
  }
  if (typeof value === 'string') {
    return parseKoreanAmountLoose(value);
  }
  return null;
}

/**
 * 한국 금액 토큰 → 원 단위 숫자. 조/억/백만/천만/만/원 및 콤마 허용.
 * 양수만 인정(0·음수·미인식 → null). key-value.mapper.parseKoreanAmount의
 * 보고서명 폴백 전용 경량 버전(조 단위·조+억 결합 추가 지원).
 */
function parseKoreanAmountLoose(token: string): number | null {
  if (!token) return null;
  const t = token.replace(/[,\s]/g, '');

  // 조 + (선택)억 결합: 1조2000억
  const joEok = t.match(/^(\d+(?:\.\d+)?)조(?:(\d+(?:\.\d+)?)억)?/);
  if (joEok) {
    const jo = parseFloat(joEok[1]) * 1_000_000_000_000;
    const eok = joEok[2] ? parseFloat(joEok[2]) * 100_000_000 : 0;
    const v = Math.round(jo + eok);
    return v > 0 ? v : null;
  }
  const eok = t.match(/^(\d+(?:\.\d+)?)억/);
  if (eok) return positive(Math.round(parseFloat(eok[1]) * 100_000_000));

  const cheonman = t.match(/^(\d+(?:\.\d+)?)천만/);
  if (cheonman) return positive(Math.round(parseFloat(cheonman[1]) * 10_000_000));

  const baekman = t.match(/^(\d+(?:\.\d+)?)백만/);
  if (baekman) return positive(Math.round(parseFloat(baekman[1]) * 1_000_000));

  const man = t.match(/^(\d+(?:\.\d+)?)만/);
  if (man) return positive(Math.round(parseFloat(man[1]) * 10_000));

  // 순수 숫자(+선택 '원')
  const won = t.match(/^(\d+)원?$/);
  if (won) return positive(parseInt(won[1], 10));

  return null;
}

function positive(n: number): number | null {
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * 보고서명에서 금액을 추출한다. 예: '단일판매·공급계약체결(123억원)' → 12,300,000,000.
 * - 괄호 안 토큰을 우선 탐색(보고서명 금액 표기는 통상 괄호 안)
 * - 단위(조/억/백만/천만/만/원)가 붙은 토큰만 인정 → 일자·차수 등 단순 숫자 오추출 방지
 */
function extractAmountFromReportName(reportName: string | null | undefined): number | null {
  if (!reportName) return null;
  try {
    // 조+억 결합('1조2000억')을 단일 토큰으로 먼저 포착, 아니면 단일 단위 토큰
    const amountToken =
      /(\d[\d,]*(?:\.\d+)?\s*조(?:\s*\d[\d,]*(?:\.\d+)?\s*억)?|\d[\d,]*(?:\.\d+)?\s*(?:억|백만|천만|만|원))/;

    // 1) 괄호 안 우선
    const parenMatches = reportName.match(/\(([^)]*)\)/g) ?? [];
    for (const seg of parenMatches) {
      const m = seg.match(amountToken);
      if (m) {
        const amt = parseKoreanAmountLoose(m[1]);
        if (amt !== null) return amt;
      }
    }

    // 2) 보고서명 전체에서 탐색
    const whole = reportName.match(amountToken);
    if (whole) {
      const amt = parseKoreanAmountLoose(whole[1]);
      if (amt !== null) return amt;
    }
    return null;
  } catch {
    return null;
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
    contractAmountSource: 'NONE',
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
