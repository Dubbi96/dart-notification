export interface DisclosureTypeInfo {
  id: string;
  label: string;
  description: string;
  sortOrder: number;
}

export const DISCLOSURE_TYPES: DisclosureTypeInfo[] = [
  { id: 'REGULAR', label: '정기공시', description: '사업/반기/분기보고서', sortOrder: 1 },
  { id: 'MATERIAL', label: '주요사항보고', description: '합병, 분할, 주요 경영 변동', sortOrder: 2 },
  { id: 'ISSUANCE', label: '발행공시', description: '증권신고서, 투자설명서', sortOrder: 3 },
  { id: 'EQUITY', label: '지분공시', description: '대량보유, 공개매수, 지분변동', sortOrder: 4 },
  { id: 'AUDIT', label: '감사공시', description: '감사보고서, 외부감사', sortOrder: 5 },
  { id: 'EXCHANGE', label: '거래소공시', description: '거래소 관련 공시, 시장조치', sortOrder: 6 },
  { id: 'OTHER', label: '기타공시', description: '기타 공시사항', sortOrder: 7 },
];

/** 공시 유형 ID 목록 */
export const DISCLOSURE_TYPE_IDS = DISCLOSURE_TYPES.map((t) => t.id);
