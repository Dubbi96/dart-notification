// backend/src/disclosure-events/extractors/guidance.ts
// 실적 가이던스(자사 전망 공정공시) 수치 추출 파서 (Rule/정규식 전용, AI 미사용)
// W9: '연결재무제표 기준 영업실적 등에 대한 전망(공정공시)'·'장래사업·경영계획(공정공시)' —
//   회사가 스스로 공시한 전망(가이던스)이며 애널리스트 추정 집계가 아니다(정직 라벨링).
//   오추출 수치가 알림으로 나가면 신뢰 훼손이 W9 원죄보다 크다 → 확정 단일 수치일 때만 채우고,
//   범위값('3,000억~3,500억원'·'1조원대')·정성 서술('전년 대비 개선 예상')은 null(UNKNOWN 폴백).
//   confidence 게이팅은 상위 extractors/index.ts calcConfidence(필수 필드 충족률)가 담당한다.

import { ParsedJson } from '../../disclosure-documents/types/parsed-json.type';
import { Table } from '../../disclosure-documents/types/table.type';

export interface GuidanceData {
  guidanceRevenue: number | null;           // 매출액 전망 (원)
  guidanceOperatingProfit: number | null;   // 영업이익 전망 (원, 음수=손실 전망)
  previousRevenue: number | null;           // 전년(직전) 매출액 (원)
  previousOperatingProfit: number | null;   // 전년(직전) 영업이익 (원)
  guidanceRevenueYoY: number | null;        // 파생값: 매출액 전망 YoY (%)
  guidanceOperatingProfitYoY: number | null; // 파생값: 영업이익 전망 YoY (%)
  guidanceDirection: 'UP' | 'DOWN' | 'NEUTRAL' | 'UNKNOWN';
  isRangeValue: boolean;                    // 범위값('~'·'…대') 감지 → 수치 미채움
  isQualitative: boolean;                   // 정성 서술 감지 → 수치 미채움
  derivedDataMissing: boolean;              // 전망 수치를 하나도 못 채웠으면 true
}

/**
 * parsedJson + 원시 표(tables)에서 가이던스 수치를 추출한다.
 *
 * 폴백 순서 (모두 Rule, AI 미사용 — share-buyback DAR-339 패턴 준수):
 *   1) 정형 키 parsedJson.guidanceRevenue / guidanceOperatingProfit
 *   2) 대체 키 — 블롭에 비정형으로 실릴 수 있는 동의 키(expectedRevenue·매출액전망 …)
 *   3) 원시 표(tables) 스캔 — '전망/예상/계획' 헤더 컬럼 또는 라벨 자체가 전망인 행
 *
 * ★신뢰 게이트: 값 셀이 범위값('~', '1조원대', '내외' …)이거나 정성 서술이면
 *   수치를 채우지 않는다(null) — 잘못된 확정 수치보다 UNKNOWN이 낫다.
 */
export function extract(
  parsedJson: ParsedJson,
  reportName: string,
  tables?: Table[],
): GuidanceData {
  try {
    let isRangeValue = false;
    let isQualitative = false;

    // 1) 정형 키
    let guidanceRevenue = finiteOrNull(parsedJson.guidanceRevenue);
    let guidanceOperatingProfit = finiteOrNull(parsedJson.guidanceOperatingProfit);
    let previousRevenue: number | null = null;
    let previousOperatingProfit: number | null = null;

    // 2) 대체 키 (블롭 동의 키) — graceful
    if (guidanceRevenue === null) {
      const alt = readAltValue(parsedJson, ALT_REVENUE_KEYS);
      if (alt.range) isRangeValue = true;
      if (alt.qualitative) isQualitative = true;
      guidanceRevenue = alt.value;
    }
    if (guidanceOperatingProfit === null) {
      const alt = readAltValue(parsedJson, ALT_OP_KEYS);
      if (alt.range) isRangeValue = true;
      if (alt.qualitative) isQualitative = true;
      guidanceOperatingProfit = alt.value;
    }

    // 3) 원시 표 스캔 — 전망 컬럼/전망 라벨 행에서 회수
    const tableSource = resolveTables(parsedJson, tables);
    if (tableSource.length > 0) {
      const scanned = scanGuidanceTables(tableSource);
      if (guidanceRevenue === null) guidanceRevenue = scanned.revenue.value;
      if (guidanceOperatingProfit === null) {
        guidanceOperatingProfit = scanned.operatingProfit.value;
      }
      previousRevenue = scanned.previousRevenue;
      previousOperatingProfit = scanned.previousOperatingProfit;
      isRangeValue = isRangeValue || scanned.revenue.range || scanned.operatingProfit.range;
      isQualitative =
        isQualitative || scanned.revenue.qualitative || scanned.operatingProfit.qualitative;
    }

    // 파생값: 전년 실적이 함께 공시된 경우에만 YoY 산출 (없으면 null — 날조 금지)
    const guidanceRevenueYoY = computeYoY(guidanceRevenue, previousRevenue);
    const guidanceOperatingProfitYoY = computeYoY(
      guidanceOperatingProfit,
      previousOperatingProfit,
    );

    const guidanceDirection = inferDirection(
      guidanceOperatingProfitYoY,
      guidanceRevenueYoY,
      reportName,
    );

    const derivedDataMissing =
      guidanceRevenue === null && guidanceOperatingProfit === null;

    return {
      guidanceRevenue,
      guidanceOperatingProfit,
      previousRevenue,
      previousOperatingProfit,
      guidanceRevenueYoY,
      guidanceOperatingProfitYoY,
      guidanceDirection,
      isRangeValue,
      isQualitative,
      derivedDataMissing,
    };
  } catch {
    return emptyResult();
  }
}

// ─── 범위값·정성 서술 판별 (신뢰 게이트 — export: 유닛 스펙 대상) ─────────────

// 범위 표현: '3,000억~3,500억원', '1조원대', '5% 내외', '전년 수준 안팎', '±3%'
const RANGE_MARKERS =
  /[~∼〜～]|±|내외|안팎|전후|수준|(?:\d\s*(?:조|억|백만|천만|만)?\s*원?\s*대(?:$|[\s)(,]))/;
// 명시적 숫자-숫자 범위 ('3,000 - 3,500'): 음수(-1,200)·날짜와 구분 위해 숫자 양쪽 요구
const NUMERIC_RANGE = /[\d,.]+\s*[-–—]\s*[\d,.]+\s*(?:조|억|백만|천만|만|원|%)/;

/** 범위값 표현이면 true — 수치를 채우면 안 되는 케이스(UNKNOWN 폴백). */
export function isRangeExpression(raw: string): boolean {
  if (typeof raw !== 'string') return false;
  return RANGE_MARKERS.test(raw) || NUMERIC_RANGE.test(raw);
}

/** 정성 서술(숫자 없는 방향 서술 등)이면 true — 수치를 채우면 안 되는 케이스. */
export function isQualitativeExpression(raw: string): boolean {
  if (typeof raw !== 'string') return false;
  const text = raw.trim();
  if (text === '') return false;
  // 숫자가 전혀 없으면 정성 서술 ('전년 대비 개선 예상', '미정' 등)
  if (!/\d/.test(text)) return true;
  // 숫자가 있어도 금액이 아닌 비율·방향 서술('약 10% 성장 목표')은 정성 취급
  if (/%/.test(text) && !/(?:조|억|백만|천만|만|천)?\s*원/.test(text)) return true;
  return false;
}

/**
 * 가이던스 금액 셀 → 원(原) 단위 숫자. 확정 단일 수치일 때만 값 반환.
 * - 범위값·정성 서술 → null (신뢰 게이트)
 * - 음수 표기: '-'·'−'·'△'(DART 관례) 지원
 * - 단위: 조/억/천만/백만/만/천 + unitNote('단위: 백만원' 등) 보정
 * export: 유닛 스펙 대상.
 */
export function parseGuidanceAmount(raw: string, unitNote?: string): number | null {
  if (typeof raw !== 'string') return null;
  const text = raw.replace(/,/g, '').trim();
  if (text === '') return null;
  if (isRangeExpression(raw) || isQualitativeExpression(raw)) return null;

  // 부호 (△=음수 DART 관례)
  let sign = 1;
  let body = text;
  const signMatch = body.match(/^[-−△]\s*/);
  if (signMatch) {
    sign = -1;
    body = body.slice(signMatch[0].length);
  }

  // 복합 단위: '1조 2000억원'
  const compound = body.match(/^([\d.]+)\s*조\s*([\d.]+)\s*억\s*원?$/);
  if (compound) {
    return sign * Math.round(
      parseFloat(compound[1]) * 1_000_000_000_000 + parseFloat(compound[2]) * 100_000_000,
    );
  }

  const unitTable: [RegExp, number][] = [
    [/^([\d.]+)\s*조\s*원?$/, 1_000_000_000_000],
    [/^([\d.]+)\s*억\s*원?$/, 100_000_000],
    [/^([\d.]+)\s*천만\s*원?$/, 10_000_000],
    [/^([\d.]+)\s*백만\s*원?$/, 1_000_000],
    [/^([\d.]+)\s*만\s*원?$/, 10_000],
    [/^([\d.]+)\s*천\s*원?$/, 1_000],
  ];
  for (const [re, mult] of unitTable) {
    const m = body.match(re);
    if (m) return sign * Math.round(parseFloat(m[1]) * mult);
  }

  // 순수 숫자(+선택적 '원') — unitNote 배율 보정
  const plain = body.match(/^([\d.]+)\s*원?$/);
  if (!plain) return null; // 숫자 뒤에 다른 토큰이 붙으면 확정 수치로 신뢰 불가 → null
  let num = parseFloat(plain[1]);
  if (!isFinite(num)) return null;
  if (unitNote) {
    if (/조\s*원/.test(unitNote)) num *= 1_000_000_000_000;
    else if (/억\s*원/.test(unitNote)) num *= 100_000_000;
    else if (/천만\s*원/.test(unitNote)) num *= 10_000_000;
    else if (/백만\s*원/.test(unitNote)) num *= 1_000_000;
    else if (/천\s*원/.test(unitNote)) num *= 1_000;
  }
  return sign * Math.round(num);
}

// ─── 내부 구현 ──────────────────────────────────────────────────────────────

interface CellReadResult {
  value: number | null;
  range: boolean;
  qualitative: boolean;
}

const ALT_REVENUE_KEYS = [
  'expectedRevenue',
  'forecastRevenue',
  'revenueGuidance',
  '매출액전망',
  '매출전망',
] as const;
const ALT_OP_KEYS = [
  'expectedOperatingProfit',
  'forecastOperatingProfit',
  'operatingProfitGuidance',
  '영업이익전망',
] as const;

// 표 라벨 패턴 — '영업이익률(%)' 등 비율 행 오매칭 차단을 위해 률/율 제외
const REVENUE_LABEL = /매출\s*액?(?!.*(률|율))/;
const OP_LABEL = /영업\s*이익(?!\s*률|\s*율)/;
// 전망(당기 예측) 컬럼 헤더 / 전년(비교) 컬럼 헤더
const FORECAST_HEADER = /전망|예상|예측|계획|목표/;
const PREVIOUS_HEADER = /전년|전기|직전|당초|실적/;

/** 블롭 대체 키 조회 — 문자열 값은 신뢰 게이트를 통과할 때만 수치화. */
function readAltValue(
  parsedJson: ParsedJson,
  keys: readonly string[],
): CellReadResult {
  const blob = parsedJson as unknown as Record<string, unknown>;
  for (const key of keys) {
    const raw = blob[key];
    if (raw === null || raw === undefined) continue;
    if (typeof raw === 'number') {
      const v = finiteOrNull(raw);
      if (v !== null) return { value: v, range: false, qualitative: false };
    } else if (typeof raw === 'string') {
      if (isRangeExpression(raw)) return { value: null, range: true, qualitative: false };
      if (isQualitativeExpression(raw)) {
        return { value: null, range: false, qualitative: true };
      }
      const v = parseGuidanceAmount(raw);
      if (v !== null) return { value: v, range: false, qualitative: false };
    }
  }
  return { value: null, range: false, qualitative: false };
}

interface GuidanceTableScan {
  revenue: CellReadResult;
  operatingProfit: CellReadResult;
  previousRevenue: number | null;
  previousOperatingProfit: number | null;
}

/**
 * 원시 표에서 가이던스 수치를 스캔한다.
 * - 헤더에 전망 컬럼이 식별되면 그 컬럼만 신뢰(전년 실적을 전망으로 오채택 방지).
 * - 헤더 미식별이면 라벨 자체가 '…전망'인 행에서, 파싱 가능한 셀이 정확히 1개일 때만 채택
 *   (모호하면 null — 신뢰 게이트).
 */
function scanGuidanceTables(tables: Table[]): GuidanceTableScan {
  const result: GuidanceTableScan = {
    revenue: { value: null, range: false, qualitative: false },
    operatingProfit: { value: null, range: false, qualitative: false },
    previousRevenue: null,
    previousOperatingProfit: null,
  };

  for (const table of tables) {
    const headers = Array.isArray(table.headers) ? table.headers.map(String) : [];
    const rows = Array.isArray(table.rows) ? table.rows : [];
    const forecastCol = headers.findIndex((h) => FORECAST_HEADER.test(h));
    const previousCol = headers.findIndex(
      (h, i) => i !== forecastCol && PREVIOUS_HEADER.test(h),
    );

    for (const row of rows) {
      if (!Array.isArray(row) || row.length < 2) continue;
      const label = String(row[0] ?? '');
      const isRevenue = REVENUE_LABEL.test(label);
      const isOp = !isRevenue && OP_LABEL.test(label);
      if (!isRevenue && !isOp) continue;
      const target = isRevenue ? 'revenue' : 'operatingProfit';
      if (result[target].value !== null) continue;

      let read: CellReadResult = { value: null, range: false, qualitative: false };
      if (forecastCol > 0 && forecastCol < row.length) {
        read = readCell(String(row[forecastCol] ?? ''), table.unitNote);
      } else if (/전망|예상|계획|목표/.test(label)) {
        // key-value 형 표: 라벨 자체가 전망 — 파싱 가능한 셀이 정확히 1개일 때만 채택
        read = readSingleCandidate(row, table.unitNote);
      }
      if (read.value !== null || read.range || read.qualitative) {
        result[target] = read;
      }

      // 전년(비교) 컬럼 — 존재할 때만 (YoY 파생용, 미확보 시 null)
      if (previousCol > 0 && previousCol < row.length) {
        const prev = parseGuidanceAmount(String(row[previousCol] ?? ''), table.unitNote);
        if (isRevenue && result.previousRevenue === null) result.previousRevenue = prev;
        if (isOp && result.previousOperatingProfit === null) {
          result.previousOperatingProfit = prev;
        }
      }
    }
  }
  return result;
}

function readCell(raw: string, unitNote?: string): CellReadResult {
  if (isRangeExpression(raw)) return { value: null, range: true, qualitative: false };
  if (isQualitativeExpression(raw)) return { value: null, range: false, qualitative: true };
  return { value: parseGuidanceAmount(raw, unitNote), range: false, qualitative: false };
}

/** 값 후보 셀(비어있지 않은 셀) 중 파싱 가능한 셀이 정확히 1개일 때만 채택. */
function readSingleCandidate(row: string[], unitNote?: string): CellReadResult {
  let range = false;
  let qualitative = false;
  const parsed: number[] = [];
  for (let i = 1; i < row.length; i++) {
    const cell = String(row[i] ?? '').trim();
    if (cell === '') continue;
    if (isRangeExpression(cell)) {
      range = true;
      continue;
    }
    const v = parseGuidanceAmount(cell, unitNote);
    if (v !== null) parsed.push(v);
    else if (isQualitativeExpression(cell)) qualitative = true;
  }
  if (parsed.length === 1) return { value: parsed[0], range, qualitative };
  return { value: null, range, qualitative };
}

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

function computeYoY(current: number | null, previous: number | null): number | null {
  if (current === null || previous === null || previous === 0) return null;
  return round2(((current - previous) / Math.abs(previous)) * 100);
}

function inferDirection(
  opYoY: number | null,
  revenueYoY: number | null,
  reportName: string,
): 'UP' | 'DOWN' | 'NEUTRAL' | 'UNKNOWN' {
  const yoY = opYoY ?? revenueYoY;
  if (yoY !== null) {
    if (yoY > 0) return 'UP';
    if (yoY < 0) return 'DOWN';
    return 'NEUTRAL';
  }
  // 수치 부재 → 보고서명 키워드 보조 판정 (정정 공시의 '상향/하향' 등)
  if (/상향/.test(reportName)) return 'UP';
  if (/하향/.test(reportName)) return 'DOWN';
  return 'UNKNOWN';
}

function finiteOrNull(raw: number | null | undefined): number | null {
  return typeof raw === 'number' && Number.isFinite(raw) ? raw : null;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function emptyResult(): GuidanceData {
  return {
    guidanceRevenue: null,
    guidanceOperatingProfit: null,
    previousRevenue: null,
    previousOperatingProfit: null,
    guidanceRevenueYoY: null,
    guidanceOperatingProfitYoY: null,
    guidanceDirection: 'UNKNOWN',
    isRangeValue: false,
    isQualitative: false,
    derivedDataMissing: true,
  };
}
