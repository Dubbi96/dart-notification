// backend/src/disclosure-documents/types/table.type.ts

/**
 * 공시 원문에서 추출된 표 구조
 * table.parser.ts의 parseTables() 반환 타입
 */
export interface Table {
  /** 문서 내 표 순서 (0-based) */
  tableIndex: number;
  /** 헤더 행 텍스트 배열 (없으면 빈 배열) */
  headers: string[];
  /** 데이터 행 배열 (각 행은 셀 텍스트 배열) */
  rows: string[][];
  /** <caption> 또는 앞 단락 제목 (선택) */
  caption?: string;
  /** 단위 표시 행 텍스트 (예: "단위: 원") */
  unitNote?: string;
  /** colspan 사용 여부 */
  hasColspan: boolean;
  /** rowspan 사용 여부 */
  hasRowspan: boolean;
}
