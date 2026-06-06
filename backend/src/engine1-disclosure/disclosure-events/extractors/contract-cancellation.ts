// backend/src/engine1-disclosure/disclosure-events/extractors/contract-cancellation.ts
// 단일판매·공급계약 해제 수치 추출 파서 (Rule/정규식 전용, AI 미사용)
// DAR-71: 고위험 공시 5종 구조화 추출기. 보유 parsedJson 재사용 — 신규 DART 호출 0

import { ParsedJson } from '../../disclosure-documents/types/parsed-json.type';

export interface ContractCancellationData {
  cancelledAmount: number | null;     // 해제된 계약금액 (원)
  originalAmount: number | null;      // 기존(원) 계약금액 (원)
  // 파생값: 해제금액 / 기존계약금액 * 100 (해제 규모 비율, %)
  cancelledRatio: number | null;
  counterparty: string | null;        // 거래상대방
  reason: string | null;              // 해제 사유
  derivedDataMissing: boolean;        // cancelledAmount null 시 true
}

/**
 * parsedJson에서 계약 해제 정보를 추출한다.
 *
 * - cancelledRatio: 해제금액·기존계약금액이 모두 있을 때만 산출, 그 외 null.
 *   기존계약금액 결측 시 cancelledAmount 자체를 기존액으로 간주하지 않고 null 유지(과대평가 방지).
 * - counterparty는 SUPPLY_CONTRACT와 동일 필드 재사용.
 * - 부분 추출 허용: 일부 결측이어도 가용 필드만 채운다.
 */
export function extract(parsedJson: ParsedJson, _reportName: string): ContractCancellationData {
  try {
    const cancelledAmount = toNumber(parsedJson.cancelledContractAmount);
    const originalAmount = toNumber(parsedJson.originalContractAmount);
    const counterparty = nonEmpty(parsedJson.counterparty);
    const reason = nonEmpty(parsedJson.cancellationReason);

    const cancelledRatio =
      cancelledAmount !== null && originalAmount !== null && originalAmount !== 0
        ? round2((cancelledAmount / originalAmount) * 100)
        : null;

    return {
      cancelledAmount,
      originalAmount,
      cancelledRatio,
      counterparty,
      reason,
      derivedDataMissing: cancelledAmount === null,
    };
  } catch {
    return emptyResult();
  }
}

// ─── 내부 유틸 ──────────────────────────────────────────────────────────────

function toNumber(v: number | null | undefined): number | null {
  if (v === null || v === undefined) return null;
  return Number.isFinite(v) ? v : null;
}

function nonEmpty(v: string | null | undefined): string | null {
  if (v === null || v === undefined) return null;
  const trimmed = String(v).trim();
  return trimmed.length > 0 ? trimmed : null;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function emptyResult(): ContractCancellationData {
  return {
    cancelledAmount: null,
    originalAmount: null,
    cancelledRatio: null,
    counterparty: null,
    reason: null,
    derivedDataMissing: true,
  };
}
