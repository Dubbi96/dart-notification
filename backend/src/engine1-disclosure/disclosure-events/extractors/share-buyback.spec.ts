// backend/src/disclosure-events/extractors/share-buyback.spec.ts
// 자기주식 취득·소각 단위 테스트

import { extract, extractCancellation, computeBuybackRatios } from './share-buyback';
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

  // DAR-79: 취득금액 매출·시총 대비 정규화 비율
  describe('정규화 비율 (DAR-79)', () => {
    it('parsedJson.revenue 보유 → buybackRatioToSales 산출 (취득금액/매출*100)', () => {
      const parsed = makeParsedJson({
        acquisitionAmount: 10_000_000_000, // 100억
        revenue: 500_000_000_000, // 5,000억
      });
      const result = extract(parsed, '');
      // 100억 / 5,000억 * 100 = 2.0%
      expect(result.buybackRatioToSales).toBe(2);
      expect(result.derivedDataMissing).toBe(false);
    });

    it('매출 결측 → buybackRatioToSales null, 절대 취득금액은 보존(폴백 가능)', () => {
      const parsed = makeParsedJson({ acquisitionAmount: 10_000_000_000 });
      const result = extract(parsed, '');
      expect(result.buybackRatioToSales).toBeNull();
      expect(result.buybackAmount).toBe(10_000_000_000);
      expect(result.derivedDataMissing).toBe(true);
    });

    it('parsedJson에는 상장주식수·종가 필드가 없어 buybackRatioToMarketCap은 항상 null (한계)', () => {
      const parsed = makeParsedJson({
        acquisitionAmount: 10_000_000_000,
        revenue: 500_000_000_000,
      });
      const result = extract(parsed, '');
      expect(result.buybackRatioToMarketCap).toBeNull();
    });

    it('매출 0/음수 → 0 나눗셈 방지로 null', () => {
      const zero = extract(makeParsedJson({ acquisitionAmount: 1_000, revenue: 0 }), '');
      expect(zero.buybackRatioToSales).toBeNull();
    });

    describe('computeBuybackRatios (SSOT)', () => {
      it('매출·시총 모두 보유 → 두 비율 산출, derivedDataMissing false', () => {
        const r = computeBuybackRatios(10_000_000_000, 500_000_000_000, 200_000_000_000);
        expect(r.buybackRatioToSales).toBe(2); // 100억/5,000억
        expect(r.buybackRatioToMarketCap).toBe(5); // 100억/2,000억
        expect(r.derivedDataMissing).toBe(false);
      });

      it('취득금액 null → 모든 비율 null', () => {
        const r = computeBuybackRatios(null, 500_000_000_000, 200_000_000_000);
        expect(r.buybackRatioToSales).toBeNull();
        expect(r.buybackRatioToMarketCap).toBeNull();
        expect(r.derivedDataMissing).toBe(true);
      });

      it('시총만 보유(매출 결측) → marketCap 비율만 산출', () => {
        const r = computeBuybackRatios(10_000_000_000, null, 200_000_000_000);
        expect(r.buybackRatioToSales).toBeNull();
        expect(r.buybackRatioToMarketCap).toBe(5);
        expect(r.derivedDataMissing).toBe(false);
      });
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
