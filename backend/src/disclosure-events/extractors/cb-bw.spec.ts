// backend/src/disclosure-events/extractors/cb-bw.spec.ts
// CB/BW 추출 파서 단위 테스트

import { extract, REFIX_PATTERN } from './cb-bw';
import { ParsedJson } from '../../disclosure-documents/types/parsed-json.type';
import * as cbFixture from '../__fixtures__/cb-issuance-sample.json';
import * as bwFixture from '../__fixtures__/bw-issuance-sample.json';

function makeParsedJson(overrides: Partial<ParsedJson> = {}): ParsedJson {
  return {
    docType: 'CB_BW_ISSUANCE',
    rawTableCount: 1,
    keyValueSource: 'table_0',
    ...overrides,
  } as ParsedJson;
}

describe('cb-bw extract', () => {
  describe('bondType 분류', () => {
    it('bondType=CB → CB', () => {
      const parsed = makeParsedJson({ bondType: 'CB' });
      const result = extract(parsed, '');
      expect(result.bondType).toBe('CB');
    });

    it('bondType=BW → BW', () => {
      const parsed = makeParsedJson({ bondType: 'BW' });
      const result = extract(parsed, '');
      expect(result.bondType).toBe('BW');
    });

    it('bondType=EB → CB로 분류 (CB 기본값)', () => {
      const parsed = makeParsedJson({ bondType: 'EB' });
      const result = extract(parsed, '');
      expect(result.bondType).toBe('CB');
    });

    it('bondType 없으면 CB 기본값', () => {
      const result = extract(makeParsedJson(), '');
      expect(result.bondType).toBe('CB');
    });
  });

  describe('maxDilutionShares 계산', () => {
    it('floor(totalAmount / conversionPrice)', () => {
      const parsed = makeParsedJson({
        issuanceAmount: 30_000_000_000,
        conversionPrice: 4_500,
      });
      const result = extract(parsed, '');
      expect(result.maxDilutionShares).toBe(Math.floor(30_000_000_000 / 4_500));
      expect(result.maxDilutionShares).toBe(6_666_666);
    });

    it('cbFixture 기반 maxDilutionShares', () => {
      const result = extract(cbFixture as ParsedJson, '전환사채 발행');
      expect(result.totalAmount).toBe(30_000_000_000);
      expect(result.conversionPrice).toBe(4_500);
      expect(result.maxDilutionShares).toBe(6_666_666);
    });

    it('conversionPrice null → maxDilutionShares null', () => {
      const parsed = makeParsedJson({ issuanceAmount: 20_000_000_000 });
      const result = extract(parsed, '');
      expect(result.maxDilutionShares).toBeNull();
    });

    it('conversionPrice = 0 → maxDilutionShares null (0으로 나누기 방지)', () => {
      const parsed = makeParsedJson({
        issuanceAmount: 10_000_000_000,
        conversionPrice: 0,
      });
      const result = extract(parsed, '');
      expect(result.maxDilutionShares).toBeNull();
    });

    it('totalAmount null → maxDilutionShares null', () => {
      const parsed = makeParsedJson({ conversionPrice: 5_000 });
      const result = extract(parsed, '');
      expect(result.maxDilutionShares).toBeNull();
    });
  });

  describe('refixClause 키워드 탐지', () => {
    it('REFIX_PATTERN이 "리픽스" 키워드 감지', () => {
      expect(REFIX_PATTERN.test('전환가액 리픽스 조항')).toBe(true);
    });

    it('REFIX_PATTERN이 "전환가액 조정" 감지', () => {
      expect(REFIX_PATTERN.test('전환가액 조정 조항')).toBe(true);
    });

    it('REFIX_PATTERN은 일반 문장에 오탐 없음', () => {
      expect(REFIX_PATTERN.test('이자율 연 0%')).toBe(false);
    });

    // refixClause는 현재 파서에서 null (rawText 스캔 고도화 예정)
    it('현재 구현에서 refixClause = null', () => {
      const result = extract(makeParsedJson(), '');
      expect(result.refixClause).toBeNull();
    });
  });

  describe('BW 픽스처', () => {
    it('bwFixture → BW, maxDilutionShares 계산', () => {
      const result = extract(bwFixture as ParsedJson, '신주인수권부사채 발행');
      expect(result.bondType).toBe('BW');
      expect(result.totalAmount).toBe(20_000_000_000);
      expect(result.conversionPrice).toBe(6_000);
      expect(result.maxDilutionShares).toBe(Math.floor(20_000_000_000 / 6_000));
    });
  });

  describe('예외 내성', () => {
    it('모든 필드 undefined → throw 없음', () => {
      const parsed = { docType: 'CB_BW_ISSUANCE', rawTableCount: 0, keyValueSource: 'none' } as ParsedJson;
      expect(() => extract(parsed, '')).not.toThrow();
      const result = extract(parsed, '');
      expect(result.maxDilutionShares).toBeNull();
    });
  });
});
