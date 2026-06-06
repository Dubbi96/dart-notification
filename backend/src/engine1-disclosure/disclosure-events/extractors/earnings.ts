// backend/src/disclosure-events/extractors/earnings.ts
// 실적(서프라이즈·쇼크) 수치 추출 파서 (Rule/정규식 전용, AI 미사용)
// DAR-58: 영업(잠정)실적·손익구조변동 공시의 보유 parsedJson 재사용 — 신규 DART 호출 0

import { ParsedJson } from '../../disclosure-documents/types/parsed-json.type';

// YoY 영업이익 증감률 임계값 (서프라이즈/쇼크 판정)
const SURPRISE_THRESHOLD = 20; // +20% 이상 → SURPRISE
const SHOCK_THRESHOLD = -20; // -20% 이하 → SHOCK

export interface EarningsData {
  revenue: number | null;                  // 매출액 (원)
  operatingProfit: number | null;          // 영업이익 (원, 음수=손실)
  netProfit: number | null;                // 당기순이익 (원)
  previousOperatingProfit: number | null;  // 전년 동기 영업이익 (원)
  operatingProfitYoY: number | null;       // 파생값: 영업이익 YoY 증감률 (%)
  surpriseDirection: 'SURPRISE' | 'SHOCK' | 'NEUTRAL' | 'UNKNOWN';
  isProfitTransition: boolean;             // 흑자전환
  isLossTransition: boolean;               // 적자전환
  derivedDataMissing: boolean;
}

/**
 * parsedJson에서 실적 수치를 추출한다.
 *
 * 파생값:
 *   operatingProfitYoY = (operatingProfit - previousOperatingProfit) / |previousOperatingProfit| * 100
 *     (parsedJson.operatingProfitYoY 소수 비율(0.30)이 있으면 우선 사용 → *100)
 *
 * surpriseDirection 판정 순서:
 *   1. 흑자전환(전년 손실→당기 이익) → SURPRISE / 적자전환 → SHOCK
 *   2. YoY ≥ +20% → SURPRISE, ≤ -20% → SHOCK, 그 사이 → NEUTRAL
 *   3. 수치 없으면 보고서명 키워드 → SURPRISE/SHOCK, 미상 → UNKNOWN
 */
export function extract(parsedJson: ParsedJson, reportName: string): EarningsData {
  try {
    const revenue = parsedJson.revenue ?? null;
    const operatingProfit = parsedJson.operatingProfit ?? null;
    const netProfit = parsedJson.netProfit ?? null;
    const previousOperatingProfit = parsedJson.previousOperatingProfit ?? null;

    // operatingProfitYoY: 소수 비율(예: 0.30)이면 *100, 그 외 직접 계산
    let operatingProfitYoY: number | null = null;
    const rawYoY = parsedJson.operatingProfitYoY ?? null;
    if (rawYoY !== null) {
      operatingProfitYoY =
        Math.abs(rawYoY) > 0 && Math.abs(rawYoY) < 1 ? round2(rawYoY * 100) : round2(rawYoY);
    } else if (
      operatingProfit !== null &&
      previousOperatingProfit !== null &&
      previousOperatingProfit !== 0
    ) {
      operatingProfitYoY = round2(
        ((operatingProfit - previousOperatingProfit) / Math.abs(previousOperatingProfit)) * 100,
      );
    }

    // 흑자/적자 전환 판정 (전년·당기 부호 변화)
    const isProfitTransition =
      previousOperatingProfit !== null &&
      operatingProfit !== null &&
      previousOperatingProfit < 0 &&
      operatingProfit > 0;
    const isLossTransition =
      previousOperatingProfit !== null &&
      operatingProfit !== null &&
      previousOperatingProfit > 0 &&
      operatingProfit < 0;

    const surpriseDirection = inferDirection(
      operatingProfitYoY,
      isProfitTransition,
      isLossTransition,
      reportName,
    );

    const derivedDataMissing = operatingProfitYoY === null;

    return {
      revenue,
      operatingProfit,
      netProfit,
      previousOperatingProfit,
      operatingProfitYoY,
      surpriseDirection,
      isProfitTransition,
      isLossTransition,
      derivedDataMissing,
    };
  } catch {
    return emptyResult();
  }
}

// ─── 내부 유틸 ──────────────────────────────────────────────────────────────

function inferDirection(
  yoY: number | null,
  isProfitTransition: boolean,
  isLossTransition: boolean,
  reportName: string,
): 'SURPRISE' | 'SHOCK' | 'NEUTRAL' | 'UNKNOWN' {
  if (isProfitTransition) return 'SURPRISE';
  if (isLossTransition) return 'SHOCK';
  if (yoY !== null) {
    if (yoY >= SURPRISE_THRESHOLD) return 'SURPRISE';
    if (yoY <= SHOCK_THRESHOLD) return 'SHOCK';
    return 'NEUTRAL';
  }
  // 수치 부재 → 보고서명 키워드 보조 판정
  if (/적자\s*전환|영업\s*손실|순\s*손실|쇼크|악화|급감|감소/.test(reportName)) return 'SHOCK';
  if (/흑자\s*전환|서프라이즈|개선|호조|급증|증가|확대/.test(reportName)) return 'SURPRISE';
  return 'UNKNOWN';
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function emptyResult(): EarningsData {
  return {
    revenue: null,
    operatingProfit: null,
    netProfit: null,
    previousOperatingProfit: null,
    operatingProfitYoY: null,
    surpriseDirection: 'UNKNOWN',
    isProfitTransition: false,
    isLossTransition: false,
    derivedDataMissing: true,
  };
}
