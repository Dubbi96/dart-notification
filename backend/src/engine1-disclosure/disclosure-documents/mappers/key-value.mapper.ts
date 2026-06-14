// backend/src/disclosure-documents/mappers/key-value.mapper.ts
// 공시 유형별 Table[] → ParsedJson key-value 변환 (Rule 기반, AI 없음)

import { Table } from '../types/table.type';
import { ParsedJson } from '../types/parsed-json.type';
import { InvestmentEventType } from '../../disclosures/constants/disclosure-types.constant';
import { computeDilutionRate } from '../utils/dilution.util';

// ─── 라벨 패턴 상수 ──────────────────────────────────────────────────────────

const SUPPLY_CONTRACT_PATTERNS: Record<string, RegExp[]> = {
  contractAmount: [/계약\s*금액/, /총\s*계약\s*금액/, /계약\s*규모/],
  recentSales: [/최근\s*매출액/, /직전\s*년도\s*매출/, /전년도\s*매출/],
  counterparty: [/계약\s*상대방/, /거래\s*상대방/, /계약\s*체결\s*회사/],
  contractStartDate: [/계약\s*(기간|시작일?)/, /납품\s*기간/, /계약\s*시작/],
  contractEndDate: [/계약\s*종료일?/, /납품\s*완료일?/],
};

const SHARE_BUYBACK_PATTERNS: Record<string, RegExp[]> = {
  acquisitionMethod: [/취득\s*방법/, /취득\s*방식/],
  acquisitionShares: [
    /취득\s*예정\s*(주식\s*)?수/,
    /취득\s*수량/,
    /취득\s*주식\s*수/,
  ],
  acquisitionAmount: [/취득\s*예정\s*금액/, /취득\s*총액/, /취득\s*금액/],
  acquisitionStartDate: [/취득\s*예정\s*기간/, /취득\s*시작일?/],
  acquisitionEndDate: [/취득\s*종료일?/, /처분\s*기간/],
};

const SHARE_CANCELLATION_PATTERNS: Record<string, RegExp[]> = {
  cancellationShares: [
    /소각\s*예정\s*(주식\s*)?수/,
    /소각\s*주식수/,
    /소각\s*수량/,
  ],
  cancellationAmount: [/소각\s*예정\s*금액/, /소각\s*총액/],
  acquisitionMethod: [/소각\s*방법/, /취득\s*방법/],
  acquisitionStartDate: [/취득\s*예정\s*기간/, /취득\s*시작일?/],
  acquisitionEndDate: [/취득\s*종료일?/],
};

const DIVIDEND_PATTERNS: Record<string, RegExp[]> = {
  dividendPerShare: [/주당\s*배당금/, /1주당\s*배당금/, /배당금\s*\(주당\)/],
  dividendTotal: [/배당금\s*총액/, /배당\s*총액/, /현금배당금액/],
  dividendRecordDate: [/배당\s*기준일/, /기준일/],
  dividendYield: [/배당\s*성향/, /배당\s*수익률/],
};

const PAID_IN_CAPITAL_PATTERNS: Record<string, RegExp[]> = {
  issueMethod: [/증자\s*방식/, /발행\s*방법/, /모집\s*방법/],
  newShares: [
    /신주\s*발행\s*(주식\s*)?수/,
    /발행\s*주식\s*수/,
    /모집\s*주식\s*수/,
  ],
  fundingAmount: [/발행\s*금액/, /증자\s*금액/, /조달\s*금액/],
  discountRate: [/할인율/, /청약\s*가격\s*할인/],
  existingShares: [/기존\s*발행\s*주식\s*수/, /현재\s*발행\s*총\s*주식\s*수/],
};

const CB_BW_PATTERNS: Record<string, RegExp[]> = {
  issuanceAmount: [/발행\s*(총)?금액/, /사채\s*금액/, /발행\s*규모/],
  interestRate: [/표면\s*이자율/, /쿠폰\s*금리/, /이자율/],
  conversionPrice: [/전환가(액)?/, /전환\s*가격/, /행사\s*가격/],
  // /만기일?/ 는 '만기 이자율' 같은 라벨에도 매칭되어 오추출 → '만기일' 명시
  maturityDate: [/만기일/, /만기\s*일자/, /상환\s*기일/],
};

// ─── 숫자·날짜 정규화 유틸 ───────────────────────────────────────────────────

/**
 * 한국 금액 문자열 → 원(原) 단위 숫자로 변환 (KV-02)
 * 예: "120,000,000,000 원" → 120000000000
 *     "1,200억원" → 120000000000
 */
export function parseKoreanAmount(raw: string, unitNote?: string): number | undefined {
  if (!raw) return undefined;

  let text = raw.replace(/,/g, '').trim();

  // 억 단위
  const eokmatch = text.match(/^([\d.]+)\s*억\s*(원)?/);
  if (eokmatch) return Math.round(parseFloat(eokmatch[1]) * 100_000_000);

  // 천만 단위
  const cheonmanMatch = text.match(/^([\d.]+)\s*천만\s*(원)?/);
  if (cheonmanMatch) return Math.round(parseFloat(cheonmanMatch[1]) * 10_000_000);

  // 백만 단위
  const baekmanMatch = text.match(/^([\d.]+)\s*백만\s*(원)?/);
  if (baekmanMatch) return Math.round(parseFloat(baekmanMatch[1]) * 1_000_000);

  // 만 단위
  const manMatch = text.match(/^([\d.]+)\s*만\s*(원)?/);
  if (manMatch) return Math.round(parseFloat(manMatch[1]) * 10_000);

  // 천 단위
  const cheonMatch = text.match(/^([\d.]+)\s*천\s*(원)?/);
  if (cheonMatch) return Math.round(parseFloat(cheonMatch[1]) * 1_000);

  // 순수 숫자
  const numMatch = text.match(/^([\d.]+)/);
  if (numMatch) {
    let num = parseFloat(numMatch[1]);
    // unitNote 단위 적용
    if (unitNote) {
      if (/백만원/.test(unitNote)) num *= 1_000_000;
      else if (/억원/.test(unitNote)) num *= 100_000_000;
      else if (/천만원/.test(unitNote)) num *= 10_000_000;
      else if (/천원/.test(unitNote)) num *= 1_000;
    }
    return isNaN(num) ? undefined : Math.round(num);
  }

  return undefined;
}

/**
 * 날짜 문자열 → ISO 형식(YYYY-MM-DD) (KV-03)
 */
export function parseDate(raw: string): string | undefined {
  if (!raw) return undefined;
  const text = raw.trim();

  // YYYYMMDD
  const m1 = text.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (m1) return `${m1[1]}-${m1[2]}-${m1[3]}`;

  // YYYY.MM.DD 또는 YYYY-MM-DD
  const m2 = text.match(/^(\d{4})[.\-](\d{1,2})[.\-](\d{1,2})/);
  if (m2)
    return `${m2[1]}-${m2[2].padStart(2, '0')}-${m2[3].padStart(2, '0')}`;

  // YYYY년 M월 D일
  const m3 = text.match(/(\d{4})\s*년\s*(\d{1,2})\s*월\s*(\d{1,2})\s*일?/);
  if (m3)
    return `${m3[1]}-${m3[2].padStart(2, '0')}-${m3[3].padStart(2, '0')}`;

  return undefined;
}

/**
 * 숫자 문자열 파싱 (쉼표 제거 후 parseFloat)
 */
function parseNumber(raw: string): number | undefined {
  if (!raw) return undefined;
  const cleaned = raw.replace(/,/g, '').trim();
  const num = parseFloat(cleaned);
  return isNaN(num) ? undefined : num;
}

// ─── 라벨 매칭 알고리즘 ──────────────────────────────────────────────────────

/**
 * 표 배열에서 특정 라벨 패턴에 매칭되는 값을 추출한다 (KV-01)
 *
 * @returns { value: string, tableIndex: number } | null
 */
function findValueByLabel(
  tables: Table[],
  patterns: RegExp[],
): { value: string; tableIndex: number; unitNote?: string } | null {
  for (const table of tables) {
    const allRows = [
      ...(table.headers.length > 0 ? [table.headers] : []),
      ...table.rows,
    ];
    for (const row of allRows) {
      if (row.length < 2) continue;
      const labelCell = row[0];
      if (patterns.some((p) => p.test(labelCell))) {
        // 값 후보: 셀[1], 또는 셀[2]가 숫자를 포함하면 셀[2]
        const val1 = row[1] ?? '';
        const val2 = row[2] ?? '';
        const value =
          val1.trim() === '' || (!val1.trim() && val2.trim())
            ? val2
            : val1;
        if (value.trim()) {
          return {
            value: value.trim(),
            tableIndex: table.tableIndex,
            unitNote: table.unitNote,
          };
        }
      }
    }
  }
  return null;
}

// ─── 이벤트 타입별 매핑 함수 ─────────────────────────────────────────────────

function mapSupplyContract(
  tables: Table[],
  rawTableCount: number,
): ParsedJson {
  const result: ParsedJson = {
    docType: 'SUPPLY_CONTRACT',
    rawTableCount,
    keyValueSource: 'none',
  };

  let sourceTableIndex: number | undefined;

  for (const [field, patterns] of Object.entries(SUPPLY_CONTRACT_PATTERNS)) {
    const found = findValueByLabel(tables, patterns);
    if (!found) continue;
    if (sourceTableIndex === undefined) sourceTableIndex = found.tableIndex;

    switch (field) {
      case 'contractAmount':
        result.contractAmount = parseKoreanAmount(found.value, found.unitNote);
        break;
      case 'recentSales':
        result.recentSales = parseKoreanAmount(found.value, found.unitNote);
        break;
      case 'counterparty':
        result.counterparty = found.value;
        break;
      case 'contractStartDate':
        // "YYYY.MM.DD ~ YYYY.MM.DD" 형식에서 앞 날짜 추출
        result.contractStartDate = parseDate(found.value.split(/[~～]/)[0].trim());
        if (found.value.includes('~') || found.value.includes('～')) {
          const endPart = found.value.split(/[~～]/)[1]?.trim();
          if (endPart) result.contractEndDate = parseDate(endPart);
        }
        break;
      case 'contractEndDate':
        if (!result.contractEndDate) {
          result.contractEndDate = parseDate(found.value);
        }
        break;
    }
  }

  // salesRatio 계산
  if (result.contractAmount && result.recentSales && result.recentSales > 0) {
    result.salesRatio =
      Math.round((result.contractAmount / result.recentSales) * 10000) / 10000;
  }

  if (sourceTableIndex !== undefined) {
    result.keyValueSource = `table_${sourceTableIndex}`;
  }

  return result;
}

function mapShareBuyback(tables: Table[], rawTableCount: number): ParsedJson {
  const result: ParsedJson = {
    docType: 'SHARE_BUYBACK',
    rawTableCount,
    keyValueSource: 'none',
  };

  let sourceTableIndex: number | undefined;

  for (const [field, patterns] of Object.entries(SHARE_BUYBACK_PATTERNS)) {
    const found = findValueByLabel(tables, patterns);
    if (!found) continue;
    if (sourceTableIndex === undefined) sourceTableIndex = found.tableIndex;

    switch (field) {
      case 'acquisitionMethod':
        result.acquisitionMethod = found.value;
        break;
      case 'acquisitionShares':
        result.acquisitionShares = parseNumber(found.value);
        break;
      case 'acquisitionAmount':
        result.acquisitionAmount = parseKoreanAmount(found.value, found.unitNote);
        break;
      case 'acquisitionStartDate':
        result.acquisitionStartDate = parseDate(
          found.value.split(/[~～]/)[0].trim(),
        );
        if (found.value.includes('~') || found.value.includes('～')) {
          const endPart = found.value.split(/[~～]/)[1]?.trim();
          if (endPart) result.acquisitionEndDate = parseDate(endPart);
        }
        break;
      case 'acquisitionEndDate':
        if (!result.acquisitionEndDate)
          result.acquisitionEndDate = parseDate(found.value);
        break;
    }
  }

  if (sourceTableIndex !== undefined) {
    result.keyValueSource = `table_${sourceTableIndex}`;
  }

  return result;
}

function mapShareCancellation(
  tables: Table[],
  rawTableCount: number,
): ParsedJson {
  const result: ParsedJson = {
    docType: 'SHARE_CANCELLATION',
    rawTableCount,
    keyValueSource: 'none',
  };

  let sourceTableIndex: number | undefined;

  for (const [field, patterns] of Object.entries(SHARE_CANCELLATION_PATTERNS)) {
    const found = findValueByLabel(tables, patterns);
    if (!found) continue;
    if (sourceTableIndex === undefined) sourceTableIndex = found.tableIndex;

    switch (field) {
      case 'cancellationShares':
        result.cancellationShares = parseNumber(found.value);
        break;
      case 'cancellationAmount':
        result.cancellationAmount = parseKoreanAmount(found.value, found.unitNote);
        break;
      case 'acquisitionMethod':
        result.acquisitionMethod = found.value;
        break;
      case 'acquisitionStartDate':
        result.acquisitionStartDate = parseDate(
          found.value.split(/[~～]/)[0].trim(),
        );
        break;
      case 'acquisitionEndDate':
        result.acquisitionEndDate = parseDate(found.value);
        break;
    }
  }

  if (sourceTableIndex !== undefined) {
    result.keyValueSource = `table_${sourceTableIndex}`;
  }

  return result;
}

function mapDividend(tables: Table[], rawTableCount: number): ParsedJson {
  const result: ParsedJson = {
    docType: 'DIVIDEND',
    rawTableCount,
    keyValueSource: 'none',
  };

  let sourceTableIndex: number | undefined;

  for (const [field, patterns] of Object.entries(DIVIDEND_PATTERNS)) {
    const found = findValueByLabel(tables, patterns);
    if (!found) continue;
    if (sourceTableIndex === undefined) sourceTableIndex = found.tableIndex;

    switch (field) {
      case 'dividendPerShare':
        result.dividendPerShare = parseKoreanAmount(found.value, found.unitNote);
        break;
      case 'dividendTotal':
        result.dividendTotal = parseKoreanAmount(found.value, found.unitNote);
        break;
      case 'dividendRecordDate':
        result.dividendRecordDate = parseDate(found.value);
        break;
      case 'dividendYield':
        result.dividendYield = parseNumber(found.value);
        break;
    }
  }

  if (sourceTableIndex !== undefined) {
    result.keyValueSource = `table_${sourceTableIndex}`;
  }

  return result;
}

function mapPaidInCapital(
  tables: Table[],
  rawTableCount: number,
): ParsedJson {
  const result: ParsedJson = {
    docType: 'PAID_IN_CAPITAL_INCREASE',
    rawTableCount,
    keyValueSource: 'none',
  };

  let sourceTableIndex: number | undefined;

  for (const [field, patterns] of Object.entries(PAID_IN_CAPITAL_PATTERNS)) {
    const found = findValueByLabel(tables, patterns);
    if (!found) continue;
    if (sourceTableIndex === undefined) sourceTableIndex = found.tableIndex;

    switch (field) {
      case 'issueMethod':
        result.issueMethod = found.value;
        break;
      case 'newShares':
        result.newShares = parseNumber(found.value);
        break;
      case 'fundingAmount':
        result.fundingAmount = parseKoreanAmount(found.value, found.unitNote);
        break;
      case 'discountRate':
        result.discountRate = parseNumber(found.value);
        break;
      case 'existingShares':
        result.existingShares = parseNumber(found.value);
        break;
    }
  }

  // 희석률 계산 (SSOT: DAR-246 — 신주/(기존+신주)*100, %)
  const dilutionRate = computeDilutionRate(
    result.newShares,
    result.existingShares,
  );
  if (dilutionRate !== null) {
    result.dilutionRate = dilutionRate;
  }

  if (sourceTableIndex !== undefined) {
    result.keyValueSource = `table_${sourceTableIndex}`;
  }

  return result;
}

function mapCbBw(
  tables: Table[],
  rawTableCount: number,
  rawText?: string,
): ParsedJson {
  const result: ParsedJson = {
    docType: 'CB_BW_ISSUANCE',
    rawTableCount,
    keyValueSource: 'none',
  };

  // CB/BW 구분
  const searchText = (rawText ?? '').slice(0, 500);
  if (/전환사채|CB[\s(]/.test(searchText)) result.bondType = 'CB';
  else if (/신주인수권부사채|BW[\s(]/.test(searchText)) result.bondType = 'BW';
  else if (/교환사채|EB[\s(]/.test(searchText)) result.bondType = 'EB';

  let sourceTableIndex: number | undefined;

  for (const [field, patterns] of Object.entries(CB_BW_PATTERNS)) {
    const found = findValueByLabel(tables, patterns);
    if (!found) continue;
    if (sourceTableIndex === undefined) sourceTableIndex = found.tableIndex;

    switch (field) {
      case 'issuanceAmount':
        result.issuanceAmount = parseKoreanAmount(found.value, found.unitNote);
        break;
      case 'interestRate':
        result.interestRate = parseNumber(found.value);
        break;
      case 'conversionPrice':
        result.conversionPrice = parseKoreanAmount(found.value, found.unitNote);
        break;
      case 'maturityDate':
        result.maturityDate = parseDate(found.value);
        break;
    }
  }

  if (sourceTableIndex !== undefined) {
    result.keyValueSource = `table_${sourceTableIndex}`;
  }

  return result;
}

// ─── 퍼블릭 함수 ─────────────────────────────────────────────────────────────

/**
 * 공시 유형별 Table[] → ParsedJson key-value 변환
 *
 * @param tables    table.parser.ts 추출 결과
 * @param eventType classifyInvestmentEventType() 반환값
 * @param rawText   본문 텍스트 (CB/BW 구분 등에 활용, 선택)
 * @returns ParsedJson (매핑 실패 시 { docType, rawTableCount, keyValueSource: 'none' })
 */
export function mapKeyValues(
  tables: Table[],
  eventType: InvestmentEventType,
  rawText?: string,
): ParsedJson {
  const rawTableCount = tables.length;

  switch (eventType) {
    case 'SUPPLY_CONTRACT':
      return mapSupplyContract(tables, rawTableCount);
    case 'SHARE_BUYBACK':
      return mapShareBuyback(tables, rawTableCount);
    case 'SHARE_CANCELLATION':
      return mapShareCancellation(tables, rawTableCount);
    case 'DIVIDEND':
      return mapDividend(tables, rawTableCount);
    case 'PAID_IN_CAPITAL_INCREASE':
      return mapPaidInCapital(tables, rawTableCount);
    case 'CB_BW_ISSUANCE':
      return mapCbBw(tables, rawTableCount, rawText);
    default:
      return {
        docType: eventType ?? 'UNKNOWN',
        rawTableCount,
        keyValueSource: 'none',
      };
  }
}
