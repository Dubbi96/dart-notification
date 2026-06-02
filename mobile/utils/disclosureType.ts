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
