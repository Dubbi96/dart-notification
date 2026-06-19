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

  // DAR-340: 필수 수치(newShares·fundingAmount) 부재 FAILED 회수 — partialFieldsPresent 신호
  describe('partialFieldsPresent (DAR-340 FAILED 회수)', () => {
    it('docType=PAID_IN_CAPITAL_INCREASE + 수치 전부 부재 → partialFieldsPresent=true (FAILED 아님)', () => {
      const parsed = makeParsedJson({ docType: 'PAID_IN_CAPITAL_INCREASE' });
      const result = extract(parsed, '주요사항보고서(유상증자결정)');
      expect(result.newShares).toBeNull();
      expect(result.fundingAmount).toBeNull();
      expect(result.partialFieldsPresent).toBe(true);
    });

    it('THIRD_PARTY_ALLOTMENT docType도 회수 대상', () => {
      const parsed = makeParsedJson({ docType: 'THIRD_PARTY_ALLOTMENT' });
      const result = extract(parsed, '');
      expect(result.partialFieldsPresent).toBe(true);
    });

    it('issueMethod로 발행방식 분류되면(issueType≠UNKNOWN) 수치 부재여도 회수', () => {
      const parsed = makeParsedJson({ docType: 'OTHER', issueMethod: '제3자배정증자' });
      const result = extract(parsed, '');
      expect(result.issueType).toBe('THIRD_PARTY');
      expect(result.partialFieldsPresent).toBe(true);
    });

    it('부수 수치(discountRate)만 있어도 회수', () => {
      const parsed = makeParsedJson({ docType: 'OTHER', discountRate: 0.1 });
      const result = extract(parsed, '');
      expect(result.newShares).toBeNull();
      expect(result.partialFieldsPresent).toBe(true);
    });

    it('음성 대조군: 유상증자 단서 전무(docType=OTHER, 발행방식·수치 모두 부재) → partialFieldsPresent=false (FAILED 유지)', () => {
      const parsed = makeParsedJson({ docType: 'OTHER' });
      const result = extract(parsed, '');
      expect(result.issueType).toBe('UNKNOWN');
      expect(result.partialFieldsPresent).toBe(false);
    });

    it('emptyResult(예외 경로)도 partialFieldsPresent=false', () => {
      const malicious = {
        docType: 'OTHER',
        rawTableCount: 1,
        keyValueSource: 'table_0',
        get discountRate(): number {
          throw new Error('boom');
        },
      } as unknown as ParsedJson;
      const result = extract(malicious, '');
      expect(result.partialFieldsPresent).toBe(false);
    });
  });
});
