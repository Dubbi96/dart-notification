// backend/src/disclosure-events/extractors/capital-increase.spec.ts
// 유상증자 추출 파서 단위 테스트

import { extract } from './capital-increase';
import { ParsedJson } from '../../disclosure-documents/types/parsed-json.type';
import * as rightsFixture from '../__fixtures__/capital-increase-rights.json';
import * as thirdPartyFixture from '../__fixtures__/capital-increase-third-party.json';

function makeParsedJson(overrides: Partial<ParsedJson> = {}): ParsedJson {
  return {
    docType: 'PAID_IN_CAPITAL_INCREASE',
    rawTableCount: 1,
    keyValueSource: 'table_0',
    ...overrides,
  } as ParsedJson;
}

describe('capital-increase extract', () => {
  describe('dilutionRate 계산', () => {
    it('dilutionRate = newShares / (newShares + existingShares) * 100 (SSOT)', () => {
      const parsed = makeParsedJson({
        newShares: 10_000_000,
        existingShares: 50_000_000,
      });
      const result = extract(parsed, '');
      // 10M / (10M + 50M) * 100 = 16.67%
      expect(result.dilutionRate).toBe(16.67);
    });

    it('rightsFixture 기반 dilutionRate 계산 (SSOT)', () => {
      const result = extract(rightsFixture as ParsedJson, '유상증자(주주배정)');
      expect(result.newShares).toBe(10_000_000);
      expect(result.existingShares).toBe(50_000_000);
      expect(result.dilutionRate).toBe(16.67);
    });

    it('existingShares null → dilutionRate null', () => {
      const parsed = makeParsedJson({ newShares: 5_000_000 });
      const result = extract(parsed, '');
      expect(result.dilutionRate).toBeNull();
      expect(result.derivedDataMissing).toBe(true);
    });

    it('existingShares = 0 → dilutionRate null (0으로 나누기 방지)', () => {
      const parsed = makeParsedJson({ newShares: 1_000_000, existingShares: 0 });
      const result = extract(parsed, '');
      expect(result.dilutionRate).toBeNull();
    });
  });

  describe('discountRate 변환', () => {
    it('소수점 할인율(0.10) → 10.0%', () => {
      const parsed = makeParsedJson({ discountRate: 0.10 });
      const result = extract(parsed, '');
      expect(result.discountRate).toBe(10.0);
    });

    it('이미 % 단위(15.0)이면 그대로', () => {
      const parsed = makeParsedJson({ discountRate: 15.0 });
      const result = extract(parsed, '');
      expect(result.discountRate).toBe(15.0);
    });

    it('discountRate null → null', () => {
      const result = extract(makeParsedJson(), '');
      expect(result.discountRate).toBeNull();
    });
  });

  describe('issueType 분류', () => {
    it('주주배정 → RIGHTS_OFFERING', () => {
      const parsed = makeParsedJson({ issueMethod: '주주배정' });
      const result = extract(parsed, '');
      expect(result.issueType).toBe('RIGHTS_OFFERING');
    });

    it('일반공모 → PUBLIC_OFFERING', () => {
      const parsed = makeParsedJson({ issueMethod: '일반공모' });
      const result = extract(parsed, '');
      expect(result.issueType).toBe('PUBLIC_OFFERING');
    });

    it('제3자배정 → THIRD_PARTY', () => {
      const result = extract(thirdPartyFixture as ParsedJson, '유상증자(제3자배정)');
      expect(result.issueType).toBe('THIRD_PARTY');
    });

    it('보고서명에 주주배정 포함 → RIGHTS_OFFERING', () => {
      const result = extract(makeParsedJson(), '유상증자(주주배정) 결정');
      expect(result.issueType).toBe('RIGHTS_OFFERING');
    });

    it('분류 불가 → UNKNOWN', () => {
      const result = extract(makeParsedJson(), '유상증자');
      expect(result.issueType).toBe('UNKNOWN');
    });
  });

  describe('예외 내성', () => {
    it('모든 필드 undefined → throw 없음', () => {
      const parsed = { docType: 'PAID_IN_CAPITAL_INCREASE', rawTableCount: 0, keyValueSource: 'none' } as ParsedJson;
      expect(() => extract(parsed, '')).not.toThrow();
      const result = extract(parsed, '');
      expect(result.dilutionRate).toBeNull();
    });
  });
});
