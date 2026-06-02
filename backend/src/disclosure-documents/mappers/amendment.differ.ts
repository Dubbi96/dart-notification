// backend/src/disclosure-documents/mappers/amendment.differ.ts
// 원공시 parsedJson vs 정정공시 parsedJson → AmendmentDiff 계산

import { ParsedJson } from '../types/parsed-json.type';
import {
  AmendmentDiff,
  FieldDiff,
  ChangeType,
} from '../types/amendment-diff.type';

// 숫자 필드 판단 (KV-02 기반)
const NUMERIC_FIELDS = new Set<string>([
  'contractAmount',
  'recentSales',
  'salesRatio',
  'acquisitionShares',
  'acquisitionAmount',
  'cancellationShares',
  'cancellationAmount',
  'dividendTotal',
  'dividendPerShare',
  'dividendYield',
  'newShares',
  'fundingAmount',
  'discountRate',
  'existingShares',
  'dilutionRate',
  'issuanceAmount',
  'conversionPrice',
  'interestRate',
  'rawTableCount',
]);

/**
 * 원공시 parsedJson vs 정정공시 parsedJson → AmendmentDiff 계산
 *
 * @param originalJson  원공시 parsedJson (null이면 diff 계산 불가 → null 반환)
 * @param amendmentJson 정정공시 parsedJson
 * @param originalRcpNo 원공시 rcpNo
 * @param amendmentRcpNo 정정공시 rcpNo
 *
 * 계산 규칙:
 *   - 최상위 키만 비교 (1-depth flat diff)
 *   - 원공시에만 있는 키: REMOVED
 *   - 정정공시에만 있는 키: ADDED
 *   - 값이 다른 키: MODIFIED
 *   - 숫자 필드: changePct 계산
 *   - rawText diff 저장 안 함 (용량 과다)
 */
export function computeAmendmentDiff(
  originalJson: ParsedJson | null,
  amendmentJson: ParsedJson,
  originalRcpNo: string,
  amendmentRcpNo: string,
): AmendmentDiff | null {
  if (!originalJson) return null;

  const changedFields: FieldDiff[] = [];

  // 비교에서 제외할 메타 필드
  const META_FIELDS = new Set(['docType', 'rawTableCount', 'keyValueSource']);

  const origObj = originalJson as unknown as Record<string, unknown>;
  const amendObj = amendmentJson as unknown as Record<string, unknown>;

  const allKeys = new Set([
    ...Object.keys(origObj),
    ...Object.keys(amendObj),
  ]);

  for (const key of allKeys) {
    if (META_FIELDS.has(key)) continue;

    const hasOrig = key in origObj;
    const hasAmend = key in amendObj;

    if (!hasOrig && hasAmend) {
      // ADDED: 정정공시에만 있는 필드
      changedFields.push({
        field: key,
        before: null,
        after: amendObj[key],
        changeType: 'ADDED' as ChangeType,
      });
    } else if (hasOrig && !hasAmend) {
      // REMOVED: 원공시에만 있는 필드
      changedFields.push({
        field: key,
        before: origObj[key],
        after: null,
        changeType: 'REMOVED' as ChangeType,
      });
    } else if (hasOrig && hasAmend) {
      const before = origObj[key];
      const after = amendObj[key];

      if (before !== after && JSON.stringify(before) !== JSON.stringify(after)) {
        const diff: FieldDiff = {
          field: key,
          before,
          after,
          changeType: 'MODIFIED' as ChangeType,
        };

        // 숫자 필드: changePct 계산
        if (
          NUMERIC_FIELDS.has(key) &&
          typeof before === 'number' &&
          typeof after === 'number' &&
          before !== 0
        ) {
          const pct = (after - before) / Math.abs(before);
          diff.changePct = Math.round(pct * 10000) / 10000;
        }

        changedFields.push(diff);
      }
    }
  }

  // summary 생성: 변경된 숫자 필드 중 첫 번째를 기반으로
  const summary = buildSummary(changedFields);

  return {
    originalRcpNo,
    amendmentRcpNo,
    changedFields,
    summary,
  };
}

/**
 * diff 변경 필드 중 첫 번째 숫자 MODIFIED 필드로 요약 문자열 생성
 * 예: "계약금액 1,000억 → 1,200억 (+20.0%)"
 */
function buildSummary(changedFields: FieldDiff[]): string {
  if (changedFields.length === 0) return '변경 없음';

  // MODIFIED 숫자 필드 우선
  const numericChange = changedFields.find(
    (f) =>
      f.changeType === 'MODIFIED' &&
      typeof f.before === 'number' &&
      typeof f.after === 'number',
  );

  if (numericChange) {
    const before = numericChange.before as number;
    const after = numericChange.after as number;
    const pct = numericChange.changePct;

    const beforeStr = formatKoreanAmount(before);
    const afterStr = formatKoreanAmount(after);
    const pctStr =
      pct !== undefined
        ? ` (${pct >= 0 ? '+' : ''}${(pct * 100).toFixed(1)}%)`
        : '';

    return `${numericChange.field} ${beforeStr} → ${afterStr}${pctStr}`;
  }

  // 변경 수만 요약
  const addedCount = changedFields.filter((f) => f.changeType === 'ADDED').length;
  const removedCount = changedFields.filter(
    (f) => f.changeType === 'REMOVED',
  ).length;
  const modifiedCount = changedFields.filter(
    (f) => f.changeType === 'MODIFIED',
  ).length;

  const parts: string[] = [];
  if (modifiedCount > 0) parts.push(`수정 ${modifiedCount}건`);
  if (addedCount > 0) parts.push(`추가 ${addedCount}건`);
  if (removedCount > 0) parts.push(`삭제 ${removedCount}건`);

  return parts.join(', ') || '변경 있음';
}

/**
 * 숫자를 한국식 금액 표기로 변환 (표시용)
 */
function formatKoreanAmount(num: number): string {
  if (Math.abs(num) >= 100_000_000) {
    return `${(num / 100_000_000).toLocaleString('ko-KR', { maximumFractionDigits: 0 })}억`;
  }
  if (Math.abs(num) >= 10_000) {
    return `${(num / 10_000).toLocaleString('ko-KR', { maximumFractionDigits: 0 })}만`;
  }
  return num.toLocaleString('ko-KR');
}
