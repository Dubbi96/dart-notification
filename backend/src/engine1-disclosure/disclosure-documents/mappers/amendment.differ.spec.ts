// backend/src/disclosure-documents/mappers/amendment.differ.spec.ts
import { computeAmendmentDiff } from './amendment.differ';
import { ParsedJson } from '../types/parsed-json.type';

const BASE_ORIGINAL: ParsedJson = {
  docType: 'SUPPLY_CONTRACT',
  rawTableCount: 1,
  keyValueSource: 'table_0',
  contractAmount: 120_000_000_000,
  recentSales: 500_000_000_000,
  salesRatio: 0.24,
  counterparty: '거래상대방A',
  contractStartDate: '2024-06-01',
  contractEndDate: '2025-05-31',
};

describe('computeAmendmentDiff', () => {
  it('originalJson이 null이면 null을 반환해야 한다', () => {
    const amendment: ParsedJson = {
      docType: 'SUPPLY_CONTRACT',
      rawTableCount: 1,
      keyValueSource: 'table_0',
      contractAmount: 150_000_000_000,
    };
    const result = computeAmendmentDiff(null, amendment, 'orig', 'amend');
    expect(result).toBeNull();
  });

  it('MODIFIED 변경을 감지해야 한다', () => {
    const amendment: ParsedJson = {
      ...BASE_ORIGINAL,
      contractAmount: 150_000_000_000,
    };
    const result = computeAmendmentDiff(
      BASE_ORIGINAL,
      amendment,
      '20240601000001',
      '20240615000001',
    );
    expect(result).not.toBeNull();
    const modField = result!.changedFields.find(
      (f) => f.field === 'contractAmount',
    );
    expect(modField).toBeDefined();
    expect(modField!.changeType).toBe('MODIFIED');
    expect(modField!.before).toBe(120_000_000_000);
    expect(modField!.after).toBe(150_000_000_000);
  });

  it('숫자 필드의 changePct를 계산해야 한다', () => {
    const amendment: ParsedJson = {
      ...BASE_ORIGINAL,
      contractAmount: 150_000_000_000, // +25%
    };
    const result = computeAmendmentDiff(
      BASE_ORIGINAL,
      amendment,
      '20240601000001',
      '20240615000001',
    );
    const modField = result!.changedFields.find(
      (f) => f.field === 'contractAmount',
    );
    expect(modField!.changePct).toBeCloseTo(0.25, 3);
  });

  it('ADDED 변경을 감지해야 한다', () => {
    const amendment: ParsedJson = {
      ...BASE_ORIGINAL,
      dividendTotal: 10_000_000_000, // 원공시에 없는 필드 추가
    };
    const result = computeAmendmentDiff(
      BASE_ORIGINAL,
      amendment,
      'orig',
      'amend',
    );
    const addedField = result!.changedFields.find(
      (f) => f.field === 'dividendTotal',
    );
    expect(addedField).toBeDefined();
    expect(addedField!.changeType).toBe('ADDED');
    expect(addedField!.before).toBeNull();
  });

  it('REMOVED 변경을 감지해야 한다', () => {
    const original: ParsedJson = {
      ...BASE_ORIGINAL,
      counterparty: '거래상대방A',
    };
    const amendment: ParsedJson = {
      docType: 'SUPPLY_CONTRACT',
      rawTableCount: 1,
      keyValueSource: 'table_0',
      contractAmount: 120_000_000_000,
      recentSales: 500_000_000_000,
      salesRatio: 0.24,
      contractStartDate: '2024-06-01',
      contractEndDate: '2025-05-31',
      // counterparty 제거됨
    };
    const result = computeAmendmentDiff(original, amendment, 'orig', 'amend');
    const removedField = result!.changedFields.find(
      (f) => f.field === 'counterparty',
    );
    expect(removedField).toBeDefined();
    expect(removedField!.changeType).toBe('REMOVED');
    expect(removedField!.after).toBeNull();
  });

  it('변경이 없으면 changedFields가 비어야 한다', () => {
    const result = computeAmendmentDiff(
      BASE_ORIGINAL,
      { ...BASE_ORIGINAL },
      'orig',
      'amend',
    );
    expect(result).not.toBeNull();
    expect(result!.changedFields).toHaveLength(0);
    expect(result!.summary).toBe('변경 없음');
  });

  it('summary를 생성해야 한다 (숫자 필드 변경 시)', () => {
    const amendment: ParsedJson = {
      ...BASE_ORIGINAL,
      contractAmount: 150_000_000_000,
    };
    const result = computeAmendmentDiff(
      BASE_ORIGINAL,
      amendment,
      'orig',
      'amend',
    );
    expect(result!.summary).toContain('contractAmount');
    expect(result!.summary).toContain('+');
  });

  it('originalRcpNo와 amendmentRcpNo를 올바르게 저장해야 한다', () => {
    const result = computeAmendmentDiff(
      BASE_ORIGINAL,
      { ...BASE_ORIGINAL, contractAmount: 150_000_000_000 },
      '20240601000001',
      '20240615000001',
    );
    expect(result!.originalRcpNo).toBe('20240601000001');
    expect(result!.amendmentRcpNo).toBe('20240615000001');
  });

  it('메타 필드(docType, rawTableCount, keyValueSource)는 비교에서 제외해야 한다', () => {
    const original: ParsedJson = {
      ...BASE_ORIGINAL,
      docType: 'SUPPLY_CONTRACT',
      rawTableCount: 1,
      keyValueSource: 'table_0',
    };
    const amendment: ParsedJson = {
      ...BASE_ORIGINAL,
      docType: 'SUPPLY_CONTRACT',
      rawTableCount: 2,  // 메타 필드 변경
      keyValueSource: 'table_1',  // 메타 필드 변경
    };
    const result = computeAmendmentDiff(original, amendment, 'orig', 'amend');
    // 메타 필드 변경은 changedFields에 포함되지 않아야 함
    const metaChanges = result!.changedFields.filter((f) =>
      ['docType', 'rawTableCount', 'keyValueSource'].includes(f.field),
    );
    expect(metaChanges).toHaveLength(0);
  });
});
