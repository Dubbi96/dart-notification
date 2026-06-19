// backend/src/engine1-disclosure/disclosure-events/extractors/lawsuit.ts
// 소송·횡령·배임 수치 추출 파서 (Rule/정규식 전용, AI 미사용)
// DAR-71: 고위험 공시 5종 구조화 추출기. 보유 parsedJson 재사용 — 신규 DART 호출 0

import { ParsedJson } from '../../disclosure-documents/types/parsed-json.type';

// DAR-344: 소송금액 회수 출처 — DIRECT(정형 필드) → REPORT_NAME(보고서명 괄호 금액) → NONE
export type LawsuitAmountSource = 'DIRECT' | 'REPORT_NAME' | 'NONE';

export interface LawsuitData {
  lawsuitAmount: number | null;   // 소송금액/청구금액 (원)
  lawsuitAmountSource: LawsuitAmountSource; // 금액 회수 출처(DAR-344)
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
  // DAR-344: 금액 결측이나 진행단계/청구원인이 확인된 경우 — index.calcConfidence가
  //   0.0(FAILED) 대신 부분 confidence(0.70, NEEDS_REVIEW)를 부여하도록 하는 신호.
  partialFieldsPresent: boolean;
}

/**
 * parsedJson에서 소송 정보를 추출한다.
 *
 * - companyRole: 명시적 plaintiff/defendant 매칭 우선, 없으면 보고서명/사유 키워드(피소·피고 → DEFENDANT) 추정.
 * - litigationStage: 진행단계 원문 키워드 분류 (상고 > 항소 > 1심 순으로 구체 단계 우선).
 * - 부분 추출 허용: 일부 필드 결측이어도 throw 없이 가용 필드만 채운다.
 *
 * DAR-344(소송금액 회수 폴백): lawsuitAmount는 서술형 본문에 묻혀 정형 필드가 비는 경우가 많아
 *   결측 시 FAILED(25건) 되던 소송 공시를 회수한다.
 *   1) lawsuitAmount: DIRECT(정형 필드) → REPORT_NAME(보고서명 괄호 금액 '소제기(100억원 청구)') 폴백.
 *   2) 금액이 끝내 결측이어도 진행단계(litigationStage≠UNKNOWN)나 청구원인(claimCause)이 확인되면
 *      partialFieldsPresent=true → index.calcConfidence가 0.0(FAILED) 대신 0.70(NEEDS_REVIEW)을 부여.
 *   수치를 날조하지 않고 라우팅만 바꾼다. AI 무관·스키마 무변경.
 */
export function extract(parsedJson: ParsedJson, reportName: string): LawsuitData {
  try {
    const directAmount = toNumber(parsedJson.lawsuitAmount);
    let lawsuitAmount = directAmount;
    let lawsuitAmountSource: LawsuitAmountSource = directAmount !== null ? 'DIRECT' : 'NONE';

    // 폴백: 정형 필드 결측 시 보고서명 괄호 금액에서 회수 ('소제기(100억원 청구)' → 100억)
    if (lawsuitAmount === null) {
      const fromName = extractAmountFromReportName(reportName);
      if (fromName !== null) {
        lawsuitAmount = fromName;
        lawsuitAmountSource = 'REPORT_NAME';
      }
    }

    const claimCause = nonEmpty(parsedJson.claimCause);
    const plaintiff = nonEmpty(parsedJson.plaintiff);
    const defendant = nonEmpty(parsedJson.defendant);

    const companyRole = inferCompanyRole(plaintiff, defendant, claimCause, reportName);
    const litigationStage = inferLitigationStage(parsedJson.litigationStage ?? null, reportName);

    // 금액이 끝내 결측이어도 단계/원인이 확인되면 부분 회수 신호(NEEDS_REVIEW 경로)
    const partialFieldsPresent =
      lawsuitAmount === null && (litigationStage !== 'UNKNOWN' || claimCause !== null);

    return {
      lawsuitAmount,
      lawsuitAmountSource,
      claimCause,
      companyRole,
      litigationStage,
      plaintiff,
      defendant,
      derivedDataMissing: lawsuitAmount === null,
      partialFieldsPresent,
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
    lawsuitAmountSource: 'NONE',
    claimCause: null,
    companyRole: 'UNKNOWN',
    litigationStage: 'UNKNOWN',
    plaintiff: null,
    defendant: null,
    derivedDataMissing: true,
    partialFieldsPresent: false,
  };
}

// ─── 보고서명 금액 폴백(DAR-344) ─────────────────────────────────────────────
// 소송 공시는 청구금액이 서술형 본문/보고서명에 묻혀 정형 필드(parsedJson.lawsuitAmount)가
// 비는 경우가 많다. 보고서명 괄호 안의 금액 토큰('소제기(100억원 청구)')에서 회수한다.
// supply-contract/cb-bw 폴백과 동일 패턴의 경량 사본(스코프: lawsuit.ts 전용).

/**
 * 보고서명에서 금액을 추출한다. 예: '소제기(100억원 청구)' → 10,000,000,000.
 * - 괄호 안 토큰을 우선 탐색(보고서명 금액 표기는 통상 괄호 안)
 * - 단위(조/억/백만/천만/만/원)가 붙은 토큰만 인정 → 일자·차수 등 단순 숫자 오추출 방지
 */
function extractAmountFromReportName(reportName: string | null | undefined): number | null {
  if (!reportName) return null;
  try {
    // 조+억 결합('1조2000억')을 단일 토큰으로 먼저 포착, 아니면 단일 단위 토큰
    const amountToken =
      /(\d[\d,]*(?:\.\d+)?\s*조(?:\s*\d[\d,]*(?:\.\d+)?\s*억)?|\d[\d,]*(?:\.\d+)?\s*(?:억|백만|천만|만|원))/;

    // 1) 괄호 안 우선
    const parenMatches = reportName.match(/\(([^)]*)\)/g) ?? [];
    for (const seg of parenMatches) {
      const m = seg.match(amountToken);
      if (m) {
        const amt = parseKoreanAmountLoose(m[1]);
        if (amt !== null) return amt;
      }
    }

    // 2) 보고서명 전체에서 탐색
    const whole = reportName.match(amountToken);
    if (whole) {
      const amt = parseKoreanAmountLoose(whole[1]);
      if (amt !== null) return amt;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * 한국 금액 토큰 → 원 단위 숫자. 조/억/백만/천만/만/원 및 콤마 허용.
 * 양수만 인정(0·음수·미인식 → null). 보고서명 폴백 전용 경량 버전.
 */
function parseKoreanAmountLoose(token: string): number | null {
  if (!token) return null;
  const t = token.replace(/[,\s]/g, '');

  // 조 + (선택)억 결합: 1조2000억
  const joEok = t.match(/^(\d+(?:\.\d+)?)조(?:(\d+(?:\.\d+)?)억)?/);
  if (joEok) {
    const jo = parseFloat(joEok[1]) * 1_000_000_000_000;
    const eok = joEok[2] ? parseFloat(joEok[2]) * 100_000_000 : 0;
    return positive(Math.round(jo + eok));
  }
  const eok = t.match(/^(\d+(?:\.\d+)?)억/);
  if (eok) return positive(Math.round(parseFloat(eok[1]) * 100_000_000));

  const cheonman = t.match(/^(\d+(?:\.\d+)?)천만/);
  if (cheonman) return positive(Math.round(parseFloat(cheonman[1]) * 10_000_000));

  const baekman = t.match(/^(\d+(?:\.\d+)?)백만/);
  if (baekman) return positive(Math.round(parseFloat(baekman[1]) * 1_000_000));

  const man = t.match(/^(\d+(?:\.\d+)?)만/);
  if (man) return positive(Math.round(parseFloat(man[1]) * 10_000));

  // 순수 숫자(+선택 '원')
  const won = t.match(/^(\d+)원?$/);
  if (won) return positive(parseInt(won[1], 10));

  return null;
}

function positive(n: number): number | null {
  return Number.isFinite(n) && n > 0 ? n : null;
}
