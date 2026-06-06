// backend/src/engine1-disclosure/disclosure-documents/facts/dart-filed-fact.normalizer.spec.ts
// DAR-95: ParsedJson → 표준 factKey 정규화 단위 테스트 (정규화·결측·종류별 단위/period)

import { ParsedJson } from '../types/parsed-json.type';
import {
  normalizeFiledFacts,
  FACT_KEY_MAP,
} from './dart-filed-fact.normalizer';

function byKey(facts: ReturnType<typeof normalizeFiledFacts>) {
  return new Map(facts.map((f) => [f.factKey, f]));
}

describe('normalizeFiledFacts', () => {
  describe('계약(SUPPLY_CONTRACT)', () => {
    it('계약금액/매출비율/상대방/기간을 표준 fact로 정규화한다', () => {
      const parsedJson: ParsedJson = {
        docType: 'SUPPLY_CONTRACT',
        rawTableCount: 2,
        keyValueSource: 'table_0',
        contractAmount: 120_000_000_000,
        recentSales: 600_000_000_000,
        salesRatio: 0.2,
        counterparty: '삼성전자',
        contractStartDate: '2026-01-01',
        contractEndDate: '2026-12-31',
      };

      const facts = normalizeFiledFacts(parsedJson);
      const m = byKey(facts);

      // 금액: numericValue + 단위 원
      expect(m.get('CONTRACT_AMOUNT')).toMatchObject({
        value: '120000000000',
        numericValue: 120_000_000_000,
        unit: '원',
        sectionPath: 'parsedJson.contractAmount',
      });
      // 비율: 단위 ratio, period 없음
      expect(m.get('CONTRACT_TO_SALES_RATIO')).toMatchObject({
        numericValue: 0.2,
        unit: 'ratio',
      });
      expect(m.get('CONTRACT_TO_SALES_RATIO')?.period).toBeUndefined();
      // 텍스트: numericValue/unit 없음
      const cp = m.get('COUNTERPARTY');
      expect(cp?.value).toBe('삼성전자');
      expect(cp?.numericValue).toBeUndefined();
      expect(cp?.unit).toBeUndefined();
      // 날짜: period 동봉
      expect(m.get('CONTRACT_START_DATE')).toMatchObject({
        value: '2026-01-01',
        period: '2026-01-01',
      });
      expect(m.get('CONTRACT_START_DATE')?.numericValue).toBeUndefined();
    });
  });

  describe('CB/BW · 증자 · 배당', () => {
    it('CB 전환가는 CB_CONVERSION_PRICE(금액)로 매핑된다', () => {
      const facts = normalizeFiledFacts({
        docType: 'CB_BW_ISSUANCE',
        rawTableCount: 1,
        keyValueSource: 'table_0',
        conversionPrice: 15_000,
        bondType: 'CB',
      } as ParsedJson);
      const m = byKey(facts);
      expect(m.get('CB_CONVERSION_PRICE')).toMatchObject({
        numericValue: 15_000,
        unit: '원',
      });
      expect(m.get('BOND_TYPE')?.value).toBe('CB');
    });

    it('유상증자 신주배정(newShares)은 NEW_SHARES(수량/주)로 매핑된다', () => {
      const facts = normalizeFiledFacts({
        docType: 'PAID_IN_CAPITAL_INCREASE',
        rawTableCount: 1,
        keyValueSource: 'table_0',
        newShares: 1_000_000,
        dilutionRate: 0.1,
      } as ParsedJson);
      const m = byKey(facts);
      expect(m.get('NEW_SHARES')).toMatchObject({
        numericValue: 1_000_000,
        unit: '주',
      });
      expect(m.get('DILUTION_RATE')?.unit).toBe('ratio');
    });

    it('배당성향(dividendYield)은 DIVIDEND_PAYOUT_RATIO로 매핑된다', () => {
      const facts = normalizeFiledFacts({
        docType: 'DIVIDEND',
        rawTableCount: 1,
        keyValueSource: 'table_0',
        dividendYield: 0.35,
      } as ParsedJson);
      expect(byKey(facts).get('DIVIDEND_PAYOUT_RATIO')).toMatchObject({
        numericValue: 0.35,
        unit: 'ratio',
      });
    });
  });

  describe('결측 graceful', () => {
    it('매핑된 정량 필드가 없으면 빈 배열', () => {
      expect(
        normalizeFiledFacts({
          docType: 'UNKNOWN',
          rawTableCount: 0,
          keyValueSource: 'none',
        }),
      ).toEqual([]);
    });

    it('null/undefined/빈문자 값은 건너뛴다', () => {
      const facts = normalizeFiledFacts({
        docType: 'SUPPLY_CONTRACT',
        rawTableCount: 1,
        keyValueSource: 'table_0',
        contractAmount: 100,
        recentSales: undefined,
        counterparty: '   ',
      } as unknown as ParsedJson);
      const keys = facts.map((f) => f.factKey);
      expect(keys).toContain('CONTRACT_AMOUNT');
      expect(keys).not.toContain('RECENT_SALES');
      expect(keys).not.toContain('COUNTERPARTY');
    });

    it('NaN 숫자는 산출하지 않는다', () => {
      const facts = normalizeFiledFacts({
        docType: 'SUPPLY_CONTRACT',
        rawTableCount: 1,
        keyValueSource: 'table_0',
        contractAmount: NaN,
      } as ParsedJson);
      expect(facts).toEqual([]);
    });

    it('null/undefined 입력은 빈 배열', () => {
      expect(normalizeFiledFacts(null)).toEqual([]);
      expect(normalizeFiledFacts(undefined)).toEqual([]);
    });

    it('메타 필드(docType/rawTableCount/keyValueSource)는 fact로 산출하지 않는다', () => {
      const facts = normalizeFiledFacts({
        docType: 'SUPPLY_CONTRACT',
        rawTableCount: 3,
        keyValueSource: 'table_1',
        contractAmount: 100,
      } as ParsedJson);
      expect(facts).toHaveLength(1);
      expect(facts[0].factKey).toBe('CONTRACT_AMOUNT');
    });
  });

  describe('factKey 정규화 품질', () => {
    it('FACT_KEY_MAP의 모든 factKey는 UPPER_SNAKE_CASE이고 유일하다', () => {
      const keys = Object.values(FACT_KEY_MAP).map((s) => s.factKey);
      for (const k of keys) {
        expect(k).toMatch(/^[A-Z][A-Z0-9_]*$/);
      }
      expect(new Set(keys).size).toBe(keys.length);
    });

    it('동일 입력은 결정론적으로 동일 결과를 낸다', () => {
      const input: ParsedJson = {
        docType: 'SUPPLY_CONTRACT',
        rawTableCount: 1,
        keyValueSource: 'table_0',
        contractAmount: 100,
        counterparty: 'A사',
      };
      expect(normalizeFiledFacts(input)).toEqual(normalizeFiledFacts(input));
    });
  });
});
