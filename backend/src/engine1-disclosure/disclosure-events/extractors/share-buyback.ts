// backend/src/disclosure-events/extractors/share-buyback.ts
// 자기주식 취득·소각 수치 추출 파서 (Rule/정규식 전용, AI 미사용)

import { ParsedJson } from '../../disclosure-documents/types/parsed-json.type';
import { Table } from '../../disclosure-documents/types/table.type';

export interface ShareBuybackData {
  buybackAmount: number | null;        // 취득 금액 (원)
  buybackShares: number | null;        // 취득 주식 수
  buybackRatioToTotal: number | null;  // 파생값: buybackShares / totalIssuedShares * 100
  // DAR-79: 동일 취득금액이라도 기업 규모 대비 임팩트가 다르다 → 정규화 비율.
  //   supply-contract.salesRatio(계약금액/매출) 패턴을 그대로 따른다.
  //   결측(매출/시총 미확보) 시 graceful null.
  buybackRatioToSales: number | null;    // 파생값: buybackAmount / 매출액 * 100 (소수 2자리)
  buybackRatioToMarketCap: number | null; // 파생값: buybackAmount / 시총 * 100 (소수 2자리)
  buybackPriceMax: number | null;      // 취득 단가 상한
  buybackPriceMin: number | null;      // 취득 단가 하한
  buybackPeriodStart: string | null;   // YYYY-MM-DD
  buybackPeriodEnd: string | null;     // YYYY-MM-DD
  acquisitionMethod: string | null;    // 취득 방법
  purpose: string | null;             // 목적
  derivedDataMissing: boolean;         // 정규화 비율(매출/시총)을 하나도 못 구했을 때 true
}

export interface ShareCancellationData {
  cancellationShares: number | null;   // 소각 주식 수
  cancellationAmount: number | null;   // 소각 금액 (원)
  cancellationRatioToTotal: number | null; // 파생값
  purpose: string | null;
  derivedDataMissing: boolean;
}

/** 취득금액 정규화 비율 묶음 (DAR-79). 결측은 null. */
export interface BuybackNormalizedRatios {
  buybackRatioToSales: number | null;
  buybackRatioToMarketCap: number | null;
  /** 매출·시총 어느 것으로도 정규화하지 못했으면 true */
  derivedDataMissing: boolean;
}

/**
 * 취득금액을 매출액·시총 대비 상대지표로 정규화한다 (DAR-79).
 *
 * - 단일 진실원천(SSOT): 추출기(engine1)와 신호생성(engine3)이 동일 공식을 공유하도록 export.
 * - 결측·0·음수 매출/시총은 graceful null (예외 throw 금지).
 * - 한계: 상장주식수 필드가 스키마에 없어 시총은 호출부가 (종가×주식수)로 구해 넘길 때만 산출된다.
 *   parsedJson 단독 추출 경로에서는 시총 입력이 없어 buybackRatioToMarketCap = null.
 */
export function computeBuybackRatios(
  buybackAmount: number | null | undefined,
  revenue: number | null | undefined,
  marketCap: number | null | undefined,
): BuybackNormalizedRatios {
  const amount =
    typeof buybackAmount === 'number' && isFinite(buybackAmount) ? buybackAmount : null;

  const buybackRatioToSales =
    amount !== null && typeof revenue === 'number' && isFinite(revenue) && revenue > 0
      ? round2((amount / revenue) * 100)
      : null;

  const buybackRatioToMarketCap =
    amount !== null && typeof marketCap === 'number' && isFinite(marketCap) && marketCap > 0
      ? round2((amount / marketCap) * 100)
      : null;

  return {
    buybackRatioToSales,
    buybackRatioToMarketCap,
    derivedDataMissing: buybackRatioToSales === null && buybackRatioToMarketCap === null,
  };
}

/**
 * parsedJson에서 자기주식 취득 수치를 추출한다.
 * - totalIssuedShares는 현 parsedJson 스키마에 없으므로 buybackRatioToTotal = null.
 * - DAR-79: buybackAmount를 매출(parsedJson.revenue) 대비로 정규화한다(supply-contract 패턴).
 *   parsedJson에는 시총·상장주식수 필드가 없어 buybackRatioToMarketCap은 null이며,
 *   매출 대비 비율도 매출 결측 시 null(engine3에서 CompanyFinancial로 보강).
 *
 * DAR-339: 취득금액·취득주식수 추출 폴백(데이터커버리지). 분류는 확실하나 수치 0.0 →
 *   FAILED(94건)였던 케이스를 회수한다. 폴백 순서(모두 Rule, AI 미사용):
 *   1) 정형 키 acquisitionAmount/acquisitionShares
 *   2) 대체 키 — parsedJson 블롭에 비정형으로 실릴 수 있는 동의 키
 *      (buybackAmount/repurchaseAmount/취득가액 …)
 *   3) 원시 표(tables) 스캔 — 매퍼가 라벨 변형('취득가액' 등)으로 놓친 값을
 *      DisclosureDocument.tables(영속 원본)에서 직접 회수. 신규 DART 호출 0.
 *   부분 필드(취득금액·주식수 중 하나)만 회수돼도 상위 calcConfidence가 NEEDS_REVIEW
 *   범위(≈0.75)를 산출해 FAILED를 면한다. 모두 결측이면 기존대로 null.
 *
 * @param tables DisclosureDocument.tables(원본 표). 폴백 스캔용. 없으면 parsedJson 내 임베드 표 사용.
 */
export function extract(
  parsedJson: ParsedJson,
  _reportName: string,
  tables?: Table[],
): ShareBuybackData {
  try {
    // 1) 정형 키
    let buybackAmount = finiteOrNull(parsedJson.acquisitionAmount);
    let buybackShares = finiteOrNull(parsedJson.acquisitionShares);

    // 2) 대체 키 (parsedJson 블롭의 동의 키) — graceful
    if (buybackAmount === null) {
      buybackAmount = readAltNumber(parsedJson, ALT_AMOUNT_KEYS, parseAmount);
    }
    if (buybackShares === null) {
      buybackShares = readAltNumber(parsedJson, ALT_SHARES_KEYS, parseShareCount);
    }

    // 3) 원시 표 스캔 (취득가액/취득주식수 등) — 매퍼 라벨 변형 누락분 회수
    const tableSource = resolveTables(parsedJson, tables);
    if (tableSource.length > 0) {
      if (buybackAmount === null) {
        buybackAmount = scanTable(tableSource, AMOUNT_LABEL_PATTERNS, parseAmount);
      }
      if (buybackShares === null) {
        buybackShares = scanTable(tableSource, SHARES_LABEL_PATTERNS, parseShareCount);
      }
    }

    const buybackPeriodStart = normalizeDate(parsedJson.acquisitionStartDate ?? null);
    const buybackPeriodEnd = normalizeDate(parsedJson.acquisitionEndDate ?? null);
    const acquisitionMethod = parsedJson.acquisitionMethod ?? null;

    // 정규화 비율: 매출(parsedJson.revenue)만 추출 경로에서 가용. 시총은 parsedJson 미보유 → null.
    const ratios = computeBuybackRatios(buybackAmount, parsedJson.revenue ?? null, null);

    return {
      buybackAmount,
      buybackShares,
      buybackRatioToTotal: null, // totalIssuedShares 미확보
      buybackRatioToSales: ratios.buybackRatioToSales,
      buybackRatioToMarketCap: ratios.buybackRatioToMarketCap,
      buybackPriceMax: null,     // 표에서 추출 — DQ 파서 고도화 단계에서 구현
      buybackPriceMin: null,
      buybackPeriodStart,
      buybackPeriodEnd,
      acquisitionMethod,
      purpose: null,             // 표에서 추출 — DQ 파서 고도화 단계에서 구현
      derivedDataMissing: ratios.derivedDataMissing,
    };
  } catch {
    return emptyBuybackResult();
  }
}

/**
 * parsedJson에서 자기주식 소각 수치를 추출한다.
 */
export function extractCancellation(
  parsedJson: ParsedJson,
  _reportName: string,
): ShareCancellationData {
  try {
    const cancellationShares = parsedJson.cancellationShares ?? null;
    const cancellationAmount = parsedJson.cancellationAmount ?? null;
    const derivedDataMissing = true; // totalIssuedShares 미확보

    return {
      cancellationShares,
      cancellationAmount,
      cancellationRatioToTotal: null, // totalIssuedShares 미확보
      purpose: null,
      derivedDataMissing,
    };
  } catch {
    return emptyCancellationResult();
  }
}

// ─── DAR-339 폴백 상수 ───────────────────────────────────────────────────────

// 대체 키: 매퍼가 acquisitionAmount/Shares로 쓰지 못한 케이스에서 블롭에 실릴 수 있는 동의 키.
const ALT_AMOUNT_KEYS = [
  'buybackAmount',
  'repurchaseAmount',
  'treasuryAcquisitionAmount',
  '취득가액',
  '취득금액',
] as const;
const ALT_SHARES_KEYS = [
  'buybackShares',
  'repurchaseShares',
  'treasuryAcquisitionShares',
  '취득주식수',
] as const;

// 원시 표 라벨 패턴. 단가('취득단가'/'예정단가')·주당 항목과 충돌하지 않도록 특정.
const AMOUNT_LABEL_PATTERNS: RegExp[] = [
  /취득\s*예정\s*(금액|가액)/,
  /취득\s*(금액|가액|총액)/,
];
const SHARES_LABEL_PATTERNS: RegExp[] = [
  /취득\s*예정\s*(주식\s*등?\s*)?수/,
  /취득\s*예정\s*주식/,
  /취득\s*(주식\s*등?\s*)?수/,
  /취득\s*수량/,
];

// ─── 내부 유틸 ──────────────────────────────────────────────────────────────

/**
 * 폴백 스캔에 사용할 표 배열을 해석한다.
 * - 우선순위: 명시 인자(tables, DisclosureDocument.tables 영속 원본)
 * - 차선: parsedJson 블롭에 임베드된 tables (방어적 — 일부 레거시/외부 경로 대비)
 */
function resolveTables(parsedJson: ParsedJson, tables?: Table[]): Table[] {
  if (Array.isArray(tables)) return tables.filter(isTableLike);
  const embedded = (parsedJson as { tables?: unknown }).tables;
  if (Array.isArray(embedded)) return embedded.filter(isTableLike);
  return [];
}

function isTableLike(t: unknown): t is Table {
  return (
    typeof t === 'object' &&
    t !== null &&
    Array.isArray((t as { rows?: unknown }).rows)
  );
}

/**
 * 표 배열에서 라벨 패턴에 매칭되는 행을 찾아 값 셀을 파서로 변환한다.
 * - 라벨=셀0 가정. 자기주식 취득표는 구분 컬럼('보통주식' 등)이 끼어 값이 셀1이 아닐 수 있어,
 *   셀1부터 끝까지 순회해 파서로 변환되는 첫 셀을 채택(findValueByLabel보다 관대).
 */
function scanTable(
  tables: Table[],
  patterns: RegExp[],
  parse: (raw: string, unitNote?: string) => number | null,
): number | null {
  for (const table of tables) {
    const headers = Array.isArray(table.headers) ? table.headers : [];
    const rows = Array.isArray(table.rows) ? table.rows : [];
    const allRows = headers.length > 0 ? [headers, ...rows] : rows;
    for (const row of allRows) {
      if (!Array.isArray(row) || row.length < 2) continue;
      const labelCell = String(row[0] ?? '');
      if (!patterns.some((p) => p.test(labelCell))) continue;
      for (let i = 1; i < row.length; i++) {
        const cell = String(row[i] ?? '').trim();
        if (cell === '') continue;
        const parsed = parse(cell, table.unitNote);
        if (parsed !== null) return parsed;
      }
    }
  }
  return null;
}

/** parsedJson 블롭에서 대체 키를 순서대로 조회해 첫 유효값을 파서로 변환한다. */
function readAltNumber(
  parsedJson: ParsedJson,
  keys: readonly string[],
  parse: (raw: string, unitNote?: string) => number | null,
): number | null {
  const blob = parsedJson as unknown as Record<string, unknown>;
  for (const key of keys) {
    const raw = blob[key];
    if (raw === null || raw === undefined) continue;
    if (typeof raw === 'number') {
      const v = finiteOrNull(raw);
      if (v !== null) return v;
    } else if (typeof raw === 'string') {
      const v = parse(raw);
      if (v !== null) return v;
    }
  }
  return null;
}

/**
 * 한국 금액 문자열 → 원(原) 단위 숫자. ('1,200억원' → 120000000000)
 * key-value.mapper.parseKoreanAmount의 축약형(추출기 자립 유지 — 매퍼 런타임 비의존).
 */
function parseAmount(raw: string, unitNote?: string): number | null {
  if (typeof raw !== 'string') return null;
  const text = raw.replace(/,/g, '').trim();
  const unitTable: [RegExp, number][] = [
    [/^([\d.]+)\s*억\s*원?/, 100_000_000],
    [/^([\d.]+)\s*천만\s*원?/, 10_000_000],
    [/^([\d.]+)\s*백만\s*원?/, 1_000_000],
    [/^([\d.]+)\s*만\s*원?/, 10_000],
    [/^([\d.]+)\s*천\s*원?/, 1_000],
  ];
  for (const [re, mult] of unitTable) {
    const m = text.match(re);
    if (m) return Math.round(parseFloat(m[1]) * mult);
  }
  const numMatch = text.match(/^([\d.]+)/);
  if (!numMatch) return null;
  let num = parseFloat(numMatch[1]);
  if (!isFinite(num)) return null;
  if (unitNote) {
    if (/백만\s*원/.test(unitNote)) num *= 1_000_000;
    else if (/억\s*원/.test(unitNote)) num *= 100_000_000;
    else if (/천만\s*원/.test(unitNote)) num *= 10_000_000;
    else if (/천\s*원/.test(unitNote)) num *= 1_000;
  }
  return Math.round(num);
}

/** 주식 수 문자열 → 정수. 쉼표 제거 후 파싱(단위 보정 없음). */
function parseShareCount(raw: string): number | null {
  if (typeof raw !== 'string') return null;
  const m = raw.replace(/,/g, '').trim().match(/^([\d.]+)/);
  if (!m) return null;
  const num = parseFloat(m[1]);
  return isFinite(num) ? Math.round(num) : null;
}

function finiteOrNull(raw: number | null | undefined): number | null {
  return typeof raw === 'number' && Number.isFinite(raw) ? raw : null;
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

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function emptyBuybackResult(): ShareBuybackData {
  return {
    buybackAmount: null,
    buybackShares: null,
    buybackRatioToTotal: null,
    buybackRatioToSales: null,
    buybackRatioToMarketCap: null,
    buybackPriceMax: null,
    buybackPriceMin: null,
    buybackPeriodStart: null,
    buybackPeriodEnd: null,
    acquisitionMethod: null,
    purpose: null,
    derivedDataMissing: true,
  };
}

function emptyCancellationResult(): ShareCancellationData {
  return {
    cancellationShares: null,
    cancellationAmount: null,
    cancellationRatioToTotal: null,
    purpose: null,
    derivedDataMissing: true,
  };
}
