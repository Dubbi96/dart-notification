// backend/src/disclosure-events/extractors/cb-bw.spec.ts
// CB/BW 추출 파서 단위 테스트

import { extract, REFIX_PATTERN } from './cb-bw';
import { ParsedJson } from '../../disclosure-documents/types/parsed-json.type';
import * as cbFixture from '../__fixtures__/cb-issuance-sample.json';
import * as bwFixture from '../__fixtures__/bw-issuance-sample.json';
import * as fallbackFixture from '../__fixtures__/cb-issuance-fallback-sample.json';

function makeParsedJson(overrides: Partial<ParsedJson> = {}): ParsedJson {
  return {
    docType: 'CB_BW_ISSUANCE',
    rawTableCount: 1,
    keyValueSource: 'table_0',
    ...overrides,
  } as ParsedJson;
}

/** 미매핑 원시 라벨(한글 키)을 포함한 parsedJson 블롭 생성 */
function makeRawParsedJson(rawKeys: Record<string, unknown>): ParsedJson {
  return {
    docType: 'CB_BW_ISSUANCE',
    rawTableCount: 1,
    keyValueSource: 'table_0',
    ...rawKeys,
  } as unknown as ParsedJson;
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
      // DAR-341: 정상 경로는 DIRECT
      expect(result.totalAmountSource).toBe('DIRECT');
      expect(result.conversionPriceSource).toBe('DIRECT');
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

  // ─── DAR-341: 회수 폴백 ─────────────────────────────────────────────────────

  describe('DAR-341 발행금액(totalAmount) 회수', () => {
    it('DIRECT: issuanceAmount 직접 매핑', () => {
      const result = extract(makeParsedJson({ issuanceAmount: 50_000_000_000 }), '');
      expect(result.totalAmount).toBe(50_000_000_000);
      expect(result.totalAmountSource).toBe('DIRECT');
    });

    it('ALT_KEY: 발행총액 대체키("300억원") 스캔으로 회수', () => {
      const result = extract(makeRawParsedJson({ 발행총액: '300억원' }), '');
      expect(result.totalAmount).toBe(30_000_000_000);
      expect(result.totalAmountSource).toBe('ALT_KEY');
    });

    it('ALT_KEY: 권면총액 숫자 문자열("12,000,000,000") 회수', () => {
      const result = extract(makeRawParsedJson({ 권면총액: '12,000,000,000' }), '');
      expect(result.totalAmount).toBe(12_000_000_000);
      expect(result.totalAmountSource).toBe('ALT_KEY');
    });

    it('REPORT_NAME: 보고서명 괄호 금액에서 회수 — FAILED 방지', () => {
      const result = extract(makeParsedJson(), '전환사채권 발행결정(150억원)');
      expect(result.totalAmount).toBe(15_000_000_000);
      expect(result.totalAmountSource).toBe('REPORT_NAME');
    });

    it('보고서명 단위 없는 단순 숫자(차수)는 금액 오추출하지 않음', () => {
      const result = extract(makeParsedJson(), '제3회차 전환사채권 발행결정');
      expect(result.totalAmount).toBeNull();
      expect(result.totalAmountSource).toBe('NONE');
    });

    it('DIRECT 우선: issuanceAmount가 있으면 대체키를 무시', () => {
      const result = extract(
        makeRawParsedJson({ issuanceAmount: 40_000_000_000, 발행총액: '999억원' }),
        '전환사채권 발행결정(123억원)',
      );
      expect(result.totalAmount).toBe(40_000_000_000);
      expect(result.totalAmountSource).toBe('DIRECT');
    });
  });

  describe('DAR-341 전환가액(conversionPrice) 회수', () => {
    it('DIRECT: conversionPrice 직접 매핑', () => {
      const result = extract(makeParsedJson({ conversionPrice: 4_500 }), '');
      expect(result.conversionPrice).toBe(4_500);
      expect(result.conversionPriceSource).toBe('DIRECT');
    });

    it('ALT_KEY: 행사가 대체키 스캔으로 회수', () => {
      const result = extract(makeRawParsedJson({ 행사가: '7,200' }), '');
      expect(result.conversionPrice).toBe(7_200);
      expect(result.conversionPriceSource).toBe('ALT_KEY');
    });

    it('ALT_KEY: 전환가액 대체키 스캔으로 회수', () => {
      const result = extract(makeRawParsedJson({ 전환가액: 5_500 }), '');
      expect(result.conversionPrice).toBe(5_500);
      expect(result.conversionPriceSource).toBe('ALT_KEY');
    });

    it('DERIVED: 기초주가 × (1 + 할증률) 유도 (할증률 10%)', () => {
      const result = extract(
        makeRawParsedJson({ 기초주가: 5_000, 할증률: '10%' }),
        '',
      );
      expect(result.conversionPrice).toBe(5_500); // 5000 * 1.10
      expect(result.conversionPriceSource).toBe('DERIVED');
      expect(result.conversionPremiumRate).toBe(10);
    });

    it('DERIVED: 할증률 비율(0.15) 표기도 동일 처리', () => {
      const result = extract(
        makeRawParsedJson({ 기준주가: 8_000, premiumRate: 0.15 }),
        '',
      );
      expect(result.conversionPrice).toBe(9_200); // 8000 * 1.15
      expect(result.conversionPriceSource).toBe('DERIVED');
    });

    it('DERIVED: 할증률 결측 시 0 가정(전환가액 = 기초주가 floor)', () => {
      const result = extract(makeRawParsedJson({ 기초주가: 6_000 }), '');
      expect(result.conversionPrice).toBe(6_000);
      expect(result.conversionPriceSource).toBe('DERIVED');
      expect(result.conversionPremiumRate).toBe(0);
    });

    it('우선순위: DIRECT > ALT_KEY > DERIVED', () => {
      const result = extract(
        makeRawParsedJson({
          conversionPrice: 4_500,
          전환가액: 5_500,
          기초주가: 5_000,
        }),
        '',
      );
      expect(result.conversionPrice).toBe(4_500);
      expect(result.conversionPriceSource).toBe('DIRECT');
    });

    it('회수 불가 시 NONE + 희석지표 null', () => {
      const result = extract(makeParsedJson({ issuanceAmount: 10_000_000_000 }), '');
      expect(result.conversionPrice).toBeNull();
      expect(result.conversionPriceSource).toBe('NONE');
      expect(result.maxDilutionShares).toBeNull();
    });
  });

  describe('DAR-341 통합 회수 — FAILED/NEEDS_REVIEW → 희석지표 복구', () => {
    it('fallbackFixture: ALT_KEY 금액 + DERIVED 전환가 → 희석지표 산출', () => {
      const result = extract(fallbackFixture as ParsedJson, '전환사채권 발행결정');
      // 발행총액 "300억원" → 30,000,000,000 (ALT_KEY)
      expect(result.totalAmount).toBe(30_000_000_000);
      expect(result.totalAmountSource).toBe('ALT_KEY');
      // 기초주가 5,000 × (1 + 10%) = 5,500 (DERIVED)
      expect(result.conversionPrice).toBe(5_500);
      expect(result.conversionPriceSource).toBe('DERIVED');
      // 희석지표 복구: floor(30,000,000,000 / 5,500)
      expect(result.maxDilutionShares).toBe(Math.floor(30_000_000_000 / 5_500));
      expect(result.conversionPremiumRate).toBe(10);
    });

    it('전부 결측 → 두 source 모두 NONE (회귀: emptyResult 형태 유지)', () => {
      const result = extract(makeParsedJson(), '');
      expect(result.totalAmount).toBeNull();
      expect(result.totalAmountSource).toBe('NONE');
      expect(result.conversionPrice).toBeNull();
      expect(result.conversionPriceSource).toBe('NONE');
    });
  });
});
