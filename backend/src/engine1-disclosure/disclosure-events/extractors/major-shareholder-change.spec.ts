// backend/src/disclosure-events/extractors/major-shareholder-change.spec.ts
// 최대주주 변경 추출 파서 단위 테스트 (DAR-58)

import { extract } from './major-shareholder-change';
import { ParsedJson } from '../../disclosure-documents/types/parsed-json.type';
import * as sampleFixture from '../__fixtures__/major-shareholder-change-sample.json';

function makeParsedJson(overrides: Partial<ParsedJson> = {}): ParsedJson {
  return {
    docType: 'OTHER',
    rawTableCount: 1,
    keyValueSource: 'table_0',
    ...overrides,
  } as ParsedJson;
}

describe('major-shareholder-change extract', () => {
  describe('ownershipRatio 정규화', () => {
    it('소수 비율(0.272) → % 단위(27.2)', () => {
      const result = extract(makeParsedJson({ largestShareholderRatio: 0.272 }), '');
      expect(result.ownershipRatio).toBe(27.2);
    });

    it('이미 % 정수(27.2) → 그대로', () => {
      const result = extract(makeParsedJson({ largestShareholderRatio: 27.2 }), '');
      expect(result.ownershipRatio).toBe(27.2);
    });

    it('ratio null → null + derivedDataMissing true', () => {
      const result = extract(makeParsedJson(), '');
      expect(result.ownershipRatio).toBeNull();
      expect(result.derivedDataMissing).toBe(true);
    });
  });

  describe('sampleFixture 전체 추출', () => {
    it('최대주주·지분율·사유·날짜 추출', () => {
      const result = extract(sampleFixture as ParsedJson, '최대주주 변경');
      expect(result.newLargestShareholder).toBe('에이비씨캐피탈');
      expect(result.previousLargestShareholder).toBe('홍길동');
      expect(result.ownershipRatio).toBe(27.2);
      expect(result.changeDate).toBe('2024-05-20');
      expect(result.changeMethod).toBe('SHARE_TRANSFER');
      expect(result.derivedDataMissing).toBe(false);
    });
  });

  describe('changeMethod 분류', () => {
    it('상속/증여 → INHERITANCE', () => {
      const result = extract(makeParsedJson({ shareholderChangeReason: '상속에 의한 변경' }), '');
      expect(result.changeMethod).toBe('INHERITANCE');
    });

    it('합병 → MERGER (보고서명 기반)', () => {
      const result = extract(makeParsedJson(), '최대주주 변경(합병)');
      expect(result.changeMethod).toBe('MERGER');
    });

    it('장내매수 → ON_MARKET', () => {
      const result = extract(makeParsedJson({ shareholderChangeReason: '장내 매수' }), '');
      expect(result.changeMethod).toBe('ON_MARKET');
    });

    it('키워드 없음 → UNKNOWN', () => {
      const result = extract(makeParsedJson({ shareholderChangeReason: '기타' }), '최대주주 변경');
      expect(result.changeMethod).toBe('UNKNOWN');
    });
  });

  describe('예외 내성', () => {
    it('모든 필드 undefined → throw 없음', () => {
      const parsed = { docType: 'OTHER', rawTableCount: 0, keyValueSource: 'none' } as ParsedJson;
      expect(() => extract(parsed, '')).not.toThrow();
      expect(extract(parsed, '').newLargestShareholder).toBeNull();
    });

    it('빈 문자열 → null 정규화', () => {
      const result = extract(makeParsedJson({ newLargestShareholder: '   ' }), '');
      expect(result.newLargestShareholder).toBeNull();
    });
  });
});
