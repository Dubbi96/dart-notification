// 공시 이벤트 추출 수치(extractedData)의 평문 라벨·단위 포맷 매핑(DAR-46 §3).
// 백엔드 extractors(supply-contract·share-buyback·dividend·capital-increase·cb-bw)가 채우는
// 필드 키만 화이트리스트로 노출한다. 미정의 키·null·비원시값은 조용히 생략(raw 키 노출 금지).

type FigureUnit = 'krw' | 'shares' | 'price' | 'percent' | 'months' | 'date' | 'text';

interface FigureSpec {
  label: string;
  unit: FigureUnit;
}

// 키 → 라벨·단위. 의미가 확실한 핵심 수치만 등재(나머지는 표시하지 않음).
const KEY_FIGURE_SPEC: Record<string, FigureSpec> = {
  // 공급계약
  contractAmount: { label: '계약금액', unit: 'krw' },
  salesRatio: { label: '매출 대비 비중', unit: 'percent' },
  contractDurationMonths: { label: '계약기간', unit: 'months' },
  counterparty: { label: '계약상대', unit: 'text' },
  contractStartDate: { label: '계약 시작', unit: 'date' },
  contractEndDate: { label: '계약 종료', unit: 'date' },
  // 자기주식 취득
  buybackShares: { label: '취득 주식수', unit: 'shares' },
  buybackAmount: { label: '취득금액', unit: 'krw' },
  buybackRatioToTotal: { label: '발행주식 대비', unit: 'percent' },
  // 자기주식 소각
  cancellationShares: { label: '소각 주식수', unit: 'shares' },
  cancellationAmount: { label: '소각금액', unit: 'krw' },
  cancellationRatioToTotal: { label: '발행주식 대비', unit: 'percent' },
  // 배당
  dividendPerShare: { label: '주당 배당금', unit: 'price' },
  dividendYield: { label: '배당수익률', unit: 'percent' },
  dividendTotal: { label: '배당총액', unit: 'krw' },
  // 유상증자
  newShares: { label: '신주 수', unit: 'shares' },
  fundingAmount: { label: '조달금액', unit: 'krw' },
  dilutionRate: { label: '희석률', unit: 'percent' },
  issuePrice: { label: '발행가액', unit: 'price' },
  // CB/BW
  totalAmount: { label: '발행총액', unit: 'krw' },
  conversionPrice: { label: '전환가액', unit: 'price' },
  conversionPremiumRate: { label: '전환 프리미엄', unit: 'percent' },
  interestRate: { label: '표면이자율', unit: 'percent' },
};

// 핵심 수치를 너무 많이 노출하지 않도록 카드당 상한.
const MAX_FIGURES = 6;

function formatKrwCompact(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1_0000_0000)
    return `${(value / 1_0000_0000).toLocaleString('ko-KR', { maximumFractionDigits: 1 })}억원`;
  if (abs >= 1_0000)
    return `${(value / 1_0000).toLocaleString('ko-KR', { maximumFractionDigits: 0 })}만원`;
  return `${value.toLocaleString('ko-KR')}원`;
}

function formatFigure(value: number | string, unit: FigureUnit): string | null {
  if (unit === 'text') {
    const s = String(value).trim();
    return s.length > 0 ? s : null;
  }
  if (unit === 'date') {
    const s = String(value).trim();
    // YYYYMMDD → YYYY.MM.DD, 그 외 문자열은 그대로
    const m = /^(\d{4})(\d{2})(\d{2})$/.exec(s);
    return m ? `${m[1]}.${m[2]}.${m[3]}` : s.length > 0 ? s : null;
  }
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return null;
  switch (unit) {
    case 'krw':
      return formatKrwCompact(n);
    case 'price':
      return `${n.toLocaleString('ko-KR')}원`;
    case 'shares':
      return `${n.toLocaleString('ko-KR')}주`;
    case 'percent':
      return `${n.toLocaleString('ko-KR', { maximumFractionDigits: 1 })}%`;
    case 'months':
      return `${n.toLocaleString('ko-KR')}개월`;
    default:
      return String(n);
  }
}

export interface KeyFigure {
  key: string;
  label: string;
  display: string;
}

/**
 * extractedData에서 화이트리스트 키만 골라 라벨·포맷된 핵심 수치 목록을 만든다.
 * 미정의 키/null/빈값/비원시값은 제외하며, KEY_FIGURE_SPEC 등재 순서를 따른다.
 */
export function extractKeyFigures(
  data: Record<string, unknown> | null | undefined,
): KeyFigure[] {
  if (!data || typeof data !== 'object') return [];
  const figures: KeyFigure[] = [];
  for (const [key, spec] of Object.entries(KEY_FIGURE_SPEC)) {
    const raw = data[key];
    if (raw === null || raw === undefined) continue;
    if (typeof raw !== 'number' && typeof raw !== 'string') continue;
    const display = formatFigure(raw, spec.unit);
    if (display === null) continue;
    figures.push({ key, label: spec.label, display });
    if (figures.length >= MAX_FIGURES) break;
  }
  return figures;
}
