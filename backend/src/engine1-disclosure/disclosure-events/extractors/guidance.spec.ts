// backend/src/disclosure-events/extractors/guidance.spec.ts
// 실적 가이던스(자사 전망) 추출 파서 단위 테스트 (W9)
//
// 핵심 불변식: 오추출 수치가 알림으로 나가면 신뢰 훼손이 W9 원죄보다 크다.
//   → 확정 단일 수치일 때만 채우고, 범위값·정성 서술은 null(UNKNOWN 폴백).
//   confidence 게이트(extractors/index.ts): 둘 다 0.90 / 하나 0.75 / 결측 0.0.

import { EventType } from '@prisma/client';
import {
  extract,
  parseGuidanceAmount,
  isRangeExpression,
  isQualitativeExpression,
} from './guidance';
import { extractEventData } from './index';
import { ParsedJson } from '../../disclosure-documents/types/parsed-json.type';
import { Table } from '../../disclosure-documents/types/table.type';

const GUIDANCE_REPORT = '연결재무제표기준영업실적등에대한전망(공정공시)';

function makeParsedJson(overrides: Partial<ParsedJson> = {}): ParsedJson {
  return {
    docType: '',
    rawTableCount: 1,
    keyValueSource: 'table_0',
    ...overrides,
  } as ParsedJson;
}

function makeTable(overrides: Partial<Table> = {}): Table {
  return {
    tableIndex: 0,
    headers: [],
    rows: [],
    hasColspan: false,
    hasRowspan: false,
    ...overrides,
  };
}

describe('guidance extract — 성공 경로', () => {
  it('정형 키(guidanceRevenue/guidanceOperatingProfit) → 그대로 채움', () => {
    const result = extract(
      makeParsedJson({
        guidanceRevenue: 3_500_000_000_000,
        guidanceOperatingProfit: 280_000_000_000,
      }),
      GUIDANCE_REPORT,
    );
    expect(result.guidanceRevenue).toBe(3_500_000_000_000);
    expect(result.guidanceOperatingProfit).toBe(280_000_000_000);
    expect(result.derivedDataMissing).toBe(false);
    expect(result.isRangeValue).toBe(false);
    expect(result.isQualitative).toBe(false);
  });

  it('전망 헤더 컬럼 표 스캔 → 전망치 채움 + 전년 컬럼으로 YoY·방향 파생', () => {
    const table = makeTable({
      headers: ['구분', '당기 전망', '전년 실적'],
      rows: [
        ['매출액', '3,500,000', '3,200,000'],
        ['영업이익', '280,000', '250,000'],
      ],
      unitNote: '단위: 백만원',
    });
    const result = extract(makeParsedJson(), GUIDANCE_REPORT, [table]);
    expect(result.guidanceRevenue).toBe(3_500_000_000_000);
    expect(result.guidanceOperatingProfit).toBe(280_000_000_000);
    expect(result.previousRevenue).toBe(3_200_000_000_000);
    expect(result.previousOperatingProfit).toBe(250_000_000_000);
    expect(result.guidanceOperatingProfitYoY).toBe(12.0);
    expect(result.guidanceRevenueYoY).toBeCloseTo(9.38, 2);
    expect(result.guidanceDirection).toBe('UP');
  });

  it('영업이익률(%) 행은 영업이익으로 오채택하지 않는다', () => {
    const table = makeTable({
      headers: ['구분', '전망'],
      rows: [
        ['영업이익률', '12.5'],
        ['영업이익', '1,200억원'],
      ],
    });
    const result = extract(makeParsedJson(), GUIDANCE_REPORT, [table]);
    expect(result.guidanceOperatingProfit).toBe(120_000_000_000);
  });

  it('key-value형 표(라벨 자체가 전망) + 단일 값 셀 → 채움', () => {
    const table = makeTable({
      rows: [
        ['매출액 전망', '1조 2000억원'],
        ['영업이익 전망', '△1,200억원'],
      ],
    });
    const result = extract(makeParsedJson(), GUIDANCE_REPORT, [table]);
    expect(result.guidanceRevenue).toBe(1_200_000_000_000);
    expect(result.guidanceOperatingProfit).toBe(-120_000_000_000); // △=손실 전망
  });
});

describe('guidance extract — 범위값 폴백 (수치 미채움)', () => {
  it("범위값('3,000억~3,500억원') → null + isRangeValue", () => {
    const table = makeTable({
      rows: [['매출액 전망', '3,000억~3,500억원']],
    });
    const result = extract(makeParsedJson(), GUIDANCE_REPORT, [table]);
    expect(result.guidanceRevenue).toBeNull();
    expect(result.isRangeValue).toBe(true);
    expect(result.derivedDataMissing).toBe(true);
  });

  it("범위값('1조원대') → null + isRangeValue", () => {
    const table = makeTable({
      rows: [['영업이익 전망', '1조원대']],
    });
    const result = extract(makeParsedJson(), GUIDANCE_REPORT, [table]);
    expect(result.guidanceOperatingProfit).toBeNull();
    expect(result.isRangeValue).toBe(true);
  });

  it('블롭 대체 키의 범위값 문자열도 게이팅', () => {
    const result = extract(
      makeParsedJson({ 매출액전망: '5,000억원 내외' } as unknown as Partial<ParsedJson>),
      GUIDANCE_REPORT,
    );
    expect(result.guidanceRevenue).toBeNull();
    expect(result.isRangeValue).toBe(true);
  });
});

describe('guidance extract — 정성 서술 폴백 (수치 미채움)', () => {
  it("정성 서술('전년 대비 개선 예상') → null + isQualitative + 방향 UNKNOWN", () => {
    const table = makeTable({
      rows: [['매출액 전망', '전년 대비 개선 예상']],
    });
    const result = extract(makeParsedJson(), GUIDANCE_REPORT, [table]);
    expect(result.guidanceRevenue).toBeNull();
    expect(result.isQualitative).toBe(true);
    expect(result.derivedDataMissing).toBe(true);
    expect(result.guidanceDirection).toBe('UNKNOWN');
  });

  it('key-value형 표에서 파싱 가능 셀이 2개(모호) → 채우지 않음(신뢰 게이트)', () => {
    const table = makeTable({
      rows: [['매출액 전망', '3,200,000', '3,500,000']],
      unitNote: '단위: 백만원',
    });
    const result = extract(makeParsedJson(), GUIDANCE_REPORT, [table]);
    expect(result.guidanceRevenue).toBeNull();
  });

  it('수치 전무 + 보고서명 상향/하향 키워드 → 방향만 보조 판정', () => {
    expect(
      extract(makeParsedJson(), '연결재무제표기준영업실적등에대한전망(공정공시)(상향)').guidanceDirection,
    ).toBe('UP');
    expect(
      extract(makeParsedJson(), '연결재무제표기준영업실적등에대한전망(공정공시)(하향)').guidanceDirection,
    ).toBe('DOWN');
    expect(extract(makeParsedJson(), GUIDANCE_REPORT).guidanceDirection).toBe('UNKNOWN');
  });
});

describe('parseGuidanceAmount — 정규식 파서', () => {
  it.each<[string, number]>([
    ['1,200억원', 120_000_000_000],
    ['1조 2000억원', 1_200_000_000_000],
    ['2조원', 2_000_000_000_000],
    ['350억', 35_000_000_000],
    ['△1,200억원', -120_000_000_000],
    ['-500억원', -50_000_000_000],
  ])('%s → %d', (raw, expected) => {
    expect(parseGuidanceAmount(raw)).toBe(expected);
  });

  it('unitNote 배율 보정: "3,500,000" + 단위:백만원 → 3.5조', () => {
    expect(parseGuidanceAmount('3,500,000', '단위: 백만원')).toBe(3_500_000_000_000);
  });

  it.each(['3,000억~3,500억원', '1조원대', '5,000억원 내외', '전년 수준', '미정', '약 10% 성장 목표'])(
    '확정 수치가 아닌 "%s" → null',
    (raw) => {
      expect(parseGuidanceAmount(raw)).toBeNull();
    },
  );
});

describe('isRangeExpression / isQualitativeExpression', () => {
  it('범위 표현 감지', () => {
    expect(isRangeExpression('3,000억~3,500억원')).toBe(true);
    expect(isRangeExpression('1조원대')).toBe(true);
    expect(isRangeExpression('5% 내외')).toBe(true);
    expect(isRangeExpression('3,000 - 3,500억')).toBe(true);
    expect(isRangeExpression('1,200억원')).toBe(false);
    expect(isRangeExpression('-500억원')).toBe(false); // 음수는 범위 아님
  });

  it('정성 서술 감지', () => {
    expect(isQualitativeExpression('전년 대비 개선 예상')).toBe(true);
    expect(isQualitativeExpression('미정')).toBe(true);
    expect(isQualitativeExpression('약 10% 성장 목표')).toBe(true); // 금액 아닌 비율 서술
    expect(isQualitativeExpression('1,200억원')).toBe(false);
    expect(isQualitativeExpression('')).toBe(false);
  });
});

describe('extractEventData — EARNINGS_GUIDANCE confidence 게이트', () => {
  it('전망 2종 모두 확정 수치 → confidence 0.90 (SUCCESS 경로)', () => {
    const { data, confidence } = extractEventData(
      EventType.EARNINGS_GUIDANCE,
      makeParsedJson({
        guidanceRevenue: 3_500_000_000_000,
        guidanceOperatingProfit: 280_000_000_000,
      }),
      GUIDANCE_REPORT,
    );
    expect(data.guidanceRevenue).toBe(3_500_000_000_000);
    expect(confidence).toBe(0.90);
  });

  it('하나만 회수 → confidence 0.75 (NEEDS_REVIEW 경로 — 단정 금지)', () => {
    const { confidence } = extractEventData(
      EventType.EARNINGS_GUIDANCE,
      makeParsedJson({ guidanceRevenue: 3_500_000_000_000 }),
      GUIDANCE_REPORT,
    );
    expect(confidence).toBe(0.75);
  });

  it('범위값·정성 서술로 전부 결측 → confidence 0.0 (상위 AI L1 대기, 수치 날조 없음)', () => {
    const table = makeTable({
      rows: [
        ['매출액 전망', '3,000억~3,500억원'],
        ['영업이익 전망', '전년 대비 개선 예상'],
      ],
    });
    const { data, confidence } = extractEventData(
      EventType.EARNINGS_GUIDANCE,
      makeParsedJson(),
      GUIDANCE_REPORT,
      [table],
    );
    expect(confidence).toBe(0.0);
    expect(data.guidanceRevenue).toBeNull();
    expect(data.guidanceOperatingProfit).toBeNull();
  });
});
