// backend/src/engine1-disclosure/disclosure-events/extractors/trading-suspension.spec.ts
// 거래정지 추출 파서 단위 테스트 (DAR-71)

import { extract } from './trading-suspension';
import { ParsedJson } from '../../disclosure-documents/types/parsed-json.type';
import * as sampleFixture from '../__fixtures__/trading-suspension-sample.json';

function makeParsedJson(overrides: Partial<ParsedJson> = {}): ParsedJson {
  return {
    docType: 'OTHER',
    rawTableCount: 1,
    keyValueSource: 'table_0',
    ...overrides,
  } as ParsedJson;
}

describe('trading-suspension extract', () => {
  describe('sampleFixture 전체 추출', () => {
    it('사유·정지유형·시작일·예상해제일 추출 + 날짜 정규화', () => {
      const result = extract(sampleFixture as ParsedJson, '매매거래 정지');
      expect(result.suspensionReason).toContain('감사의견 거절');
      expect(result.suspensionType).toBe('AUDIT');
      expect(result.suspensionStartDate).toBe('2024-03-21');
      expect(result.expectedResumeDate).toBe('2024-04-10');
      expect(result.derivedDataMissing).toBe(false);
    });
  });

  describe('suspensionType 분류', () => {
    it('상장폐지 관련 → DELISTING', () => {
      expect(extract(makeParsedJson({ suspensionReason: '상장폐지 절차 진행' }), '').suspensionType).toBe('DELISTING');
    });

    it('불성실공시 → DISCLOSURE', () => {
      expect(extract(makeParsedJson({ suspensionReason: '불성실공시법인 지정' }), '').suspensionType).toBe('DISCLOSURE');
    });

    it('변동성완화 → PRICE_VOLATILITY', () => {
      expect(extract(makeParsedJson({ suspensionReason: '단기과열 변동성 완화장치 발동' }), '').suspensionType).toBe('PRICE_VOLATILITY');
    });

    it('기타 사유 → OTHER', () => {
      expect(extract(makeParsedJson({ suspensionReason: '기타 경영상 사유' }), '').suspensionType).toBe('OTHER');
    });
  });

  describe('예외 내성·부분 추출', () => {
    it('해제일 미정(결측) 허용 — 시작일만 추출', () => {
      const result = extract(makeParsedJson({ suspensionReason: '조회공시 답변', suspensionStartDate: '20240501' }), '');
      expect(result.suspensionStartDate).toBe('2024-05-01');
      expect(result.expectedResumeDate).toBeNull();
      expect(result.derivedDataMissing).toBe(false);
    });

    it('사유 결측 → derivedDataMissing true', () => {
      const result = extract(makeParsedJson({ suspensionStartDate: '2024-05-01' }), '');
      expect(result.suspensionReason).toBeNull();
      expect(result.suspensionType).toBe('UNKNOWN');
      expect(result.derivedDataMissing).toBe(true);
    });

    it('모든 필드 undefined → throw 없음', () => {
      const parsed = { docType: 'OTHER', rawTableCount: 0, keyValueSource: 'none' } as ParsedJson;
      expect(() => extract(parsed, '')).not.toThrow();
      expect(extract(parsed, '').suspensionReason).toBeNull();
    });
  });
});
