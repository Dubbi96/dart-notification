// backend/src/disclosure-events/extractors/cb-bw.ts
// 전환사채(CB)·신주인수권부사채(BW) 수치 추출 파서 (Rule/정규식 전용, AI 미사용)

import { ParsedJson } from '../../disclosure-documents/types/parsed-json.type';

/**
 * 전환가액 회수 경로 (DAR-341): conversionPrice 직접조회만으로 희석지표 결손되던
 * CB/BW 공시를 복구한다.
 * - DIRECT  : parsedJson.conversionPrice 직접 매핑(정상 경로)
 * - ALT_KEY : 표 대체키(전환가액/행사가/전환가격/행사가격) 스캔으로 회수
 * - DERIVED : 기초주가(referencePrice) × (1 + 할증률) 유도
 * - NONE    : 어떤 경로로도 전환가액 미회수(희석지표 null → 상위 NEEDS_REVIEW)
 */
export type ConversionPriceSource = 'DIRECT' | 'ALT_KEY' | 'DERIVED' | 'NONE';

/**
 * 발행금액 회수 경로 (DAR-341): issuanceAmount 직접조회만으로 FAILED 되던
 * CB/BW 공시를 복구한다.
 * - DIRECT      : parsedJson.issuanceAmount 직접 매핑(정상 경로)
 * - ALT_KEY     : 표 대체키(발행총액/사채총액/권면총액/모집총액 등) 스캔으로 회수
 * - REPORT_NAME : 보고서명 괄호 금액('전환사채권 발행결정(123억원)'→123억)에서 회수
 * - NONE        : 어떤 경로로도 발행금액 미회수(여전히 FAILED → 상위 NEEDS_REVIEW)
 */
export type TotalAmountSource = 'DIRECT' | 'ALT_KEY' | 'REPORT_NAME' | 'NONE';

export interface CbBwData {
  bondType: 'CB' | 'BW';                    // 사채 유형
  totalAmount: number | null;               // 발행 금액 (원)
  totalAmountSource: TotalAmountSource;      // 발행금액 회수 경로 (DAR-341)
  interestRate: number | null;              // 이자율 (소수점 4자리, 예: 0.0)
  maturityDate: string | null;              // 만기일 YYYY-MM-DD
  conversionPrice: number | null;           // 전환가액 (원/주)
  conversionPriceSource: ConversionPriceSource; // 전환가액 회수 경로 (DAR-341)
  conversionPremiumRate: number | null;     // 파생값: (conversionPrice - referencePrice) / referencePrice * 100
  refixClause: boolean | null;              // 리픽싱 조항 여부
  earlyRedemptionDate: string | null;       // 조기상환 청구 가능일 YYYY-MM-DD
  allottee: string | null;                  // 발행 대상자
  allotteeType: 'INSTITUTIONAL' | 'INDIVIDUAL' | 'RELATED_PARTY' | 'UNKNOWN';
  maxDilutionShares: number | null;         // 파생값: floor(totalAmount / conversionPrice)
  maxDilutionRate: number | null;           // 파생값: maxDilutionShares / existingShares * 100
  derivedDataMissing: boolean;
}

/** 리픽싱 조항 관련 키워드 패턴 */
const REFIX_PATTERN = /리픽스|리픽싱|전환가액\s*조정|행사가액\s*조정/;

/**
 * 전환가액 대체 키(런타임 JSON 블롭에 미매핑 원시 라벨이 잔존할 수 있음).
 * 의미가 더 직접적인 키를 앞에 둔다. 영문/한글 라벨 모두 방어적으로 스캔한다.
 */
const ALT_CONVERSION_PRICE_KEYS = [
  '전환가액',
  '전환가격',
  '전환가',
  '행사가액',
  '행사가격',
  '행사가',
  'exercisePrice',
] as const;

/**
 * 기초주가(전환가액 산정 기준 주가) 대체 키. DERIVED 유도에 사용.
 */
const REFERENCE_PRICE_KEYS = [
  '기초주가',
  '기준주가',
  '기준가격',
  '산정기준가',
  '산정기준주가',
  'referencePrice',
] as const;

/**
 * 전환가액 할증률(또는 할인율) 대체 키. DERIVED 유도 시 (1 + 할증률) 계수.
 */
const CONVERSION_PREMIUM_KEYS = [
  '할증률',
  '할증율',
  '전환가액할증률',
  '전환프리미엄',
  'premiumRate',
  'conversionPremiumRate',
] as const;

/**
 * 발행금액 대체 키.
 */
const ALT_TOTAL_AMOUNT_KEYS = [
  '발행총액',
  '사채총액',
  '사채발행금액',
  '권면총액',
  '권면(전자등록)총액',
  '모집총액',
  '발행규모',
  '발행금액',
  '사채금액',
  'issuanceAmount',
] as const;

/**
 * parsedJson에서 CB/BW 수치를 추출한다.
 *
 * 파생값:
 *   conversionPremiumRate = (conversionPrice - referencePrice) / referencePrice * 100
 *   maxDilutionShares     = floor(totalAmount / conversionPrice)
 *   maxDilutionRate       = maxDilutionShares / existingShares * 100
 *
 * 회수 폴백(DAR-341): 직접 매핑 결손 시 대체키·기초주가 유도·보고서명으로 복구한다.
 *   1) totalAmount     : DIRECT → ALT_KEY → REPORT_NAME
 *   2) conversionPrice : DIRECT → ALT_KEY → DERIVED(기초주가×(1+할증률))
 */
export function extract(parsedJson: ParsedJson, reportName: string): CbBwData {
  try {
    const raw = parsedJson as unknown as Record<string, unknown>;

    // bondType: parsedJson.bondType 기반 (CB/BW/EB)
    const rawBondType = parsedJson.bondType ?? null;
    const bondType: 'CB' | 'BW' =
      rawBondType === 'BW' ? 'BW' : 'CB'; // EB 포함 나머지는 CB로 분류

    const { amount: totalAmount, source: totalAmountSource } = resolveTotalAmount(
      parsedJson,
      raw,
      reportName,
    );
    const { price: conversionPrice, source: conversionPriceSource, referencePrice } =
      resolveConversionPrice(parsedJson, raw);
    const maturityDate = normalizeDate(parsedJson.maturityDate ?? null);

    // interestRate: parsedJson 내 소수점 값 그대로 저장 (예: 0.0)
    const interestRate = parsedJson.interestRate ?? null;

    // refixClause: parsedJson 키워드 탐지 대상 없음 → rawText 미제공 → null
    // (고도화 단계에서 rawText 스캔으로 구현)
    const refixClause: boolean | null = null;

    // conversionPremiumRate: 기초주가가 회수된 경우에만 산출
    //   (DIRECT/ALT_KEY 전환가 + 기초주가 → 실제 할증, DERIVED는 유도 할증을 그대로 반영)
    const conversionPremiumRate =
      conversionPrice !== null && referencePrice !== null && referencePrice !== 0
        ? round2(((conversionPrice - referencePrice) / referencePrice) * 100)
        : null;

    // maxDilutionShares: floor(totalAmount / conversionPrice)
    const maxDilutionShares =
      totalAmount !== null && conversionPrice !== null && conversionPrice !== 0
        ? Math.floor(totalAmount / conversionPrice)
        : null;

    // maxDilutionRate: maxDilutionShares / existingShares * 100
    // existingShares는 현재 parsedJson 스키마에 없음 → null
    const maxDilutionRate: number | null = null;

    const derivedDataMissing =
      maxDilutionRate === null; // existingShares 미확보

    return {
      bondType,
      totalAmount,
      totalAmountSource,
      interestRate,
      maturityDate,
      conversionPrice,
      conversionPriceSource,
      conversionPremiumRate,
      refixClause,
      earlyRedemptionDate: null,    // 표 추출 — 고도화 단계
      allottee: null,               // 표 추출 — 고도화 단계
      allotteeType: 'UNKNOWN',
      maxDilutionShares,
      maxDilutionRate,
      derivedDataMissing,
    };
  } catch {
    return emptyResult();
  }
}

// ─── 회수 폴백 ───────────────────────────────────────────────────────────────

/**
 * 발행금액을 DIRECT → ALT_KEY → REPORT_NAME 순으로 회수한다.
 * 어느 경로로도 양수 금액을 얻지 못하면 NONE.
 */
function resolveTotalAmount(
  parsedJson: ParsedJson,
  raw: Record<string, unknown>,
  reportName: string,
): { amount: number | null; source: TotalAmountSource } {
  // 1) DIRECT: 표준 매핑 필드
  const direct = coerceAmount(parsedJson.issuanceAmount);
  if (direct !== null) return { amount: direct, source: 'DIRECT' };

  // 2) ALT_KEY: 미매핑 원시 라벨 스캔
  for (const key of ALT_TOTAL_AMOUNT_KEYS) {
    const alt = coerceAmount(raw[key]);
    if (alt !== null) return { amount: alt, source: 'ALT_KEY' };
  }

  // 3) REPORT_NAME: 보고서명 괄호 금액
  const fromName = extractAmountFromReportName(reportName);
  if (fromName !== null) return { amount: fromName, source: 'REPORT_NAME' };

  return { amount: null, source: 'NONE' };
}

/**
 * 전환가액을 DIRECT → ALT_KEY → DERIVED 순으로 회수한다.
 * DERIVED: 기초주가 × (1 + 할증률). 할증률 결측 시 0(= 기초주가 floor) 가정.
 * referencePrice는 conversionPremiumRate 산출에 재사용하기 위해 함께 반환한다.
 */
function resolveConversionPrice(
  parsedJson: ParsedJson,
  raw: Record<string, unknown>,
): { price: number | null; source: ConversionPriceSource; referencePrice: number | null } {
  const referencePrice = firstPrice(raw, REFERENCE_PRICE_KEYS);

  // 1) DIRECT: 표준 매핑 필드
  const direct = coercePrice(parsedJson.conversionPrice);
  if (direct !== null) return { price: direct, source: 'DIRECT', referencePrice };

  // 2) ALT_KEY: 미매핑 원시 라벨 스캔
  const alt = firstPrice(raw, ALT_CONVERSION_PRICE_KEYS);
  if (alt !== null) return { price: alt, source: 'ALT_KEY', referencePrice };

  // 3) DERIVED: 기초주가 × (1 + 할증률)
  if (referencePrice !== null) {
    const premium = firstPremium(raw, CONVERSION_PREMIUM_KEYS) ?? 0;
    const derived = Math.round(referencePrice * (1 + premium));
    if (derived > 0) return { price: derived, source: 'DERIVED', referencePrice };
  }

  return { price: null, source: 'NONE', referencePrice };
}

/** 키 목록을 순회하며 첫 양수 가격을 회수 */
function firstPrice(
  raw: Record<string, unknown>,
  keys: readonly string[],
): number | null {
  for (const key of keys) {
    const v = coercePrice(raw[key]);
    if (v !== null) return v;
  }
  return null;
}

/** 키 목록을 순회하며 첫 할증률(비율)을 회수 */
function firstPremium(
  raw: Record<string, unknown>,
  keys: readonly string[],
): number | null {
  for (const key of keys) {
    const v = coercePremiumRatio(raw[key]);
    if (v !== null) return v;
  }
  return null;
}

// ─── 강제 변환 유틸 ──────────────────────────────────────────────────────────

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
 * 값을 원/주 양수 단가로 강제 변환. 숫자/문자열('4,500원/주') 허용.
 * 0·음수·파싱불가 → null.
 */
function coercePrice(value: unknown): number | null {
  if (typeof value === 'number') {
    return Number.isFinite(value) && value > 0 ? Math.round(value) : null;
  }
  if (typeof value === 'string') {
    const t = value.replace(/[,\s]/g, '');
    const m = t.match(/^(\d+(?:\.\d+)?)/);
    if (m) {
      const n = Math.round(parseFloat(m[1]));
      return n > 0 ? n : null;
    }
  }
  return null;
}

/**
 * 할증률을 비율(소수)로 강제 변환. 숫자/문자열('10%', '0.1') 허용.
 * 백분율 표기(|값| > 1)는 100으로 나눠 비율로 정규화한다.
 * 비율 ≤ -1(=음수 단가 유발)이면 무효 → null.
 */
function coercePremiumRatio(value: unknown): number | null {
  let n: number | null = null;
  if (typeof value === 'number') {
    n = value;
  } else if (typeof value === 'string') {
    const t = value.replace(/[,\s%]/g, '');
    const m = t.match(/^(-?\d+(?:\.\d+)?)/);
    if (m) n = parseFloat(m[1]);
  }
  if (n === null || !Number.isFinite(n)) return null;
  const ratio = Math.abs(n) > 1 ? n / 100 : n;
  return ratio > -1 ? ratio : null;
}

/**
 * 한국 금액 토큰 → 원 단위 숫자. 조/억/백만/천만/만/원 및 콤마 허용.
 * 양수만 인정(0·음수·미인식 → null).
 */
function parseKoreanAmountLoose(token: string): number | null {
  if (!token) return null;
  const t = token.replace(/[,\s]/g, '');

  // 조 + (선택)억 결합: 1조2000억
  const joEok = t.match(/^(\d+(?:\.\d+)?)조(?:(\d+(?:\.\d+)?)억)?/);
  if (joEok) {
    const jo = parseFloat(joEok[1]) * 1_000_000_000_000;
    const eok = joEok[2] ? parseFloat(joEok[2]) * 100_000_000 : 0;
    return positive(Math.round(jo + eok));
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
 * 보고서명에서 금액을 추출한다. 예: '전환사채권 발행결정(123억원)' → 12,300,000,000.
 * - 괄호 안 토큰을 우선 탐색(보고서명 금액 표기는 통상 괄호 안)
 * - 단위(조/억/백만/천만/만/원)가 붙은 토큰만 인정 → 일자·차수 등 단순 숫자 오추출 방지
 */
function extractAmountFromReportName(reportName: string | null | undefined): number | null {
  if (!reportName) return null;
  try {
    const amountToken = /(\d[\d,]*(?:\.\d+)?\s*(?:조|억|백만|천만|만|원))/;

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

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function normalizeDate(raw: string | null | undefined): string | null {
  if (!raw) return null;
  try {
    const dotSlash = raw.match(/^(\d{4})[./](\d{2})[./](\d{2})$/);
    if (dotSlash) return `${dotSlash[1]}-${dotSlash[2]}-${dotSlash[3]}`;
    const compact = raw.match(/^(\d{4})(\d{2})(\d{2})$/);
    if (compact) return `${compact[1]}-${compact[2]}-${compact[3]}`;
    if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
    return null;
  } catch {
    return null;
  }
}

function emptyResult(): CbBwData {
  return {
    bondType: 'CB',
    totalAmount: null,
    totalAmountSource: 'NONE',
    interestRate: null,
    maturityDate: null,
    conversionPrice: null,
    conversionPriceSource: 'NONE',
    conversionPremiumRate: null,
    refixClause: null,
    earlyRedemptionDate: null,
    allottee: null,
    allotteeType: 'UNKNOWN',
    maxDilutionShares: null,
    maxDilutionRate: null,
    derivedDataMissing: true,
  };
}

// REFIX_PATTERN을 외부에서 사용할 수 있도록 export
export { REFIX_PATTERN };
