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

// L-5b(B-1): 공시유형 뱃지 팔레트 — theme/colors.ts의 lightColors/darkColors 구조를 미러하는
// 도메인 확장 팔레트(테마층). colors.ts 승격(badge.disclosureType.*) 시 이 블록을 그대로 이관한다.
// 소비는 반드시 getTypeStyle(type, isDark) 경유 — isDark 필수(라이트 기본값 풋건 제거).
const TYPE_BADGE_PALETTE: Record<'light' | 'dark', Record<string, BadgeStyle>> = {
  light: {
    REGULAR: { bg: '#DBEAFE', text: '#2563EB' },     // Blue
    MATERIAL: { bg: '#FEE2E2', text: '#DC2626' },    // Red
    ISSUANCE: { bg: '#FEF3C7', text: '#D97706' },    // Amber
    EQUITY: { bg: '#EDE9FE', text: '#7C3AED' },      // Purple
    AUDIT: { bg: '#E0E7FF', text: '#4338CA' },        // Indigo
    EXCHANGE: { bg: '#FCE7F3', text: '#DB2777' },     // Pink
    OTHER: { bg: '#F3F4F6', text: '#6B7280' },        // Gray
  },
  dark: {
    REGULAR: { bg: '#1E2A4A', text: '#7BA3F0' },     // Muted blue
    MATERIAL: { bg: '#3A1A22', text: '#F0828A' },    // Muted red
    ISSUANCE: { bg: '#352A14', text: '#E4B85C' },    // Muted amber
    EQUITY: { bg: '#271A3E', text: '#B89AEF' },      // Muted purple
    AUDIT: { bg: '#142E2E', text: '#5EC4C4' },        // Muted teal/cyan
    EXCHANGE: { bg: '#381A30', text: '#E88ABB' },     // Muted pink
    OTHER: { bg: '#1C1F30', text: '#8B90A8' },        // Muted gray
  },
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

// isDark 필수 인자 — 기본값(라이트)이 있으면 신규 호출처가 인자를 빼먹었을 때
// 다크모드에 파스텔 라이트 뱃지가 조용히 렌더되는 회귀가 가능하다(L-5b B-1).
export function getTypeStyle(type: string, isDark: boolean): BadgeStyle {
  const palette = TYPE_BADGE_PALETTE[isDark ? 'dark' : 'light'];
  return palette[type] ?? palette['OTHER'];
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
  // W9 정직 라벨링: 서프라이즈·쇼크 판정은 전년동기(YoY) 대비 기준(백엔드 earnings.ts) —
  // 시장 기대치 대비 판정으로 오인되지 않도록 기준을 라벨에 병기한다.
  EARNINGS_SURPRISE: '실적 서프라이즈(전년동기 대비)',
  EARNINGS_SHOCK: '실적 쇼크(전년동기 대비)',
  // W9: 가이던스 = 회사가 스스로 공시한 전망(자사 전망) — 애널리스트 추정 집계 아님.
  EARNINGS_GUIDANCE: '실적 가이던스(자사 전망)',
  MAJOR_SHAREHOLDER_CHANGE: '최대주주 변경',
  LAWSUIT: '소송·횡령·배임',
  AUDIT_OPINION_RISK: '감사의견 거절·한정',
  TRADING_SUSPENSION: '거래정지',
  DELISTING_RISK: '상장폐지 위험',
  AUDIT_RISK_RESOLVED: '감사 리스크 해소',
  // ── 지분변동 3종(DAR-87) — raw enum 노출 방지(DAR-306) ──
  INSIDER_BUY: '내부자 매수',
  INSIDER_SELL: '내부자 매도',
  MAJOR_HOLDER_5PCT: '5% 대량보유',
  // ── 확장 이벤트 18종 — '기타' 뭉개짐 해소(UX리뷰 W1 잔여, check-event-polarity-labels 정합) ──
  INSIDER_TRADING_REPORT: '임원·주요주주 거래 보고',
  SECURITIES_OFFERING: '증권 발행(모집·매출)',
  PERIODIC_DISCLOSURE: '정기공시(사업·분기보고서)',
  SHAREHOLDER_MEETING: '주주총회',
  IR_EVENT: 'IR·기업설명회',
  RELATED_PARTY_TRANSACTION: '특수관계자 거래',
  AFFILIATE_GROUP_DISCLOSURE: '기업집단(계열) 공시',
  OWNERSHIP_DISCLOSURE: '지분·소유권 공시',
  DEBT_GUARANTEE: '채무보증',
  CAPITAL_REDUCTION: '감자',
  BONUS_ISSUE: '무상증자',
  MERGER_SPLIT: '합병·분할',
  INVESTMENT_DECISION: '신규 투자 결정',
  STOCK_OPTION: '주식매수선택권 부여',
  EXECUTIVE_CHANGE: '임원 변동',
  INQUIRY_DISCLOSURE: '조회공시',
  MARKET_NOTICE: '시장 안내·조치',
  CONVERTIBLE_EXERCISE: '전환권·신주인수권 행사',
  REGULATORY_ADMIN_NOTICE: '행정·규제 절차 안내',
  VALUE_UP_PLAN: '기업가치 제고 계획',
  EARNINGS_PREANNOUNCEMENT: '결산실적 발표 예고',
  VOLUNTARY_MANAGEMENT_DISCLOSURE: '자율 경영공시',
  OTHER: '기타',
};

export function getEventTypeLabel(eventType: string): string {
  // 미매핑(향후 enum 추가 등)은 raw enum 대신 안전 기본 라벨로 — DAR-306.
  return EVENT_TYPE_LABEL[eventType] ?? EVENT_TYPE_LABEL.OTHER;
}

// AI 극성 평문 매핑(DAR-31 §3-2). '(참고)' 꼬리표 강제 — 단정 표현 금지.
// 표기 규칙: copy.ts와 동일하게 꼬리표 앞 공백 ' (참고)'로 통일(DAR-33 폴리시 정리).
export const POLARITY_LABEL: Record<string, string> = {
  POSITIVE: '호재 성격 (참고)',
  NEGATIVE: '악재 성격 (참고)',
  MIXED: '복합 성격 (참고)',
  NEUTRAL: '중립 성격 (참고)',
  UNKNOWN: '미분류 (참고)',
};

export function getPolarityLabel(polarity: string): string {
  // 미매핑(향후 값 추가 등)은 raw enum 대신 안전 기본 라벨로 — DAR-306.
  return POLARITY_LABEL[polarity] ?? POLARITY_LABEL.UNKNOWN;
}
