// backend/src/disclosure-events/extractors/earnings.spec.ts
// 실적(서프라이즈·쇼크) 추출 파서 단위 테스트 (DAR-58)

import { extract } from './earnings';
import { ParsedJson } from '../../disclosure-documents/types/parsed-json.type';
import * as surpriseFixture from '../__fixtures__/earnings-surprise-sample.json';
import * as shockFixture from '../__fixtures__/earnings-shock-sample.json';

function makeParsedJson(overrides: Partial<ParsedJson> = {}): ParsedJson {
  return {
    docType: 'OTHER',
    rawTableCount: 2,
    keyValueSource: 'table_0',
    ...overrides,
  } as ParsedJson;
}

describe('earnings extract', () => {
  describe('operatingProfitYoY 계산', () => {
    it('전년·당기 영업이익으로 YoY 계산 (+50%)', () => {
      const result = extract(
        makeParsedJson({ operatingProfit: 180_000_000_000, previousOperatingProfit: 120_000_000_000 }),
        '',
      );
      expect(result.operatingProfitYoY).toBe(50.0);
    });

    it('parsedJson.operatingProfitYoY 소수 비율(0.30) → 30%', () => {
      const result = extract(makeParsedJson({ operatingProfitYoY: 0.3 }), '');
      expect(result.operatingProfitYoY).toBe(30.0);
    });

    it('전년 데이터 없음 → null + derivedDataMissing', () => {
      const result = extract(makeParsedJson({ operatingProfit: 100 }), '');
      expect(result.operatingProfitYoY).toBeNull();
      expect(result.derivedDataMissing).toBe(true);
    });
  });

  describe('surpriseDirection 판정', () => {
    it('surpriseFixture: YoY +50% → SURPRISE', () => {
      const result = extract(surpriseFixture as ParsedJson, '영업(잠정)실적');
      expect(result.surpriseDirection).toBe('SURPRISE');
      expect(result.operatingProfitYoY).toBe(50.0);
    });

    it('shockFixture: 흑자→적자 전환 → SHOCK', () => {
      const result = extract(shockFixture as ParsedJson, '영업(잠정)실적');
      expect(result.surpriseDirection).toBe('SHOCK');
      expect(result.isLossTransition).toBe(true);
    });

    it('흑자전환(전년 손실→당기 이익) → SURPRISE', () => {
      const result = extract(
        makeParsedJson({ operatingProfit: 10_000_000_000, previousOperatingProfit: -5_000_000_000 }),
        '',
      );
      expect(result.isProfitTransition).toBe(true);
      expect(result.surpriseDirection).toBe('SURPRISE');
    });

    it('YoY 소폭(+5%) → NEUTRAL', () => {
      const result = extract(
        makeParsedJson({ operatingProfit: 105, previousOperatingProfit: 100 }),
        '',
      );
      expect(result.surpriseDirection).toBe('NEUTRAL');
    });

    it('수치 부재 + 보고서명 "적자전환" → SHOCK', () => {
      const result = extract(makeParsedJson(), '영업실적 적자전환');
      expect(result.surpriseDirection).toBe('SHOCK');
    });

    it('수치 부재 + 방향 미상 보고서명 → UNKNOWN', () => {
      const result = extract(makeParsedJson(), '영업(잠정)실적(공정공시)');
      expect(result.surpriseDirection).toBe('UNKNOWN');
    });
  });

  describe('예외 내성', () => {
    it('모든 필드 undefined → throw 없음', () => {
      const parsed = { docType: 'OTHER', rawTableCount: 0, keyValueSource: 'none' } as ParsedJson;
      expect(() => extract(parsed, '')).not.toThrow();
      expect(extract(parsed, '').operatingProfit).toBeNull();
    });
  });
});
