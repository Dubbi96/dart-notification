// backend/src/engine1-disclosure/disclosure-events/extractors/lawsuit.ts
// 소송·횡령·배임 수치 추출 파서 (Rule/정규식 전용, AI 미사용)
// DAR-71: 고위험 공시 5종 구조화 추출기. 보유 parsedJson 재사용 — 신규 DART 호출 0

import { ParsedJson } from '../../disclosure-documents/types/parsed-json.type';

export interface LawsuitData {
  lawsuitAmount: number | null;   // 소송금액/청구금액 (원)
  claimCause: string | null;      // 청구원인/소송유형 원문
  // 우리 회사(공시 주체)의 소송상 지위
  companyRole: 'PLAINTIFF' | 'DEFENDANT' | 'UNKNOWN';
  // 진행단계 정규화
  litigationStage:
    | 'FILED'        // 소제기
    | 'FIRST_TRIAL'  // 1심
    | 'APPEAL'       // 항소(2심)
    | 'FINAL_APPEAL' // 상고(3심)
    | 'CONCLUDED'    // 확정·종결
    | 'UNKNOWN';
  plaintiff: string | null;       // 원고
  defendant: string | null;       // 피고
  derivedDataMissing: boolean;    // lawsuitAmount null 시 true
}

/**
 * parsedJson에서 소송 정보를 추출한다.
 *
 * - companyRole: 명시적 plaintiff/defendant 매칭 우선, 없으면 보고서명/사유 키워드(피소·피고 → DEFENDANT) 추정.
 * - litigationStage: 진행단계 원문 키워드 분류 (상고 > 항소 > 1심 순으로 구체 단계 우선).
 * - 부분 추출 허용: 일부 필드 결측이어도 throw 없이 가용 필드만 채운다.
 */
export function extract(parsedJson: ParsedJson, reportName: string): LawsuitData {
  try {
    const lawsuitAmount = toNumber(parsedJson.lawsuitAmount);
    const claimCause = nonEmpty(parsedJson.claimCause);
    const plaintiff = nonEmpty(parsedJson.plaintiff);
    const defendant = nonEmpty(parsedJson.defendant);

    const companyRole = inferCompanyRole(plaintiff, defendant, claimCause, reportName);
    const litigationStage = inferLitigationStage(parsedJson.litigationStage ?? null, reportName);

    return {
      lawsuitAmount,
      claimCause,
      companyRole,
      litigationStage,
      plaintiff,
      defendant,
      derivedDataMissing: lawsuitAmount === null,
    };
  } catch {
    return emptyResult();
  }
}

// ─── 내부 유틸 ──────────────────────────────────────────────────────────────

/**
 * 공시 주체(우리 회사)의 소송상 지위 추정.
 * 1) 명시 plaintiff/defendant 필드가 회사 자기지칭(당사·본 회사 등)이면 그 지위 채택.
 * 2) 없으면 보고서명·사유 키워드: "피소/피고/피청구/상대로" → DEFENDANT,
 *    "제소/원고/소 제기" → PLAINTIFF.
 */
function inferCompanyRole(
  plaintiff: string | null,
  defendant: string | null,
  claimCause: string | null,
  reportName: string,
): 'PLAINTIFF' | 'DEFENDANT' | 'UNKNOWN' {
  const selfRef = /당사|본\s*회사|당\s*회사|보고\s*회사/;
  if (defendant && selfRef.test(defendant)) return 'DEFENDANT';
  if (plaintiff && selfRef.test(plaintiff)) return 'PLAINTIFF';

  const text = [claimCause ?? '', reportName].join(' ');
  if (/피소|피고|피청구|당사를?\s*상대로|상대로\s*한\s*소/.test(text)) return 'DEFENDANT';
  if (/제소|원고|소\s*제기|소송\s*제기|당사가\s*제기/.test(text)) return 'PLAINTIFF';
  return 'UNKNOWN';
}

/** 진행단계 키워드 분류 — 구체 단계(상고/항소) 우선 */
function inferLitigationStage(
  raw: string | null,
  reportName: string,
): LawsuitData['litigationStage'] {
  const text = [raw ?? '', reportName].join(' ');
  if (/확정|종결|취하|기각\s*확정|화해/.test(text)) return 'CONCLUDED';
  if (/상고|3심|대법원/.test(text)) return 'FINAL_APPEAL';
  if (/항소|2심/.test(text)) return 'APPEAL';
  if (/1심|제1심|판결\s*선고/.test(text)) return 'FIRST_TRIAL';
  if (/소\s*제기|소제기|제소|소송\s*제기/.test(text)) return 'FILED';
  return 'UNKNOWN';
}

function toNumber(v: number | null | undefined): number | null {
  if (v === null || v === undefined) return null;
  return Number.isFinite(v) ? v : null;
}

function nonEmpty(v: string | null | undefined): string | null {
  if (v === null || v === undefined) return null;
  const trimmed = String(v).trim();
  return trimmed.length > 0 ? trimmed : null;
}

function emptyResult(): LawsuitData {
  return {
    lawsuitAmount: null,
    claimCause: null,
    companyRole: 'UNKNOWN',
    litigationStage: 'UNKNOWN',
    plaintiff: null,
    defendant: null,
    derivedDataMissing: true,
  };
}
