// backend/src/engine1-disclosure/disclosure-events/extractors/audit-opinion-risk.ts
// 감사의견 리스크 수치 추출 파서 (Rule/정규식 전용, AI 미사용)
// DAR-71: 고위험 공시 5종 구조화 추출기. 보유 parsedJson 재사용 — 신규 DART 호출 0

import { ParsedJson } from '../../disclosure-documents/types/parsed-json.type';

export interface AuditOpinionRiskData {
  // 감사의견 종류 (적정은 고위험 공시 대상 아님 → 결측 시 null)
  auditOpinion:
    | 'QUALIFIED'  // 한정
    | 'ADVERSE'    // 부적정
    | 'DISCLAIMER' // 의견거절
    | null;
  reason: string | null;          // 감사의견 사유
  derivedDataMissing: boolean;    // auditOpinion null 시 true
}

/**
 * parsedJson에서 감사의견 리스크 정보를 추출한다.
 *
 * - auditOpinion: 의견종류 원문/사유/보고서명 키워드 분류.
 *   의견거절 > 부적정 > 한정 순으로 심각도 높은 의견 우선 매칭.
 * - 적정(부정형 키워드 없음)이면 null — 고위험 추출 대상 아님(상위 NEEDS_REVIEW).
 */
export function extract(parsedJson: ParsedJson, reportName: string): AuditOpinionRiskData {
  try {
    const reason = nonEmpty(parsedJson.auditOpinionReason);
    const auditOpinion = inferOpinion(
      parsedJson.auditOpinionType ?? null,
      reason,
      reportName,
    );

    return {
      auditOpinion,
      reason,
      derivedDataMissing: auditOpinion === null,
    };
  } catch {
    return emptyResult();
  }
}

// ─── 내부 유틸 ──────────────────────────────────────────────────────────────

/**
 * 감사의견 종류 분류 — 심각도 높은 의견 우선.
 * 의견거절(DISCLAIMER) > 부적정(ADVERSE) > 한정(QUALIFIED).
 */
function inferOpinion(
  raw: string | null,
  reason: string | null,
  reportName: string,
): AuditOpinionRiskData['auditOpinion'] {
  const text = [raw ?? '', reason ?? '', reportName].join(' ');
  if (/의견\s*거절|의견거절/.test(text)) return 'DISCLAIMER';
  if (/부적정/.test(text)) return 'ADVERSE';
  if (/한정/.test(text)) return 'QUALIFIED';
  return null;
}

function nonEmpty(v: string | null | undefined): string | null {
  if (v === null || v === undefined) return null;
  const trimmed = String(v).trim();
  return trimmed.length > 0 ? trimmed : null;
}

function emptyResult(): AuditOpinionRiskData {
  return {
    auditOpinion: null,
    reason: null,
    derivedDataMissing: true,
  };
}
