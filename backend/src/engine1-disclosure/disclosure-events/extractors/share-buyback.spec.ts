// backend/src/disclosure-events/extractors/share-buyback.spec.ts
// 자기주식 취득·소각 단위 테스트

import { EventType } from '@prisma/client';
import { extract, extractCancellation, computeBuybackRatios } from './share-buyback';
import { extractEventData } from './index';
import { ParsedJson } from '../../disclosure-documents/types/parsed-json.type';
import { Table } from '../../disclosure-documents/types/table.type';
import * as sampleFixture from '../__fixtures__/share-buyback-sample.json';
import * as failedRecoveredFixture from '../__fixtures__/share-buyback-failed-recovered.json';

function makeParsedJson(overrides: Partial<ParsedJson> = {}): ParsedJson {
  return {
    docType: 'SHARE_BUYBACK',
    rawTableCount: 1,
    keyValueSource: 'table_0',
    ...overrides,
  } as ParsedJson;
}

describe('share-buyback extract', () => {
  describe('buybackRatioToTotal', () => {
    it('totalIssuedShares 미확보 → buybackRatioToTotal null', () => {
      const parsed = makeParsedJson({
        acquisitionShares: 2_000_000,
        acquisitionAmount: 10_000_000_000,
      });
      const result = extract(parsed, '');
      expect(result.buybackRatioToTotal).toBeNull();
      expect(result.derivedDataMissing).toBe(true);
    });

    it('sampleFixture → buybackRatioToTotal null (외부 데이터 미확보)', () => {
      const result = extract(sampleFixture as ParsedJson, '자기주식 취득');
      expect(result.buybackRatioToTotal).toBeNull();
      expect(result.buybackShares).toBe(2_000_000);
      expect(result.buybackAmount).toBe(10_000_000_000);
    });
  });

  // DAR-79: 취득금액 매출·시총 대비 정규화 비율
  describe('정규화 비율 (DAR-79)', () => {
    it('parsedJson.revenue 보유 → buybackRatioToSales 산출 (취득금액/매출*100)', () => {
      const parsed = makeParsedJson({
        acquisitionAmount: 10_000_000_000, // 100억
        revenue: 500_000_000_000, // 5,000억
      });
      const result = extract(parsed, '');
      // 100억 / 5,000억 * 100 = 2.0%
      expect(result.buybackRatioToSales).toBe(2);
      expect(result.derivedDataMissing).toBe(false);
    });

    it('매출 결측 → buybackRatioToSales null, 절대 취득금액은 보존(폴백 가능)', () => {
      const parsed = makeParsedJson({ acquisitionAmount: 10_000_000_000 });
      const result = extract(parsed, '');
      expect(result.buybackRatioToSales).toBeNull();
      expect(result.buybackAmount).toBe(10_000_000_000);
      expect(result.derivedDataMissing).toBe(true);
    });

    it('parsedJson에는 상장주식수·종가 필드가 없어 buybackRatioToMarketCap은 항상 null (한계)', () => {
      const parsed = makeParsedJson({
        acquisitionAmount: 10_000_000_000,
        revenue: 500_000_000_000,
      });
      const result = extract(parsed, '');
      expect(result.buybackRatioToMarketCap).toBeNull();
    });

    it('매출 0/음수 → 0 나눗셈 방지로 null', () => {
      const zero = extract(makeParsedJson({ acquisitionAmount: 1_000, revenue: 0 }), '');
      expect(zero.buybackRatioToSales).toBeNull();
    });

    describe('computeBuybackRatios (SSOT)', () => {
      it('매출·시총 모두 보유 → 두 비율 산출, derivedDataMissing false', () => {
        const r = computeBuybackRatios(10_000_000_000, 500_000_000_000, 200_000_000_000);
        expect(r.buybackRatioToSales).toBe(2); // 100억/5,000억
        expect(r.buybackRatioToMarketCap).toBe(5); // 100억/2,000억
        expect(r.derivedDataMissing).toBe(false);
      });

      it('취득금액 null → 모든 비율 null', () => {
        const r = computeBuybackRatios(null, 500_000_000_000, 200_000_000_000);
        expect(r.buybackRatioToSales).toBeNull();
        expect(r.buybackRatioToMarketCap).toBeNull();
        expect(r.derivedDataMissing).toBe(true);
      });

      it('시총만 보유(매출 결측) → marketCap 비율만 산출', () => {
        const r = computeBuybackRatios(10_000_000_000, null, 200_000_000_000);
        expect(r.buybackRatioToSales).toBeNull();
        expect(r.buybackRatioToMarketCap).toBe(5);
        expect(r.derivedDataMissing).toBe(false);
      });
    });
  });

  describe('날짜 파싱', () => {
    it('acquisitionStartDate / acquisitionEndDate 정규화', () => {
      const parsed = makeParsedJson({
        acquisitionStartDate: '2024.06.01',
        acquisitionEndDate: '2024.08.31',
      });
      const result = extract(parsed, '');
      expect(result.buybackPeriodStart).toBe('2024-06-01');
      expect(result.buybackPeriodEnd).toBe('2024-08-31');
    });
  });

  describe('예외 내성', () => {
    it('모든 필드 undefined → throw 없음', () => {
      const parsed = { docType: 'SHARE_BUYBACK', rawTableCount: 0, keyValueSource: 'none' } as ParsedJson;
      expect(() => extract(parsed, '')).not.toThrow();
    });
  });
});

// DAR-339: 취득금액·취득주식수 추출 폴백 — FAILED(confidence 0.0) 복구
describe('DAR-339 추출 폴백', () => {
  const REPORT = '주요사항보고서(자기주식취득결정)';

  describe('대체 키 폴백 (parsedJson 블롭)', () => {
    it('정형 키 부재·대체 키(buybackAmount/buybackShares) 존재 → 회수', () => {
      const parsed = makeParsedJson({
        keyValueSource: 'none',
        // 비정형 블롭 키 (ParsedJson 타입 외 — 실데이터 방어)
        buybackAmount: 7_500_000_000,
        buybackShares: 1_500_000,
      } as unknown as Partial<ParsedJson>);
      const result = extract(parsed, REPORT);
      expect(result.buybackAmount).toBe(7_500_000_000);
      expect(result.buybackShares).toBe(1_500_000);
    });

    it('대체 키가 한국 금액 문자열("75억원") → 원 단위 숫자로 회수', () => {
      const parsed = makeParsedJson({
        keyValueSource: 'none',
        repurchaseAmount: '75억원',
      } as unknown as Partial<ParsedJson>);
      const result = extract(parsed, REPORT);
      expect(result.buybackAmount).toBe(7_500_000_000);
    });

    it('정형 키가 있으면 대체 키보다 우선(기존 동작 보존)', () => {
      const parsed = makeParsedJson({
        acquisitionAmount: 1_000,
        acquisitionShares: 10,
        buybackAmount: 999_999,
        buybackShares: 999,
      } as unknown as Partial<ParsedJson>);
      const result = extract(parsed, REPORT);
      expect(result.buybackAmount).toBe(1_000);
      expect(result.buybackShares).toBe(10);
    });
  });

  describe('원시 표(tables) 스캔 폴백', () => {
    const failedParsed = failedRecoveredFixture.parsedJson as unknown as ParsedJson;
    const failedTables = failedRecoveredFixture.tables as unknown as Table[];

    it('수정 전: tables 없이 추출하면 취득금액·주식수 모두 null (FAILED 재현)', () => {
      const result = extract(failedParsed, REPORT);
      expect(result.buybackAmount).toBeNull();
      expect(result.buybackShares).toBeNull();
    });

    it('수정 후: 영속 tables의 "취득예정 가액/주식" 라벨 스캔으로 두 값 회수', () => {
      const result = extract(failedParsed, REPORT, failedTables);
      expect(result.buybackAmount).toBe(7_500_000_000);
      expect(result.buybackShares).toBe(1_500_000);
    });

    it('구분 컬럼("보통주식")이 끼어도 뒤 셀의 숫자를 채택', () => {
      const tables: Table[] = [
        {
          tableIndex: 0,
          headers: [],
          rows: [['취득예정 금액(원)', '보통주식', '3,000,000,000']],
          hasColspan: false,
          hasRowspan: false,
        } as Table,
      ];
      const result = extract(makeParsedJson({ keyValueSource: 'none' }), REPORT, tables);
      expect(result.buybackAmount).toBe(3_000_000_000);
    });

    it('단가 라벨("취득단가")은 취득금액으로 오추출하지 않음', () => {
      const tables: Table[] = [
        {
          tableIndex: 0,
          headers: [],
          rows: [
            ['취득단가(원)', '5,000', ''],
            ['취득예정 주식(주)', '2,000,000', ''],
          ],
          hasColspan: false,
          hasRowspan: false,
        } as Table,
      ];
      const result = extract(makeParsedJson({ keyValueSource: 'none' }), REPORT, tables);
      expect(result.buybackAmount).toBeNull();
      expect(result.buybackShares).toBe(2_000_000);
    });

    it('정형 키가 있으면 표 스캔을 건너뜀(기존 SUCCESS 경로 불변)', () => {
      const tables: Table[] = [
        {
          tableIndex: 0,
          headers: [],
          rows: [['취득예정 금액(원)', '999,999', '']],
          hasColspan: false,
          hasRowspan: false,
        } as Table,
      ];
      const parsed = makeParsedJson({ acquisitionAmount: 5_000, acquisitionShares: 50 });
      const result = extract(parsed, REPORT, tables);
      expect(result.buybackAmount).toBe(5_000);
    });
  });

  describe('confidence 통합 (extractEventData) — FAILED 탈출 검증', () => {
    const failedParsed = failedRecoveredFixture.parsedJson as unknown as ParsedJson;
    const failedTables = failedRecoveredFixture.tables as unknown as Table[];

    it('수정 전: tables 미전달 → confidence 0.0 (FAILED로 라우팅됨)', () => {
      const { confidence } = extractEventData(EventType.SHARE_BUYBACK, failedParsed, REPORT);
      expect(confidence).toBe(0.0);
    });

    it('수정 후: tables 전달 → 두 필수 필드 회수로 confidence 0.90 (SUCCESS 가능)', () => {
      const { data, confidence } = extractEventData(
        EventType.SHARE_BUYBACK,
        failedParsed,
        REPORT,
        failedTables,
      );
      expect(data.buybackAmount).toBe(7_500_000_000);
      expect(data.buybackShares).toBe(1_500_000);
      expect(confidence).toBe(0.9);
    });

    it('부분 필드(취득주식수만) 회수 → confidence ≥0.60 (NEEDS_REVIEW, FAILED 탈출)', () => {
      const tables: Table[] = [
        {
          tableIndex: 0,
          headers: [],
          rows: [['취득예정 주식(주)', '1,500,000', '']],
          hasColspan: false,
          hasRowspan: false,
        } as Table,
      ];
      const { confidence } = extractEventData(
        EventType.SHARE_BUYBACK,
        makeParsedJson({ keyValueSource: 'none' }),
        REPORT,
        tables,
      );
      expect(confidence).toBeGreaterThanOrEqual(0.6);
      expect(confidence).toBeLessThan(0.85);
    });
  });

  it('tables가 빈 배열/누락이어도 throw 없음 (graceful)', () => {
    expect(() => extract(makeParsedJson({ keyValueSource: 'none' }), REPORT, [])).not.toThrow();
    expect(() => extract(makeParsedJson({ keyValueSource: 'none' }), REPORT)).not.toThrow();
  });
});

describe('share-cancellation extractCancellation', () => {
  it('cancellationShares 추출', () => {
    const parsed = makeParsedJson({ cancellationShares: 1_000_000 });
    const result = extractCancellation(parsed, '');
    expect(result.cancellationShares).toBe(1_000_000);
    expect(result.cancellationRatioToTotal).toBeNull();
    expect(result.derivedDataMissing).toBe(true);
  });

  it('모든 필드 없어도 throw 없음', () => {
    const parsed = { docType: 'SHARE_CANCELLATION', rawTableCount: 0, keyValueSource: 'none' } as ParsedJson;
    expect(() => extractCancellation(parsed, '')).not.toThrow();
  });
});
