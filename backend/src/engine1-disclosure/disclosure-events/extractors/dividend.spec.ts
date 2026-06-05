// backend/src/disclosure-events/extractors/dividend.spec.ts
// 배당 추출 파서 단위 테스트

import { extract } from './dividend';
import { ParsedJson } from '../../disclosure-documents/types/parsed-json.type';
import * as sampleFixture from '../__fixtures__/dividend-increase-sample.json';

function makeParsedJson(overrides: Partial<ParsedJson> = {}): ParsedJson {
  return {
    docType: 'DIVIDEND',
    rawTableCount: 1,
    keyValueSource: 'table_0',
    ...overrides,
  } as ParsedJson;
}

describe('dividend extract', () => {
  describe('dividendYield 변환', () => {
    it('소수점 4자리(0.025) → % 단위(2.5)', () => {
      const parsed = makeParsedJson({ dividendYield: 0.025 });
      const result = extract(parsed, '');
      expect(result.dividendYield).toBe(2.5);
    });

    it('sampleFixture → dividendYield 변환', () => {
      const result = extract(sampleFixture as ParsedJson, '현금배당 결정');
      expect(result.dividendPerShare).toBe(500);
      expect(result.dividendYield).toBe(2.5);
      expect(result.dividendTotal).toBe(25_000_000_000);
    });

    it('dividendYield null → null', () => {
      const result = extract(makeParsedJson(), '');
      expect(result.dividendYield).toBeNull();
    });
  });

  describe('changeRate 계산', () => {
    it('전년 데이터 없으면 changeRate = null', () => {
      const result = extract(makeParsedJson({ dividendPerShare: 500 }), '');
      expect(result.changeRate).toBeNull();
      expect(result.previousDividendPerShare).toBeNull();
    });
  });

  describe('dividendType 분류', () => {
    it('docType에 "현물" 포함 → STOCK', () => {
      const parsed = makeParsedJson({ docType: '현물배당' });
      const result = extract(parsed, '');
      expect(result.dividendType).toBe('STOCK');
    });

    it('DIVIDEND docType → CASH', () => {
      const parsed = makeParsedJson({ docType: 'DIVIDEND' });
      const result = extract(parsed, '');
      expect(result.dividendType).toBe('CASH');
    });
  });

  describe('날짜 정규화', () => {
    it('dividendRecordDate YYYY.MM.DD → YYYY-MM-DD', () => {
      const parsed = makeParsedJson({ dividendRecordDate: '2024.12.31' });
      const result = extract(parsed, '');
      expect(result.recordDate).toBe('2024-12-31');
    });
  });

  describe('예외 내성', () => {
    it('모든 필드 undefined → throw 없음', () => {
      const parsed = { docType: 'DIVIDEND', rawTableCount: 0, keyValueSource: 'none' } as ParsedJson;
      expect(() => extract(parsed, '')).not.toThrow();
    });
  });
});
