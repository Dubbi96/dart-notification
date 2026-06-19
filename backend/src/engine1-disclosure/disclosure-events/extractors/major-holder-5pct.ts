// backend/src/disclosure-events/extractors/major-holder-5pct.ts
// 대량보유(5%룰) 상황보고 수치 추출 파서 (Rule/정규식 전용, AI 미사용)
// DAR-337: 보유 parsedJson 재사용 — 신규 DART 호출 0.
//
// 배경: MAJOR_HOLDER_5PCT는 분류기(event-classifier)가 보고서명만으로 확실히
// 분류하지만(0.85) 전용 extractor가 없어 전건 FAILED(611건, 최대 단일레버)였다.
// 본 파서는 parsedJson에 보유비율 등 구조화 필드가 있으면 추출해 SUCCESS로 승격하고,
// 없으면 null → 상위 레이어가 NEEDS_REVIEW(AI L1/insider 보강)로 라우팅한다.
//
// 방향(증감 부호)의 정본은 정형 majorstock.json 수집 경로(InsiderHoldingChange)이며,
// 여기서는 직전·변동후 보유비율이 모두 있을 때만 보조적으로 changeDirection을 도출한다.

import { ParsedJson } from '../../disclosure-documents/types/parsed-json.type';

export interface MajorHolder5PctData {
  holderName: string | null;            // 대표보고자/보유자
  holdingRatio: number | null;          // 변동 후 보유비율 (% 0~100)
  previousHoldingRatio: number | null;  // 직전 보유비율 (% 0~100)
  holdingRatioChange: number | null;    // 파생: 변동 후 - 직전 (%p, signed)
  changeDirection: 'INCREASE' | 'DECREASE' | 'FLAT' | 'UNKNOWN';
  heldShares: number | null;            // 보유 주식등의 수
  holdingPurpose:
    | 'MANAGEMENT_PARTICIPATION'
    | 'SIMPLE_INVESTMENT'
    | 'GENERAL_INVESTMENT'
    | 'UNKNOWN';
  reportReason: string | null;          // 보고사유 원문 (신규·변동·변경 등)
  derivedDataMissing: boolean;
}

/**
 * parsedJson에서 대량보유(5%룰) 정보를 추출한다.
 *
 * - holdingRatio/previousHoldingRatio: 소수 비율(0<r<1)이면 *100, 그 외 그대로(% 가정).
 *   (sibling major-shareholder-change와 동일 규약 — 5%룰 보고는 통상 비율 ≥5%이므로 percent형.)
 * - holdingRatioChange: 직전·변동후가 모두 있으면 (변동후 - 직전), 없으면 null.
 * - changeDirection: 변동치 부호로 INCREASE/DECREASE/FLAT, 산출 불가 시 UNKNOWN.
 * - 구조화 필드가 없으면 holdingRatio=null → derivedDataMissing=true → 상위 NEEDS_REVIEW.
 */
export function extract(parsedJson: ParsedJson, reportName: string): MajorHolder5PctData {
  try {
    const holderName = nonEmpty(parsedJson.holderName);
    const holdingRatio = normalizeRatio(parsedJson.holdingRatio ?? null);
    const previousHoldingRatio = normalizeRatio(parsedJson.previousHoldingRatio ?? null);
    const heldShares = finiteOrNull(parsedJson.heldShares ?? null);
    const reportReason = nonEmpty(parsedJson.holdingReportReason);

    const holdingRatioChange =
      holdingRatio !== null && previousHoldingRatio !== null
        ? round2(holdingRatio - previousHoldingRatio)
        : null;

    const changeDirection = inferDirection(holdingRatioChange);

    const holdingPurpose = inferPurpose(parsedJson.holdingPurpose ?? null, reportName);

    const derivedDataMissing = holdingRatio === null;

    return {
      holderName,
      holdingRatio,
      previousHoldingRatio,
      holdingRatioChange,
      changeDirection,
      heldShares,
      holdingPurpose,
      reportReason,
      derivedDataMissing,
    };
  } catch {
    return emptyResult();
  }
}

// ─── 내부 유틸 ──────────────────────────────────────────────────────────────

function inferDirection(
  change: number | null,
): 'INCREASE' | 'DECREASE' | 'FLAT' | 'UNKNOWN' {
  if (change === null) return 'UNKNOWN';
  if (change > 0) return 'INCREASE';
  if (change < 0) return 'DECREASE';
  return 'FLAT';
}

/**
 * 보유목적 분류: 보유목적 원문 + 보고서명 키워드.
 */
function inferPurpose(
  rawPurpose: string | null | undefined,
  reportName: string,
): 'MANAGEMENT_PARTICIPATION' | 'SIMPLE_INVESTMENT' | 'GENERAL_INVESTMENT' | 'UNKNOWN' {
  const text = [rawPurpose ?? '', reportName].join(' ');
  if (/경영\s*참가|경영\s*참여|경영권/.test(text)) return 'MANAGEMENT_PARTICIPATION';
  if (/단순\s*투자/.test(text)) return 'SIMPLE_INVESTMENT';
  if (/일반\s*투자/.test(text)) return 'GENERAL_INVESTMENT';
  return 'UNKNOWN';
}

/**
 * 보유비율 정규화: 소수 비율(0<r<1)이면 *100, 그 외 그대로(% 가정).
 * 음수/NaN/Infinity는 null.
 */
function normalizeRatio(raw: number | null): number | null {
  if (raw === null || !Number.isFinite(raw) || raw < 0) return null;
  if (raw > 0 && raw < 1) return round2(raw * 100);
  return round2(raw);
}

function finiteOrNull(raw: number | null): number | null {
  return raw !== null && Number.isFinite(raw) ? raw : null;
}

function nonEmpty(v: string | null | undefined): string | null {
  if (v === null || v === undefined) return null;
  const trimmed = String(v).trim();
  return trimmed.length > 0 ? trimmed : null;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function emptyResult(): MajorHolder5PctData {
  return {
    holderName: null,
    holdingRatio: null,
    previousHoldingRatio: null,
    holdingRatioChange: null,
    changeDirection: 'UNKNOWN',
    heldShares: null,
    holdingPurpose: 'UNKNOWN',
    reportReason: null,
    derivedDataMissing: true,
  };
}
