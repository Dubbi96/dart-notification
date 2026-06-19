// backend/src/engine1-disclosure/disclosure-events/extractors/trading-suspension.ts
// 거래정지 수치 추출 파서 (Rule/정규식 전용, AI 미사용)
// DAR-71: 고위험 공시 5종 구조화 추출기. 보유 parsedJson 재사용 — 신규 DART 호출 0
// DAR-343: suspensionReason 직접조회만 하던 탓에 사유 결측 시 confidence 0.0 → FAILED(36건).
//   ① 정지사유/원인 키워드 스캔으로 비정규 위치의 사유 회수,
//   ② reportName(불성실공시·감사의견·상폐절차)로 suspensionType 추론(사유 결측이어도),
//   ③ 사유 결측이나 유형 추론 성공 시 reasonInferred=true → index가 부분 confidence 0.7 부여.
//   거래정지 polarity(악재)는 event-classifier 룰(NEGATIVE)에서 보장된다.

import { ParsedJson } from '../../disclosure-documents/types/parsed-json.type';

export interface TradingSuspensionData {
  suspensionReason: string | null;       // 정지 사유
  // 정지 유형 분류 (사유 키워드 + reportName 기반)
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
  // DAR-343: 사유 텍스트는 결측이나 reportName으로 유형(악재) 추론에 성공한 경우 true.
  //          index.calcConfidence가 이 경우 부분 confidence 0.7(NEEDS_REVIEW 경로)을 부여한다.
  reasonInferred: boolean;
}

/**
 * parsedJson에서 거래정지 정보를 추출한다.
 *
 * - suspensionReason: 정규 필드 → 비정규 텍스트 키워드 스캔(DAR-343) 순으로 회수.
 * - suspensionType: 정지 사유/보고서명 키워드 분류(사유 결측이어도 reportName으로 추론).
 * - 날짜: YYYY.MM.DD / YYYY/MM/DD / YYYYMMDD → YYYY-MM-DD 정규화.
 * - 부분 추출 허용: 사유·해제일 결측 흔함 → null 허용. 유형만 추론돼도 reasonInferred로 회수.
 */
export function extract(parsedJson: ParsedJson, reportName: string): TradingSuspensionData {
  try {
    // DAR-343: 정규 필드 우선, 없으면 비정규 위치의 사유를 키워드 스캔으로 회수.
    const suspensionReason =
      nonEmpty(parsedJson.suspensionReason) ?? scanSuspensionReason(parsedJson);
    const suspensionStartDate = normalizeDate(parsedJson.suspensionStartDate ?? null);
    const expectedResumeDate = normalizeDate(parsedJson.expectedResumeDate ?? null);
    // reportName은 사유가 결측이어도 유형 추론에 사용된다.
    const suspensionType = inferType(suspensionReason, reportName);

    // 사유 텍스트는 없지만 유형(악재)을 추론한 경우 → 부분 추출로 회수.
    const reasonInferred = suspensionReason === null && suspensionType !== 'UNKNOWN';

    return {
      suspensionReason,
      suspensionType,
      suspensionStartDate,
      expectedResumeDate,
      derivedDataMissing: suspensionReason === null,
      reasonInferred,
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

/**
 * DAR-343: 정규 suspensionReason 필드가 비었을 때 parsedJson의 임의 문자열 값에서
 * 거래정지 사유를 회수한다(출처 전수조사: 사유가 비정규 키에 적재된 케이스).
 *
 * - 1순위: "정지사유 / 정지 원인 / 사유 / 원인" 라벨 뒤 값.
 * - 2순위: 거래정지·상폐·감사의견·불성실공시 문맥 문장(라벨 없이 서술된 사유).
 * - 매칭 실패 시 null(=유형 추론 또는 FAILED 경로로 위임).
 */
function scanSuspensionReason(parsedJson: ParsedJson): string | null {
  const texts: string[] = [];
  for (const value of Object.values(parsedJson)) {
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (trimmed.length > 0) texts.push(trimmed);
    }
  }

  // 1순위: 사유/원인 라벨 패턴
  for (const text of texts) {
    const labeled = text.match(
      /(?:정지\s*사유|정지\s*원인|사유|원인)\s*[:：\-]\s*([^\n]{2,120})/,
    );
    if (labeled) {
      const reason = labeled[1].trim();
      if (reason.length > 0) return reason;
    }
  }

  // 2순위: 거래정지 위험 문맥 문장(라벨 부재). 과매칭 방지 위해 위험 키워드 + 길이 제한.
  for (const text of texts) {
    if (
      text.length <= 200 &&
      /매매거래\s*정지|거래정지|상장폐지|감사의견\s*거절|감사의견\s*(?:부적정|한정)|불성실공시/.test(
        text,
      )
    ) {
      return text;
    }
  }

  return null;
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
    reasonInferred: false,
  };
}
