// backend/src/disclosure-events/extractors/major-shareholder-change.ts
// 최대주주 변경 수치 추출 파서 (Rule/정규식 전용, AI 미사용)
// DAR-58: 보유 parsedJson 재사용 — 신규 DART 호출 0

import { ParsedJson } from '../../disclosure-documents/types/parsed-json.type';

export interface MajorShareholderChangeData {
  newLargestShareholder: string | null;       // 변경 후 최대주주
  previousLargestShareholder: string | null;  // 변경 전 최대주주
  ownershipRatio: number | null;              // 변경 후 지분율 (% 0~100)
  changeReason: string | null;                // 변경 사유 원문
  changeMethod: 'SHARE_TRANSFER' | 'ON_MARKET' | 'INHERITANCE' | 'MERGER' | 'UNKNOWN';
  changeDate: string | null;                  // 변경일 YYYY-MM-DD
  derivedDataMissing: boolean;
}

/**
 * parsedJson에서 최대주주 변경 정보를 추출한다.
 *
 * - ownershipRatio: largestShareholderRatio가 소수 비율(0<r<1)이면 *100, 그 외 그대로.
 * - changeMethod: 변경 사유/보고서명 키워드로 분류 (양수도·장내매수·상속·합병).
 * - 보유 parsedJson에 구조화 필드가 없으면 null → 상위 레이어에서 NEEDS_REVIEW(AI L1).
 */
export function extract(parsedJson: ParsedJson, reportName: string): MajorShareholderChangeData {
  try {
    const newLargestShareholder = nonEmpty(parsedJson.newLargestShareholder);
    const previousLargestShareholder = nonEmpty(parsedJson.previousLargestShareholder);
    const changeReason = nonEmpty(parsedJson.shareholderChangeReason);
    const changeDate = normalizeDate(parsedJson.shareholderChangeDate ?? null);

    const rawRatio = parsedJson.largestShareholderRatio ?? null;
    const ownershipRatio =
      rawRatio !== null
        ? rawRatio > 0 && rawRatio < 1
          ? round2(rawRatio * 100)
          : round2(rawRatio)
        : null;

    const changeMethod = inferChangeMethod(changeReason, reportName);

    const derivedDataMissing = ownershipRatio === null;

    return {
      newLargestShareholder,
      previousLargestShareholder,
      ownershipRatio,
      changeReason,
      changeMethod,
      changeDate,
      derivedDataMissing,
    };
  } catch {
    return emptyResult();
  }
}

// ─── 내부 유틸 ──────────────────────────────────────────────────────────────

/**
 * 변경 사유·보고서명 키워드로 최대주주 변경 방식 분류
 */
function inferChangeMethod(
  changeReason: string | null,
  reportName: string,
): 'SHARE_TRANSFER' | 'ON_MARKET' | 'INHERITANCE' | 'MERGER' | 'UNKNOWN' {
  const text = [changeReason ?? '', reportName].join(' ');
  if (/합병|분할/.test(text)) return 'MERGER';
  if (/상속|증여/.test(text)) return 'INHERITANCE';
  if (/장내\s*매수|시장\s*매수/.test(text)) return 'ON_MARKET';
  if (/양수도|양수\s*도|주식\s*양수|장외\s*매수|지분\s*양수/.test(text)) return 'SHARE_TRANSFER';
  return 'UNKNOWN';
}

function nonEmpty(v: string | null | undefined): string | null {
  if (v === null || v === undefined) return null;
  const trimmed = String(v).trim();
  return trimmed.length > 0 ? trimmed : null;
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

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function emptyResult(): MajorShareholderChangeData {
  return {
    newLargestShareholder: null,
    previousLargestShareholder: null,
    ownershipRatio: null,
    changeReason: null,
    changeMethod: 'UNKNOWN',
    changeDate: null,
    derivedDataMissing: true,
  };
}
