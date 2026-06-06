// backend/src/engine1-disclosure/disclosure-events/extractors/lawsuit.spec.ts
// 소송 추출 파서 단위 테스트 (DAR-71)

import { extract } from './lawsuit';
import { ParsedJson } from '../../disclosure-documents/types/parsed-json.type';
import * as sampleFixture from '../__fixtures__/lawsuit-sample.json';

function makeParsedJson(overrides: Partial<ParsedJson> = {}): ParsedJson {
  return {
    docType: 'OTHER',
    rawTableCount: 1,
    keyValueSource: 'table_0',
    ...overrides,
  } as ParsedJson;
}

describe('lawsuit extract', () => {
  describe('sampleFixture 전체 추출', () => {
    it('소송금액·청구원인·당사 지위·진행단계 추출', () => {
      const result = extract(sampleFixture as ParsedJson, '소송 등의 제기·신청');
      expect(result.lawsuitAmount).toBe(5_000_000_000);
      expect(result.claimCause).toBe('손해배상(기) 청구의 소');
      expect(result.companyRole).toBe('DEFENDANT'); // defendant="당사"
      expect(result.litigationStage).toBe('FILED'); // "소송 제기"
      expect(result.derivedDataMissing).toBe(false);
    });
  });

  describe('companyRole 추정', () => {
    it('피소/상대로 키워드 → DEFENDANT', () => {
      const result = extract(makeParsedJson({ claimCause: '당사를 상대로 한 손해배상 소송' }), '');
      expect(result.companyRole).toBe('DEFENDANT');
    });

    it('제소/원고 키워드 → PLAINTIFF', () => {
      const result = extract(makeParsedJson(), '당사가 제기한 약정금 청구의 소');
      expect(result.companyRole).toBe('PLAINTIFF');
    });

    it('키워드 없음 → UNKNOWN', () => {
      const result = extract(makeParsedJson({ claimCause: '계약 분쟁' }), '');
      expect(result.companyRole).toBe('UNKNOWN');
    });
  });

  describe('litigationStage 분류 (구체 단계 우선)', () => {
    it('상고 → FINAL_APPEAL', () => {
      expect(extract(makeParsedJson({ litigationStage: '상고심 계속중' }), '').litigationStage).toBe('FINAL_APPEAL');
    });

    it('항소 → APPEAL', () => {
      expect(extract(makeParsedJson({ litigationStage: '항소 제기' }), '').litigationStage).toBe('APPEAL');
    });

    it('확정/종결 → CONCLUDED (최우선)', () => {
      expect(extract(makeParsedJson({ litigationStage: '판결 확정' }), '').litigationStage).toBe('CONCLUDED');
    });

    it('단계 정보 없음 → UNKNOWN', () => {
      expect(extract(makeParsedJson(), '').litigationStage).toBe('UNKNOWN');
    });
  });

  describe('예외 내성·부분 추출', () => {
    it('금액만 결측이어도 나머지 추출 (derivedDataMissing true)', () => {
      const result = extract(makeParsedJson({ claimCause: '특허침해 금지청구' }), '');
      expect(result.lawsuitAmount).toBeNull();
      expect(result.claimCause).toBe('특허침해 금지청구');
      expect(result.derivedDataMissing).toBe(true);
    });

    it('모든 필드 undefined → throw 없음', () => {
      const parsed = { docType: 'OTHER', rawTableCount: 0, keyValueSource: 'none' } as ParsedJson;
      expect(() => extract(parsed, '')).not.toThrow();
      expect(extract(parsed, '').lawsuitAmount).toBeNull();
    });
  });
});
