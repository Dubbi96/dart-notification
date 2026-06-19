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
      expect(result.lawsuitAmountSource).toBe('DIRECT');
      expect(result.partialFieldsPresent).toBe(false); // 금액 존재 → 부분회수 불필요
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

  // DAR-344: 소송금액 회수 폴백 — 정형 결측 시 보고서명 금액 + 부분필드 신호
  describe('DAR-344 소송금액 회수 폴백', () => {
    it("보고서명 괄호 금액 폴백 ('소제기(100억원 청구)' → 100억, source=REPORT_NAME)", () => {
      const result = extract(makeParsedJson(), '소제기(100억원 청구)');
      expect(result.lawsuitAmount).toBe(10_000_000_000);
      expect(result.lawsuitAmountSource).toBe('REPORT_NAME');
      expect(result.derivedDataMissing).toBe(false);
      expect(result.partialFieldsPresent).toBe(false); // 금액 회수됨 → SUCCESS 경로
    });

    it('조+억 결합 보고서명 금액 폴백 (1조2000억)', () => {
      const result = extract(makeParsedJson(), '소송 제기(청구금액 1조2000억원)');
      expect(result.lawsuitAmount).toBe(1_200_000_000_000);
      expect(result.lawsuitAmountSource).toBe('REPORT_NAME');
    });

    it('정형 필드 우선 — 보고서명에 금액 있어도 DIRECT 채택', () => {
      const result = extract(makeParsedJson({ lawsuitAmount: 5_000_000_000 }), '소제기(100억원 청구)');
      expect(result.lawsuitAmount).toBe(5_000_000_000);
      expect(result.lawsuitAmountSource).toBe('DIRECT');
    });

    it('금액 결측 + 진행단계 확인 → partialFieldsPresent (NEEDS_REVIEW 회수 신호)', () => {
      const result = extract(makeParsedJson({ litigationStage: '항소심 계속중' }), '소송 등의 제기');
      expect(result.lawsuitAmount).toBeNull();
      expect(result.litigationStage).toBe('APPEAL');
      expect(result.partialFieldsPresent).toBe(true);
    });

    it('금액 결측 + 청구원인 확인 → partialFieldsPresent', () => {
      const result = extract(makeParsedJson({ claimCause: '특허침해 금지청구' }), '');
      expect(result.lawsuitAmount).toBeNull();
      expect(result.partialFieldsPresent).toBe(true);
    });

    it('음성 대조군: 금액·단계·원인 전무 → partialFieldsPresent=false (FAILED 천장 보존)', () => {
      // 보고서명/필드 어디에도 금액·진행단계·청구원인 단서가 없는 케이스
      const blank = extract(makeParsedJson(), '기타 경영사항');
      expect(blank.lawsuitAmount).toBeNull();
      expect(blank.litigationStage).toBe('UNKNOWN');
      expect(blank.claimCause).toBeNull();
      expect(blank.partialFieldsPresent).toBe(false);
    });

    it("단위 없는 보고서명 숫자(차수·일자)는 금액 오추출 안 함 ('소송(제3차)')", () => {
      const result = extract(makeParsedJson(), '소송 제기(제3차)');
      expect(result.lawsuitAmount).toBeNull();
      expect(result.lawsuitAmountSource).toBe('NONE');
    });
  });
});
