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

  // ─── DAR-345: 주당 배당금 회수 폴백(DIRECT → DERIVED) ─────────────────────
  describe('DAR-345 dividendPerShare 폴백', () => {
    it('DIRECT: dividendPerShare 직접값 존재 → source=DIRECT, 유도 안 함', () => {
      const parsed = makeParsedJson({ dividendPerShare: 500, dividendTotal: 25_000_000_000 });
      const result = extract(parsed, '');
      expect(result.dividendPerShare).toBe(500);
      expect(result.dividendPerShareSource).toBe('DIRECT');
      expect(result.partialFieldsPresent).toBe(false);
    });

    it('DERIVED: 직접값 결측·dividendTotal + totalIssuedShares → 주당배당 유도', () => {
      // 250억 / 5천만주 = 500원/주
      const parsed = makeParsedJson({
        dividendTotal: 25_000_000_000,
        totalIssuedShares: 50_000_000,
      } as unknown as Partial<ParsedJson>);
      const result = extract(parsed, '');
      expect(result.dividendPerShare).toBe(500);
      expect(result.dividendPerShareSource).toBe('DERIVED');
      expect(result.partialFieldsPresent).toBe(false);
    });

    it('DERIVED: 발행주식수 대체 라벨(발행주식총수, 문자열·콤마) 회수', () => {
      const parsed = makeParsedJson({
        dividendTotal: 12_000_000_000,
        발행주식총수: '40,000,000주',
      } as unknown as Partial<ParsedJson>);
      const result = extract(parsed, '');
      expect(result.dividendPerShare).toBe(300); // 120억 / 4천만 = 300
      expect(result.dividendPerShareSource).toBe('DERIVED');
    });

    it('회수 실패(주식수 부재)·dividendTotal만 존재 → null + partialFieldsPresent=true(NEEDS_REVIEW)', () => {
      const parsed = makeParsedJson({ dividendTotal: 25_000_000_000 });
      const result = extract(parsed, '');
      expect(result.dividendPerShare).toBeNull();
      expect(result.dividendPerShareSource).toBe('NONE');
      expect(result.partialFieldsPresent).toBe(true);
    });

    it('단서 전무(총액·주당·주식수 모두 결측) → null + partialFieldsPresent=false(FAILED 유지)', () => {
      const result = extract(makeParsedJson(), '');
      expect(result.dividendPerShare).toBeNull();
      expect(result.dividendPerShareSource).toBe('NONE');
      expect(result.partialFieldsPresent).toBe(false);
    });

    it('주식수 0/음수 → 0 나눗셈 방지(유도 안 함)', () => {
      const parsed = makeParsedJson({
        dividendTotal: 25_000_000_000,
        totalIssuedShares: 0,
      } as unknown as Partial<ParsedJson>);
      const result = extract(parsed, '');
      expect(result.dividendPerShare).toBeNull();
      expect(result.dividendPerShareSource).toBe('NONE');
      expect(result.partialFieldsPresent).toBe(true);
    });

    it('DIRECT 우선순위: 직접값·유도 가능 둘 다 → 직접값 채택(유도 무시)', () => {
      const parsed = makeParsedJson({
        dividendPerShare: 480, // 직접값(실제 공시값)
        dividendTotal: 25_000_000_000, // 유도하면 500이지만 직접값 우선
        totalIssuedShares: 50_000_000,
      } as unknown as Partial<ParsedJson>);
      const result = extract(parsed, '');
      expect(result.dividendPerShare).toBe(480);
      expect(result.dividendPerShareSource).toBe('DIRECT');
    });
  });
});
