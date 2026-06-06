// backend/src/engine1-disclosure/disclosure-events/extractors/contract-cancellation.spec.ts
// 계약 해제 추출 파서 단위 테스트 (DAR-71)

import { extract } from './contract-cancellation';
import { ParsedJson } from '../../disclosure-documents/types/parsed-json.type';
import * as sampleFixture from '../__fixtures__/contract-cancellation-sample.json';

function makeParsedJson(overrides: Partial<ParsedJson> = {}): ParsedJson {
  return {
    docType: 'SUPPLY_CONTRACT',
    rawTableCount: 1,
    keyValueSource: 'table_0',
    ...overrides,
  } as ParsedJson;
}

describe('contract-cancellation extract', () => {
  describe('sampleFixture 전체 추출', () => {
    it('해제금액·기존금액·상대방·사유 추출 + 해제비율 산출', () => {
      const result = extract(sampleFixture as ParsedJson, '단일판매·공급계약 해제');
      expect(result.cancelledAmount).toBe(30_000_000_000);
      expect(result.originalAmount).toBe(120_000_000_000);
      expect(result.cancelledRatio).toBe(25.0); // 30/120 * 100
      expect(result.counterparty).toBe('Globex Corp.');
      expect(result.reason).toContain('발주처');
      expect(result.derivedDataMissing).toBe(false);
    });
  });

  describe('cancelledRatio 계산', () => {
    it('해제금액/기존금액 * 100 소수점 2자리', () => {
      const result = extract(makeParsedJson({ cancelledContractAmount: 1_000_000_000, originalContractAmount: 3_000_000_000 }), '');
      expect(result.cancelledRatio).toBe(33.33);
    });

    it('기존금액 결측 → ratio null (과대평가 방지)', () => {
      const result = extract(makeParsedJson({ cancelledContractAmount: 5_000_000_000 }), '');
      expect(result.cancelledRatio).toBeNull();
      expect(result.cancelledAmount).toBe(5_000_000_000);
    });

    it('기존금액 0 → ratio null (0으로 나누기 방지)', () => {
      const result = extract(makeParsedJson({ cancelledContractAmount: 5_000_000_000, originalContractAmount: 0 }), '');
      expect(result.cancelledRatio).toBeNull();
    });
  });

  describe('예외 내성·부분 추출', () => {
    it('해제금액 결측 → derivedDataMissing true, 사유는 추출', () => {
      const result = extract(makeParsedJson({ cancellationReason: '상대방 귀책 해제' }), '');
      expect(result.cancelledAmount).toBeNull();
      expect(result.reason).toBe('상대방 귀책 해제');
      expect(result.derivedDataMissing).toBe(true);
    });

    it('모든 필드 undefined → throw 없음', () => {
      const parsed = { docType: 'SUPPLY_CONTRACT', rawTableCount: 0, keyValueSource: 'none' } as ParsedJson;
      expect(() => extract(parsed, '')).not.toThrow();
      expect(extract(parsed, '').cancelledAmount).toBeNull();
    });
  });
});
