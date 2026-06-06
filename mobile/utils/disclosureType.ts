export const DISCLOSURE_TYPES = [
  'REGULAR',
  'MATERIAL',
  'ISSUANCE',
  'EQUITY',
  'AUDIT',
  'EXCHANGE',
  'OTHER',
] as const;

interface BadgeStyle {
  bg: string;
  text: string;
}

const TYPE_COLORS_LIGHT: Record<string, BadgeStyle> = {
  REGULAR: { bg: '#DBEAFE', text: '#2563EB' },       // Blue
  MATERIAL: { bg: '#FEE2E2', text: '#DC2626' },      // Red
  ISSUANCE: { bg: '#FEF3C7', text: '#D97706' },      // Amber
  EQUITY: { bg: '#EDE9FE', text: '#7C3AED' },        // Purple
  AUDIT: { bg: '#E0E7FF', text: '#4338CA' },          // Indigo
  EXCHANGE: { bg: '#FCE7F3', text: '#DB2777' },       // Pink
  OTHER: { bg: '#F3F4F6', text: '#6B7280' },          // Gray
};

const TYPE_COLORS_DARK: Record<string, BadgeStyle> = {
  REGULAR: { bg: '#1E2A4A', text: '#7BA3F0' },       // Muted blue
  MATERIAL: { bg: '#3A1A22', text: '#F0828A' },      // Muted red
  ISSUANCE: { bg: '#352A14', text: '#E4B85C' },      // Muted amber
  EQUITY: { bg: '#271A3E', text: '#B89AEF' },        // Muted purple
  AUDIT: { bg: '#142E2E', text: '#5EC4C4' },          // Muted teal/cyan
  EXCHANGE: { bg: '#381A30', text: '#E88ABB' },       // Muted pink
  OTHER: { bg: '#1C1F30', text: '#8B90A8' },          // Muted gray
};

const TYPE_LABELS: Record<string, string> = {
  REGULAR: '정기공시',
  MATERIAL: '주요사항보고',
  ISSUANCE: '발행공시',
  EQUITY: '지분공시',
  AUDIT: '감사공시',
  EXCHANGE: '거래소공시',
  OTHER: '기타공시',
};

export function getTypeLabel(type: string): string {
  return TYPE_LABELS[type] ?? type;
}

export function getTypeStyle(type: string, isDark = false): BadgeStyle {
  const colors = isDark ? TYPE_COLORS_DARK : TYPE_COLORS_LIGHT;
  const fallback = isDark ? TYPE_COLORS_DARK['OTHER'] : TYPE_COLORS_LIGHT['OTHER'];
  return colors[type] ?? fallback;
}

// 신호 이벤트 타입 평문 매핑(DAR-31 §3-1). 공시 분류용 TYPE_LABELS와 별개.
// raw enum(SUPPLY_CONTRACT 등)이 화면에 직접 노출되지 않도록 항상 이 헬퍼를 통한다.
// 백엔드 prisma `enum EventType` 전체와 1:1 (raw enum 노출 방지 — DAR-81 통계 화면 라벨 포함).
export const EVENT_TYPE_LABEL: Record<string, string> = {
  SUPPLY_CONTRACT: '대규모 공급계약',
  SHARE_BUYBACK: '자기주식 취득',
  SHARE_CANCELLATION: '자기주식 소각',
  DIVIDEND_INCREASE: '배당 확대',
  PAID_IN_CAPITAL_INCREASE: '유상증자',
  CB_ISSUANCE: '전환사채(CB) 발행',
  BW_ISSUANCE: '신주인수권부사채(BW) 발행',
  CONTRACT_CANCELLATION: '공급계약 해제·취소',
  DIVIDEND_CUT: '배당 축소·중단',
  THIRD_PARTY_ALLOTMENT: '제3자배정 유상증자',
  EARNINGS_SURPRISE: '실적 서프라이즈',
  EARNINGS_SHOCK: '실적 쇼크',
  MAJOR_SHAREHOLDER_CHANGE: '최대주주 변경',
  LAWSUIT: '소송·횡령·배임',
  AUDIT_OPINION_RISK: '감사의견 거절·한정',
  TRADING_SUSPENSION: '거래정지',
  DELISTING_RISK: '상장폐지 위험',
  AUDIT_RISK_RESOLVED: '감사 리스크 해소',
  OTHER: '기타',
};

export function getEventTypeLabel(eventType: string): string {
  return EVENT_TYPE_LABEL[eventType] ?? eventType;
}

// AI 극성 평문 매핑(DAR-31 §3-2). '(참고)' 꼬리표 강제 — 단정 표현 금지.
// 표기 규칙: copy.ts와 동일하게 꼬리표 앞 공백 ' (참고)'로 통일(DAR-33 폴리시 정리).
export const POLARITY_LABEL: Record<string, string> = {
  POSITIVE: '호재 성격 (참고)',
  NEGATIVE: '악재 성격 (참고)',
  MIXED: '복합 성격 (참고)',
  NEUTRAL: '중립 성격 (참고)',
};

export function getPolarityLabel(polarity: string): string {
  return POLARITY_LABEL[polarity] ?? polarity;
}
