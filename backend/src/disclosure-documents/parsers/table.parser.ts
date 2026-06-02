// backend/src/disclosure-documents/parsers/table.parser.ts
// 의존성: 정규식만 사용 (cheerio 없음)

import { Table } from '../types/table.type';

/** 단위 행 탐지 패턴 (규칙 T-06) */
const UNIT_NOTE_PATTERN =
  /(?:단위\s*[:：]?\s*(?:원|주|천원|백만원|억원|천주|만주))|\(단위\s*:.*?\)/i;

/**
 * HTML에서 <table> 요소를 파싱해 Table[] 반환.
 * 의존성: 정규식만 사용 (cheerio 없음)
 *
 * 규칙:
 *   T-01: <table>...</table> 정규식으로 블록 추출 (대소문자 무관)
 *   T-02: 빈 표 제외 (행 0 또는 전체 셀이 빈 문자열)
 *   T-03: 헤더 자동 감지 (TH 우선, 없으면 첫 행 조건 판단)
 *   T-04: colspan → hasColspan 플래그 (복제 없이 1셀 저장)
 *   T-05: rowspan → hasRowspan 플래그 (아래 행에 "" 채움)
 *   T-06: 단위 행 → unitNote 필드에 저장
 *   T-07: 셀 텍스트 정규화 (br→\n, 인라인 태그 제거, 엔터티, trim)
 */
export function parseTables(html: string): Table[] {
  const tableBlocks = extractTableBlocks(html);
  const tables: Table[] = [];

  for (let idx = 0; idx < tableBlocks.length; idx++) {
    const block = tableBlocks[idx];
    const table = parseTableBlock(block, idx);
    if (table) {
      tables.push(table);
    }
  }

  return tables;
}

/**
 * HTML에서 <table>...</table> 블록을 배열로 추출한다.
 * 중첩 table은 각각 별도 항목으로 분리한다.
 */
function extractTableBlocks(html: string): string[] {
  const blocks: string[] = [];

  // 대소문자 무관 table 태그 매칭
  const tableRegex = /<table[\s\S]*?<\/table>/gi;
  let match: RegExpExecArray | null;

  while ((match = tableRegex.exec(html)) !== null) {
    blocks.push(match[0]);
  }

  // 매칭 실패 시 (<table> 있으나 </table> 없는 경우) fallback
  if (blocks.length === 0) {
    const openRegex = /<table[^>]*>/gi;
    let openMatch: RegExpExecArray | null;
    const starts: number[] = [];

    while ((openMatch = openRegex.exec(html)) !== null) {
      starts.push(openMatch.index);
    }

    for (let i = 0; i < starts.length; i++) {
      const start = starts[i];
      const end = i + 1 < starts.length ? starts[i + 1] : html.length;
      blocks.push(html.slice(start, end));
    }
  }

  return blocks;
}

/**
 * 단일 <table> 블록을 파싱해 Table 객체 반환.
 * 빈 표이거나 데이터가 없으면 null 반환.
 */
function parseTableBlock(tableHtml: string, tableIndex: number): Table | null {
  // caption 추출
  const captionMatch = tableHtml.match(/<caption[^>]*>([\s\S]*?)<\/caption>/i);
  const caption = captionMatch
    ? normalizeCell(captionMatch[1])
    : undefined;

  // 행(TR / TU) 추출
  const rowBlocks = extractRowBlocks(tableHtml);

  if (rowBlocks.length === 0) return null;

  let headers: string[] = [];
  const rows: string[][] = [];
  let hasColspan = false;
  let hasRowspan = false;
  let unitNote: string | undefined;

  // thead 내 행을 헤더로 우선 처리
  const theadMatch = tableHtml.match(/<thead[\s\S]*?<\/thead>/i);
  let theadRows: string[] = [];
  if (theadMatch) {
    theadRows = extractRowBlocks(theadMatch[0]);
  }

  let headerProcessed = false;

  for (const rowHtml of rowBlocks) {
    const { cells, rowHasColspan, rowHasRowspan } = extractCells(rowHtml);
    if (rowHasColspan) hasColspan = true;
    if (rowHasRowspan) hasRowspan = true;

    const cellTexts = cells.map((c) => normalizeCell(c.content));

    // 단위 행 탐지 (T-06)
    const joinedText = cellTexts.join(' ');
    if (UNIT_NOTE_PATTERN.test(joinedText)) {
      unitNote = joinedText.trim();
      // 단위 행도 rows에 포함 (T-06: 제외하지 않음)
    }

    // thead 내 행이면 헤더로 처리
    if (!headerProcessed && theadRows.length > 0) {
      if (theadRows[0] === rowHtml) {
        headers = cellTexts;
        headerProcessed = true;
        continue;
      }
    }

    // TH 셀이 있는 행을 헤더로 처리 (T-03 규칙 1)
    if (!headerProcessed && cells.some((c) => c.isHeader)) {
      headers = cellTexts;
      headerProcessed = true;
      continue;
    }

    // 첫 번째 행 조건 판단 (T-03 규칙 2)
    // 단, 행이 1개뿐인 표는 그 행을 헤더로 소비하면 데이터가 비므로 제외
    if (!headerProcessed && rows.length === 0 && rowBlocks.length > 1) {
      if (isLikelyHeader(cellTexts)) {
        headers = cellTexts;
        headerProcessed = true;
        continue;
      }
    }

    // 일반 데이터 행
    if (cellTexts.length > 0) {
      rows.push(cellTexts);
    }
  }

  // T-02: 빈 표 제외 조건
  if (rows.length === 0 && headers.length === 0) return null;
  const allEmpty =
    rows.every((r) => r.every((c) => c === '')) &&
    headers.every((h) => h === '');
  if (allEmpty) return null;

  return {
    tableIndex,
    headers,
    rows,
    caption,
    unitNote,
    hasColspan,
    hasRowspan,
  };
}

/** 첫 행이 헤더일 조건 판단 (T-03 규칙 2) */
function isLikelyHeader(cells: string[]): boolean {
  if (cells.length === 0) return false;
  // a) 모든 셀 텍스트 길이 20자 이하
  if (cells.every((c) => c.length <= 20)) return true;
  // b) 모든 셀이 숫자를 포함하지 않음
  if (cells.every((c) => !/\d/.test(c))) return true;
  return false;
}

/** 행(TR/TU) 블록을 배열로 추출 */
function extractRowBlocks(html: string): string[] {
  const blocks: string[] = [];
  const rowRegex = /<(?:tr|TU)[^>]*>[\s\S]*?<\/(?:tr|TU)>/gi;
  let match: RegExpExecArray | null;
  while ((match = rowRegex.exec(html)) !== null) {
    blocks.push(match[0]);
  }
  return blocks;
}

interface CellInfo {
  content: string;
  isHeader: boolean;
  colspan: number;
  rowspan: number;
}

/** 셀(TD/TH/TE) 정보를 행 HTML에서 추출 */
function extractCells(
  rowHtml: string,
): { cells: CellInfo[]; rowHasColspan: boolean; rowHasRowspan: boolean } {
  const cells: CellInfo[] = [];
  let rowHasColspan = false;
  let rowHasRowspan = false;

  // TD / TH / TE 태그 추출 (대소문자 무관)
  const cellRegex = /<(td|th|te)([^>]*)>([\s\S]*?)<\/(?:td|th|te)>/gi;
  let match: RegExpExecArray | null;

  while ((match = cellRegex.exec(rowHtml)) !== null) {
    const tagName = match[1].toLowerCase();
    const attrs = match[2];
    const content = match[3];

    const isHeader = tagName === 'th';

    // colspan 추출 (T-04)
    const colspanMatch = attrs.match(/colspan\s*=\s*["']?(\d+)["']?/i);
    const colspan = colspanMatch ? parseInt(colspanMatch[1], 10) : 1;
    if (colspan > 1) rowHasColspan = true;

    // rowspan 추출 (T-05)
    const rowspanMatch = attrs.match(/rowspan\s*=\s*["']?(\d+)["']?/i);
    const rowspan = rowspanMatch ? parseInt(rowspanMatch[1], 10) : 1;
    if (rowspan > 1) rowHasRowspan = true;

    cells.push({ content, isHeader, colspan, rowspan });
  }

  return { cells, rowHasColspan, rowHasRowspan };
}

/**
 * 셀 내용 정규화 (T-07)
 * - <br> → '\n'
 * - 인라인 태그 제거, 내용 유지
 * - HTML 엔터티 정규화
 * - 앞뒤 공백 trim, 연속 공백 → 공백 1개
 */
function normalizeCell(content: string): string {
  let text = content;
  // <br>/<br/>/<BR> → '\n'
  text = text.replace(/<br\s*\/?>/gi, '\n');
  // 인라인 태그 제거 (내용 유지)
  text = text.replace(/<[^>]+>/g, '');
  // HTML 엔터티 정규화 (&amp; 우선)
  text = text.replace(/&amp;/gi, '&');
  text = text.replace(/&lt;/gi, '<');
  text = text.replace(/&gt;/gi, '>');
  text = text.replace(/&quot;/gi, '"');
  text = text.replace(/&apos;/gi, "'");
  text = text.replace(/&nbsp;/gi, ' ');
  text = text.replace(/&#xA0;/gi, ' ');
  text = text.replace(/&#160;/gi, ' ');
  text = text.replace(/&#([0-9]+);/g, (_, c) =>
    String.fromCharCode(parseInt(c, 10)),
  );
  text = text.replace(/&#x([0-9a-fA-F]+);/g, (_, c) =>
    String.fromCharCode(parseInt(c, 16)),
  );
  // 연속 공백 → 공백 1개
  text = text.replace(/ {2,}/g, ' ');
  // 앞뒤 공백 trim
  return text.trim();
}
