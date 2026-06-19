// backend/src/disclosure-events/extractors/supply-contract.spec.ts
// 공급계약 추출 파서 단위 테스트

import { extract } from './supply-contract';
import { ParsedJson } from '../../disclosure-documents/types/parsed-json.type';
import * as sampleFixture from '../__fixtures__/supply-contract-sample.json';
import * as missingSalesFixture from '../__fixtures__/supply-contract-missing-sales.json';
import * as altKeyFixture from '../__fixtures__/supply-contract-altkey.json';
import * as reportNameOnlyFixture from '../__fixtures__/supply-contract-reportname-only.json';

/** 대체키 등 ParsedJson 타입 외 원시 키를 포함한 입력 구성용 */
function makeRaw(extra: Record<string, unknown>): ParsedJson {
  return {
    docType: 'SUPPLY_CONTRACT',
    rawTableCount: 1,
    keyValueSource: 'table_0',
    ...extra,
  } as unknown as ParsedJson;
}

function makeParsedJson(overrides: Partial<ParsedJson> = {}): ParsedJson {
  return {
    docType: 'SUPPLY_CONTRACT',
    rawTableCount: 1,
    keyValueSource: 'table_0',
    ...overrides,
  } as ParsedJson;
}

describe('supply-contract extract', () => {
  describe('salesRatio 계산', () => {
    it('contractAmount / recentSales * 100을 소수점 2자리로 반환', () => {
      const parsed = makeParsedJson({
        contractAmount: 120_000_000_000,
        recentSales: 500_000_000_000,
      });
      const result = extract(parsed, '단일판매·공급계약체결');
      expect(result.salesRatio).toBe(24.0);
    });

    it('sampleFixture 기반 salesRatio 계산', () => {
      const result = extract(sampleFixture as ParsedJson, '단일판매·공급계약체결');
      expect(result.contractAmount).toBe(120_000_000_000);
      expect(result.recentSales).toBe(500_000_000_000);
      expect(result.salesRatio).toBe(24.0);
    });

    it('recentSales null → salesRatio null', () => {
      const parsed = makeParsedJson({ contractAmount: 50_000_000_000 });
      const result = extract(parsed, '');
      expect(result.salesRatio).toBeNull();
      expect(result.derivedDataMissing).toBe(true);
    });

    it('missingSalesFixture → salesRatio null', () => {
      const result = extract(missingSalesFixture as ParsedJson, '단일판매·공급계약체결');
      expect(result.salesRatio).toBeNull();
      expect(result.derivedDataMissing).toBe(true);
    });

    it('recentSales = 0 → salesRatio null (0으로 나누기 방지)', () => {
      const parsed = makeParsedJson({
        contractAmount: 10_000_000_000,
        recentSales: 0,
      });
      const result = extract(parsed, '');
      expect(result.salesRatio).toBeNull();
    });

    it('작은 금액 비율 계산 (소수점)', () => {
      const parsed = makeParsedJson({
        contractAmount: 1_000_000_000,    // 10억
        recentSales: 100_000_000_000,    // 1000억
      });
      const result = extract(parsed, '');
      expect(result.salesRatio).toBe(1.0);
    });
  });

  describe('contractDurationMonths 계산', () => {
    it('12개월 기간 계산', () => {
      const parsed = makeParsedJson({
        contractStartDate: '2024-06-01',
        contractEndDate: '2025-05-31',
      });
      const result = extract(parsed, '');
      expect(result.contractDurationMonths).toBe(12);
    });

    it('날짜 없으면 null', () => {
      const result = extract(makeParsedJson(), '');
      expect(result.contractDurationMonths).toBeNull();
    });

    it('startDate만 있고 endDate 없으면 null', () => {
      const parsed = makeParsedJson({ contractStartDate: '2024-01-01' });
      const result = extract(parsed, '');
      expect(result.contractDurationMonths).toBeNull();
    });
  });

  describe('날짜 정규화', () => {
    it('YYYY.MM.DD 형식 정규화', () => {
      const parsed = makeParsedJson({
        contractStartDate: '2024.06.01',
        contractEndDate: '2025.05.31',
      });
      const result = extract(parsed, '');
      expect(result.contractStartDate).toBe('2024-06-01');
      expect(result.contractEndDate).toBe('2025-05-31');
    });

    it('이미 YYYY-MM-DD 형식이면 그대로', () => {
      const parsed = makeParsedJson({ contractStartDate: '2024-07-01' });
      const result = extract(parsed, '');
      expect(result.contractStartDate).toBe('2024-07-01');
    });
  });

  describe('counterpartyType', () => {
    it('영문 포함 거래상대방 → FOREIGN', () => {
      const parsed = makeParsedJson({ counterparty: 'Apple Inc.' });
      const result = extract(parsed, '');
      expect(result.counterpartyType).toBe('FOREIGN');
    });

    it('한글만(비대기업·비외국) → UNKNOWN', () => {
      const parsed = makeParsedJson({ counterparty: '국내주식회사' });
      const result = extract(parsed, '');
      expect(result.counterpartyType).toBe('UNKNOWN');
    });

    it('거래상대방 없으면 UNKNOWN', () => {
      const result = extract(makeParsedJson(), '');
      expect(result.counterpartyType).toBe('UNKNOWN');
    });

    // DAR-248: DOMESTIC_LARGE 도달 가능성 확보 (대기업집단 키워드 매칭)
    describe('DOMESTIC_LARGE 분류 (국내 대기업군)', () => {
      it.each([
        ['삼성전자(주)'],
        ['에스케이하이닉스'],
        ['현대자동차주식회사'],
        ['주식회사 카카오'],
        ['포스코홀딩스'],
        ['엘지화학'],
      ])('%s → DOMESTIC_LARGE', (counterparty) => {
        const result = extract(makeParsedJson({ counterparty }), '');
        expect(result.counterpartyType).toBe('DOMESTIC_LARGE');
      });

      it('대기업 키워드는 영문/외국 키워드보다 우선', () => {
        const result = extract(makeParsedJson({ counterparty: '삼성디스플레이' }), '');
        expect(result.counterpartyType).toBe('DOMESTIC_LARGE');
      });
    });

    // DAR-248: 외국법인 한글약칭 보강 (기존엔 UNKNOWN으로 FOREIGN 누락)
    describe('FOREIGN 분류 (외국법인 한글약칭)', () => {
      it.each([['구글'], ['엔비디아'], ['도요타'], ['지멘스']])(
        '%s → FOREIGN',
        (counterparty) => {
          const result = extract(makeParsedJson({ counterparty }), '');
          expect(result.counterpartyType).toBe('FOREIGN');
        },
      );
    });

    // DAR-248: DOMESTIC_SME는 enum에서 제거됨 (이름만으로 신뢰 분류 불가)
    it('국내 비대기업(중소·중견 추정)도 SME가 아닌 UNKNOWN으로 분류', () => {
      const result = extract(makeParsedJson({ counterparty: '한빛정밀공업' }), '');
      expect(result.counterpartyType).toBe('UNKNOWN');
      expect(result.counterpartyType).not.toBe('DOMESTIC_SME' as never);
    });
  });

  // DAR-342: 계약금액 회수 폴백 (FAILED 57건 복구) — DIRECT → ALT_KEY → REPORT_NAME
  describe('계약금액 회수 폴백 (DAR-342)', () => {
    describe('DIRECT (표준 매핑 필드)', () => {
      it('contractAmount 직접조회 시 source=DIRECT', () => {
        const result = extract(
          makeParsedJson({ contractAmount: 50_000_000_000 }),
          '단일판매·공급계약체결',
        );
        expect(result.contractAmount).toBe(50_000_000_000);
        expect(result.contractAmountSource).toBe('DIRECT');
      });

      it('sampleFixture → DIRECT', () => {
        const result = extract(sampleFixture as ParsedJson, '단일판매·공급계약체결');
        expect(result.contractAmountSource).toBe('DIRECT');
      });

      it('DIRECT는 보고서명 금액보다 우선', () => {
        const result = extract(
          makeParsedJson({ contractAmount: 50_000_000_000 }),
          '단일판매·공급계약체결(999억원)',
        );
        expect(result.contractAmount).toBe(50_000_000_000);
        expect(result.contractAmountSource).toBe('DIRECT');
      });
    });

    describe('ALT_KEY (표 헤더 대체키 스캔)', () => {
      it('판매금액 문자열 토큰 회수 → ALT_KEY', () => {
        const result = extract(makeRaw({ 판매금액: '880억원' }), '단일판매·공급계약체결');
        expect(result.contractAmount).toBe(88_000_000_000);
        expect(result.contractAmountSource).toBe('ALT_KEY');
      });

      it('수주금액 숫자 회수 → ALT_KEY', () => {
        const result = extract(makeRaw({ 수주금액: 12_000_000_000 }), '');
        expect(result.contractAmount).toBe(12_000_000_000);
        expect(result.contractAmountSource).toBe('ALT_KEY');
      });

      it('매출액(최후 후보)만 있으면 회수 → ALT_KEY', () => {
        const result = extract(makeRaw({ 매출액: '1,000억원' }), '');
        expect(result.contractAmount).toBe(100_000_000_000);
        expect(result.contractAmountSource).toBe('ALT_KEY');
      });

      it('우선순위: 계약금액 대체키가 판매금액보다 우선', () => {
        const result = extract(
          makeRaw({ 계약금액: '500억원', 판매금액: '880억원' }),
          '',
        );
        expect(result.contractAmount).toBe(50_000_000_000);
        expect(result.contractAmountSource).toBe('ALT_KEY');
      });

      it('altKeyFixture: 판매금액 회수 + recentSales 기반 salesRatio 산출', () => {
        const result = extract(altKeyFixture as unknown as ParsedJson, '단일판매·공급계약체결');
        expect(result.contractAmount).toBe(88_000_000_000);
        expect(result.contractAmountSource).toBe('ALT_KEY');
        expect(result.recentSales).toBe(400_000_000_000);
        // 880억 / 4000억 * 100 = 22.0
        expect(result.salesRatio).toBe(22.0);
      });
    });

    describe('REPORT_NAME (보고서명 괄호 금액 정규식)', () => {
      it('단일판매공급계약(123억원) → 123억', () => {
        const result = extract(makeParsedJson(), '단일판매공급계약(123억원)');
        expect(result.contractAmount).toBe(12_300_000_000);
        expect(result.contractAmountSource).toBe('REPORT_NAME');
      });

      it('콤마 포함 원 단위 표기 회수', () => {
        const result = extract(
          makeParsedJson(),
          '단일판매·공급계약체결(12,000,000,000원)',
        );
        expect(result.contractAmount).toBe(12_000_000_000);
        expect(result.contractAmountSource).toBe('REPORT_NAME');
      });

      it('조+억 결합 표기 회수', () => {
        const result = extract(makeParsedJson(), '대규모공급계약(1조2000억원)');
        expect(result.contractAmount).toBe(1_200_000_000_000);
        expect(result.contractAmountSource).toBe('REPORT_NAME');
      });

      it('reportNameOnlyFixture + 보고서명 금액 → REPORT_NAME', () => {
        const result = extract(
          reportNameOnlyFixture as unknown as ParsedJson,
          '단일판매·공급계약체결(450억원)',
        );
        expect(result.contractAmount).toBe(45_000_000_000);
        expect(result.contractAmountSource).toBe('REPORT_NAME');
      });

      it('단위 없는 단순 숫자(차수·일자)는 오추출하지 않음 → NONE', () => {
        const result = extract(makeParsedJson(), '단일판매·공급계약체결(제3호)');
        expect(result.contractAmount).toBeNull();
        expect(result.contractAmountSource).toBe('NONE');
      });
    });

    describe('NONE (미회수)', () => {
      it('금액 단서가 전혀 없으면 NONE + null', () => {
        const result = extract(makeParsedJson(), '단일판매·공급계약체결');
        expect(result.contractAmount).toBeNull();
        expect(result.contractAmountSource).toBe('NONE');
      });

      it('0·음수 대체키는 인정하지 않음 → NONE', () => {
        const result = extract(makeRaw({ 판매금액: 0, 수주금액: -100 }), '');
        expect(result.contractAmount).toBeNull();
        expect(result.contractAmountSource).toBe('NONE');
      });

      it('파싱 불가 문자열 대체키 → NONE', () => {
        const result = extract(makeRaw({ 판매금액: '미정' }), '');
        expect(result.contractAmount).toBeNull();
        expect(result.contractAmountSource).toBe('NONE');
      });
    });

    it('회귀: 기존 missingSalesFixture는 DIRECT 유지', () => {
      const result = extract(missingSalesFixture as ParsedJson, '단일판매·공급계약체결');
      expect(result.contractAmount).toBe(50_000_000_000);
      expect(result.contractAmountSource).toBe('DIRECT');
    });
  });

  describe('예외 내성', () => {
    it('parsedJson이 모두 undefined여도 빈 결과 반환 (throw 없음)', () => {
      const parsed = { docType: 'SUPPLY_CONTRACT', rawTableCount: 0, keyValueSource: 'none' } as ParsedJson;
      expect(() => extract(parsed, '')).not.toThrow();
      const result = extract(parsed, '');
      expect(result.contractAmount).toBeNull();
      expect(result.salesRatio).toBeNull();
    });
  });
});
