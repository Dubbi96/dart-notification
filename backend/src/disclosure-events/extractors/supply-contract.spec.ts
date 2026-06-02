// backend/src/disclosure-events/extractors/supply-contract.spec.ts
// 공급계약 추출 파서 단위 테스트

import { extract } from './supply-contract';
import { ParsedJson } from '../../disclosure-documents/types/parsed-json.type';
import * as sampleFixture from '../__fixtures__/supply-contract-sample.json';
import * as missingSalesFixture from '../__fixtures__/supply-contract-missing-sales.json';

function makeParsedJson(overrides: Partial<ParsedJson> = {}): ParsedJson {
  return {
    docType: 'SUPPLY_CONTRACT',
    rawTableCount: 1,
    keyValueSource: 'table_0',
    ...overrides,
  } as ParsedJson;
}

describe('supply-contract extract', () => {
  describe('salesRatio 계산', () => {
    it('contractAmount / recentSales * 100을 소수점 2자리로 반환', () => {
      const parsed = makeParsedJson({
        contractAmount: 120_000_000_000,
        recentSales: 500_000_000_000,
      });
      const result = extract(parsed, '단일판매·공급계약체결');
      expect(result.salesRatio).toBe(24.0);
    });

    it('sampleFixture 기반 salesRatio 계산', () => {
      const result = extract(sampleFixture as ParsedJson, '단일판매·공급계약체결');
      expect(result.contractAmount).toBe(120_000_000_000);
      expect(result.recentSales).toBe(500_000_000_000);
      expect(result.salesRatio).toBe(24.0);
    });

    it('recentSales null → salesRatio null', () => {
      const parsed = makeParsedJson({ contractAmount: 50_000_000_000 });
      const result = extract(parsed, '');
      expect(result.salesRatio).toBeNull();
      expect(result.derivedDataMissing).toBe(true);
    });

    it('missingSalesFixture → salesRatio null', () => {
      const result = extract(missingSalesFixture as ParsedJson, '단일판매·공급계약체결');
      expect(result.salesRatio).toBeNull();
      expect(result.derivedDataMissing).toBe(true);
    });

    it('recentSales = 0 → salesRatio null (0으로 나누기 방지)', () => {
      const parsed = makeParsedJson({
        contractAmount: 10_000_000_000,
        recentSales: 0,
      });
      const result = extract(parsed, '');
      expect(result.salesRatio).toBeNull();
    });

    it('작은 금액 비율 계산 (소수점)', () => {
      const parsed = makeParsedJson({
        contractAmount: 1_000_000_000,    // 10억
        recentSales: 100_000_000_000,    // 1000억
      });
      const result = extract(parsed, '');
      expect(result.salesRatio).toBe(1.0);
    });
  });

  describe('contractDurationMonths 계산', () => {
    it('12개월 기간 계산', () => {
      const parsed = makeParsedJson({
        contractStartDate: '2024-06-01',
        contractEndDate: '2025-05-31',
      });
      const result = extract(parsed, '');
      expect(result.contractDurationMonths).toBe(12);
    });

    it('날짜 없으면 null', () => {
      const result = extract(makeParsedJson(), '');
      expect(result.contractDurationMonths).toBeNull();
    });

    it('startDate만 있고 endDate 없으면 null', () => {
      const parsed = makeParsedJson({ contractStartDate: '2024-01-01' });
      const result = extract(parsed, '');
      expect(result.contractDurationMonths).toBeNull();
    });
  });

  describe('날짜 정규화', () => {
    it('YYYY.MM.DD 형식 정규화', () => {
      const parsed = makeParsedJson({
        contractStartDate: '2024.06.01',
        contractEndDate: '2025.05.31',
      });
      const result = extract(parsed, '');
      expect(result.contractStartDate).toBe('2024-06-01');
      expect(result.contractEndDate).toBe('2025-05-31');
    });

    it('이미 YYYY-MM-DD 형식이면 그대로', () => {
      const parsed = makeParsedJson({ contractStartDate: '2024-07-01' });
      const result = extract(parsed, '');
      expect(result.contractStartDate).toBe('2024-07-01');
    });
  });

  describe('counterpartyType', () => {
    it('영문 포함 거래상대방 → FOREIGN', () => {
      const parsed = makeParsedJson({ counterparty: 'Apple Inc.' });
      const result = extract(parsed, '');
      expect(result.counterpartyType).toBe('FOREIGN');
    });

    it('한글만 → UNKNOWN', () => {
      const parsed = makeParsedJson({ counterparty: '국내주식회사' });
      const result = extract(parsed, '');
      expect(result.counterpartyType).toBe('UNKNOWN');
    });

    it('거래상대방 없으면 UNKNOWN', () => {
      const result = extract(makeParsedJson(), '');
      expect(result.counterpartyType).toBe('UNKNOWN');
    });
  });

  describe('예외 내성', () => {
    it('parsedJson이 모두 undefined여도 빈 결과 반환 (throw 없음)', () => {
      const parsed = { docType: 'SUPPLY_CONTRACT', rawTableCount: 0, keyValueSource: 'none' } as ParsedJson;
      expect(() => extract(parsed, '')).not.toThrow();
      const result = extract(parsed, '');
      expect(result.contractAmount).toBeNull();
      expect(result.salesRatio).toBeNull();
    });
  });
});
