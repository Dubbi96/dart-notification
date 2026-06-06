// backend/src/engine1-disclosure/disclosure-events/extractors/delisting-risk.spec.ts
// 상장폐지 위험 추출 파서 단위 테스트 (DAR-71)

import { extract } from './delisting-risk';
import { ParsedJson } from '../../disclosure-documents/types/parsed-json.type';
import * as sampleFixture from '../__fixtures__/delisting-risk-sample.json';

function makeParsedJson(overrides: Partial<ParsedJson> = {}): ParsedJson {
  return {
    docType: 'OTHER',
    rawTableCount: 1,
    keyValueSource: 'table_0',
    ...overrides,
  } as ParsedJson;
}

describe('delisting-risk extract', () => {
  describe('sampleFixture 전체 추출', () => {
    it('실질심사 단계 + 사유 추출', () => {
      const result = extract(sampleFixture as ParsedJson, '상장적격성 실질심사 대상 결정');
      expect(result.delistingStage).toBe('SUBSTANTIVE_REVIEW');
      expect(result.reason).toContain('회계처리기준 위반');
      expect(result.derivedDataMissing).toBe(false);
    });
  });

  describe('단계 분류 (심각도 우선)', () => {
    it('상장폐지 결정 → DELISTING_DECISION', () => {
      expect(extract(makeParsedJson({ delistingStage: '상장폐지 결정' }), '').delistingStage).toBe('DELISTING_DECISION');
    });

    it('관리종목 지정 → MANAGEMENT_ISSUE', () => {
      expect(extract(makeParsedJson({ delistingStage: '관리종목 지정' }), '').delistingStage).toBe('MANAGEMENT_ISSUE');
    });

    it('투자경고 → INVESTMENT_WARNING', () => {
      expect(extract(makeParsedJson(), '투자위험종목 지정').delistingStage).toBe('INVESTMENT_WARNING');
    });

    it('상폐결정 + 실질심사 동시 언급 → DELISTING_DECISION (심각도 우선)', () => {
      const result = extract(makeParsedJson({ delistingReason: '실질심사 후 상장폐지 결정' }), '');
      expect(result.delistingStage).toBe('DELISTING_DECISION');
    });

    it('단순 "상장폐지" 언급 → 최저 단계 INVESTMENT_WARNING 폴백', () => {
      expect(extract(makeParsedJson({ delistingReason: '상장폐지 사유 발생 가능성' }), '').delistingStage).toBe('INVESTMENT_WARNING');
    });
  });

  describe('예외 내성·부분 추출', () => {
    it('키워드 없음 → null + derivedDataMissing true', () => {
      const result = extract(makeParsedJson({ delistingReason: '경영 정상화 추진' }), '');
      expect(result.delistingStage).toBeNull();
      expect(result.derivedDataMissing).toBe(true);
    });

    it('모든 필드 undefined → throw 없음', () => {
      const parsed = { docType: 'OTHER', rawTableCount: 0, keyValueSource: 'none' } as ParsedJson;
      expect(() => extract(parsed, '')).not.toThrow();
      expect(extract(parsed, '').delistingStage).toBeNull();
    });
  });
});
