// backend/src/engine1-disclosure/disclosure-events/extractors/delisting-risk.ts
// 상장폐지 위험 수치 추출 파서 (Rule/정규식 전용, AI 미사용)
// DAR-71: 고위험 공시 5종 구조화 추출기. 보유 parsedJson 재사용 — 신규 DART 호출 0

import { ParsedJson } from '../../disclosure-documents/types/parsed-json.type';

export interface DelistingRiskData {
  // 상폐 진행 단계 (심각도: 상폐결정 > 실질심사 > 관리종목지정 > 투자경고)
  delistingStage:
    | 'INVESTMENT_WARNING' // 투자경고·투자위험 지정
    | 'MANAGEMENT_ISSUE'   // 관리종목 지정
    | 'SUBSTANTIVE_REVIEW' // 상장적격성 실질심사
    | 'DELISTING_DECISION' // 상장폐지 결정
    | null;
  reason: string | null;          // 상폐/지정 사유
  derivedDataMissing: boolean;    // delistingStage null 시 true
}

/**
 * parsedJson에서 상장폐지 위험 정보를 추출한다.
 *
 * - delistingStage: 단계 원문/사유/보고서명 키워드 분류.
 *   상폐결정 > 실질심사 > 관리종목지정 > 투자경고 순 심각도 우선.
 * - 키워드 미매칭 시 null — 부분 추출 허용(상위 NEEDS_REVIEW).
 */
export function extract(parsedJson: ParsedJson, reportName: string): DelistingRiskData {
  try {
    const reason = nonEmpty(parsedJson.delistingReason);
    const delistingStage = inferStage(
      parsedJson.delistingStage ?? null,
      reason,
      reportName,
    );

    return {
      delistingStage,
      reason,
      derivedDataMissing: delistingStage === null,
    };
  } catch {
    return emptyResult();
  }
}

// ─── 내부 유틸 ──────────────────────────────────────────────────────────────

/**
 * 상폐 단계 분류 — 심각도 높은 단계 우선.
 * 상폐결정 > 실질심사 > 관리종목지정 > 투자경고.
 */
function inferStage(
  raw: string | null,
  reason: string | null,
  reportName: string,
): DelistingRiskData['delistingStage'] {
  const text = [raw ?? '', reason ?? '', reportName].join(' ');
  if (/상장폐지\s*(결정|확정)|상폐\s*결정|정리매매/.test(text)) return 'DELISTING_DECISION';
  if (/실질\s*심사|상장적격성|적격성\s*심사/.test(text)) return 'SUBSTANTIVE_REVIEW';
  if (/관리종목\s*지정|관리종목/.test(text)) return 'MANAGEMENT_ISSUE';
  if (/투자\s*경고|투자\s*위험|투자주의\s*환기/.test(text)) return 'INVESTMENT_WARNING';
  // "상장폐지" 단순 언급(결정 명시 없음)도 위험 신호로 최저 단계 매핑
  if (/상장폐지|상폐/.test(text)) return 'INVESTMENT_WARNING';
  return null;
}

function nonEmpty(v: string | null | undefined): string | null {
  if (v === null || v === undefined) return null;
  const trimmed = String(v).trim();
  return trimmed.length > 0 ? trimmed : null;
}

function emptyResult(): DelistingRiskData {
  return {
    delistingStage: null,
    reason: null,
    derivedDataMissing: true,
  };
}
