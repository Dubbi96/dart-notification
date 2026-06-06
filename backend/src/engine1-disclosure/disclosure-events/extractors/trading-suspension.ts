// backend/src/engine1-disclosure/disclosure-events/extractors/trading-suspension.ts
// 거래정지 수치 추출 파서 (Rule/정규식 전용, AI 미사용)
// DAR-71: 고위험 공시 5종 구조화 추출기. 보유 parsedJson 재사용 — 신규 DART 호출 0

import { ParsedJson } from '../../disclosure-documents/types/parsed-json.type';

export interface TradingSuspensionData {
  suspensionReason: string | null;       // 정지 사유
  // 정지 유형 분류 (사유 키워드 기반)
  suspensionType:
    | 'DISCLOSURE'      // 불성실공시·조회공시 관련
    | 'AUDIT'           // 감사의견 관련
    | 'DELISTING'       // 상장폐지 절차 관련
    | 'PRICE_VOLATILITY'// 변동성완화·이상급등
    | 'OTHER'
    | 'UNKNOWN';
  suspensionStartDate: string | null;    // 정지 시작일 YYYY-MM-DD
  expectedResumeDate: string | null;     // 예상 해제일 YYYY-MM-DD
  derivedDataMissing: boolean;           // suspensionReason null 시 true
}

/**
 * parsedJson에서 거래정지 정보를 추출한다.
 *
 * - suspensionType: 정지 사유/보고서명 키워드 분류.
 * - 날짜: YYYY.MM.DD / YYYY/MM/DD / YYYYMMDD → YYYY-MM-DD 정규화.
 * - 부분 추출 허용: 해제일 미정(예상 해제일 결측) 흔함 → null 허용.
 */
export function extract(parsedJson: ParsedJson, reportName: string): TradingSuspensionData {
  try {
    const suspensionReason = nonEmpty(parsedJson.suspensionReason);
    const suspensionStartDate = normalizeDate(parsedJson.suspensionStartDate ?? null);
    const expectedResumeDate = normalizeDate(parsedJson.expectedResumeDate ?? null);
    const suspensionType = inferType(suspensionReason, reportName);

    return {
      suspensionReason,
      suspensionType,
      suspensionStartDate,
      expectedResumeDate,
      derivedDataMissing: suspensionReason === null,
    };
  } catch {
    return emptyResult();
  }
}

// ─── 내부 유틸 ──────────────────────────────────────────────────────────────

function inferType(
  reason: string | null,
  reportName: string,
): TradingSuspensionData['suspensionType'] {
  const text = [reason ?? '', reportName].join(' ');
  if (/상장폐지|상폐|정리매매/.test(text)) return 'DELISTING';
  if (/감사의견|감사보고서/.test(text)) return 'AUDIT';
  if (/불성실공시|조회공시|공시\s*불이행|공시번복/.test(text)) return 'DISCLOSURE';
  if (/변동성\s*완화|이상\s*급등|급변|단기과열/.test(text)) return 'PRICE_VOLATILITY';
  if (text.trim().length > 0) return 'OTHER';
  return 'UNKNOWN';
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

function nonEmpty(v: string | null | undefined): string | null {
  if (v === null || v === undefined) return null;
  const trimmed = String(v).trim();
  return trimmed.length > 0 ? trimmed : null;
}

function emptyResult(): TradingSuspensionData {
  return {
    suspensionReason: null,
    suspensionType: 'UNKNOWN',
    suspensionStartDate: null,
    expectedResumeDate: null,
    derivedDataMissing: true,
  };
}
