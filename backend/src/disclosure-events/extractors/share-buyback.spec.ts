// backend/src/disclosure-events/extractors/share-buyback.spec.ts
// 자기주식 취득·소각 단위 테스트

import { extract, extractCancellation } from './share-buyback';
import { ParsedJson } from '../../disclosure-documents/types/parsed-json.type';
import * as sampleFixture from '../__fixtures__/share-buyback-sample.json';

function makeParsedJson(overrides: Partial<ParsedJson> = {}): ParsedJson {
  return {
    docType: 'SHARE_BUYBACK',
    rawTableCount: 1,
    keyValueSource: 'table_0',
    ...overrides,
  } as ParsedJson;
}

describe('share-buyback extract', () => {
  describe('buybackRatioToTotal', () => {
    it('totalIssuedShares 미확보 → buybackRatioToTotal null', () => {
      const parsed = makeParsedJson({
        acquisitionShares: 2_000_000,
        acquisitionAmount: 10_000_000_000,
      });
      const result = extract(parsed, '');
      expect(result.buybackRatioToTotal).toBeNull();
      expect(result.derivedDataMissing).toBe(true);
    });

    it('sampleFixture → buybackRatioToTotal null (외부 데이터 미확보)', () => {
      const result = extract(sampleFixture as ParsedJson, '자기주식 취득');
      expect(result.buybackRatioToTotal).toBeNull();
      expect(result.buybackShares).toBe(2_000_000);
      expect(result.buybackAmount).toBe(10_000_000_000);
    });
  });

  describe('날짜 파싱', () => {
    it('acquisitionStartDate / acquisitionEndDate 정규화', () => {
      const parsed = makeParsedJson({
        acquisitionStartDate: '2024.06.01',
        acquisitionEndDate: '2024.08.31',
      });
      const result = extract(parsed, '');
      expect(result.buybackPeriodStart).toBe('2024-06-01');
      expect(result.buybackPeriodEnd).toBe('2024-08-31');
    });
  });

  describe('예외 내성', () => {
    it('모든 필드 undefined → throw 없음', () => {
      const parsed = { docType: 'SHARE_BUYBACK', rawTableCount: 0, keyValueSource: 'none' } as ParsedJson;
      expect(() => extract(parsed, '')).not.toThrow();
    });
  });
});

describe('share-cancellation extractCancellation', () => {
  it('cancellationShares 추출', () => {
    const parsed = makeParsedJson({ cancellationShares: 1_000_000 });
    const result = extractCancellation(parsed, '');
    expect(result.cancellationShares).toBe(1_000_000);
    expect(result.cancellationRatioToTotal).toBeNull();
    expect(result.derivedDataMissing).toBe(true);
  });

  it('모든 필드 없어도 throw 없음', () => {
    const parsed = { docType: 'SHARE_CANCELLATION', rawTableCount: 0, keyValueSource: 'none' } as ParsedJson;
    expect(() => extractCancellation(parsed, '')).not.toThrow();
  });
});
