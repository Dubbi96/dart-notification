// backend/src/engine1-disclosure/disclosure-events/extractors/audit-opinion-risk.spec.ts
// 감사의견 리스크 추출 파서 단위 테스트 (DAR-71)

import { extract } from './audit-opinion-risk';
import { ParsedJson } from '../../disclosure-documents/types/parsed-json.type';
import * as sampleFixture from '../__fixtures__/audit-opinion-risk-sample.json';

function makeParsedJson(overrides: Partial<ParsedJson> = {}): ParsedJson {
  return {
    docType: 'OTHER',
    rawTableCount: 1,
    keyValueSource: 'table_0',
    ...overrides,
  } as ParsedJson;
}

describe('audit-opinion-risk extract', () => {
  describe('sampleFixture 전체 추출', () => {
    it('의견거절 + 사유 추출', () => {
      const result = extract(sampleFixture as ParsedJson, '감사보고서 제출(의견거절)');
      expect(result.auditOpinion).toBe('DISCLAIMER');
      expect(result.reason).toContain('계속기업');
      expect(result.derivedDataMissing).toBe(false);
    });
  });

  describe('의견 종류 분류 (심각도 우선)', () => {
    it('한정 → QUALIFIED', () => {
      expect(extract(makeParsedJson({ auditOpinionType: '한정' }), '').auditOpinion).toBe('QUALIFIED');
    });

    it('부적정 → ADVERSE', () => {
      expect(extract(makeParsedJson({ auditOpinionType: '부적정' }), '').auditOpinion).toBe('ADVERSE');
    });

    it('의견거절 → DISCLAIMER', () => {
      expect(extract(makeParsedJson({ auditOpinionType: '의견 거절' }), '').auditOpinion).toBe('DISCLAIMER');
    });

    it('보고서명만으로도 분류', () => {
      expect(extract(makeParsedJson(), '감사의견 한정 안내').auditOpinion).toBe('QUALIFIED');
    });

    it('의견거절 + 한정 동시 언급 → DISCLAIMER (심각도 우선)', () => {
      const result = extract(makeParsedJson({ auditOpinionReason: '감사범위 한정으로 의견거절' }), '');
      expect(result.auditOpinion).toBe('DISCLAIMER');
    });
  });

  describe('예외 내성·부분 추출', () => {
    it('적정/키워드 없음 → null + derivedDataMissing true', () => {
      const result = extract(makeParsedJson({ auditOpinionReason: '적정 의견' }), '감사보고서');
      expect(result.auditOpinion).toBeNull();
      expect(result.derivedDataMissing).toBe(true);
    });

    it('모든 필드 undefined → throw 없음', () => {
      const parsed = { docType: 'OTHER', rawTableCount: 0, keyValueSource: 'none' } as ParsedJson;
      expect(() => extract(parsed, '')).not.toThrow();
      expect(extract(parsed, '').auditOpinion).toBeNull();
    });
  });
});
