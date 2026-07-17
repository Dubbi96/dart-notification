// backend/src/disclosure-documents/mappers/key-value.mapper.spec.ts
import * as fs from 'fs';
import * as path from 'path';
import { mapKeyValues, parseKoreanAmount, parseDate } from './key-value.mapper';
import { parseTables } from '../parsers/table.parser';
import { parseXmlSections } from '../parsers/xml.parser';
import { cleanHtml } from '../parsers/html-cleaner';

const FIXTURES_DIR = path.join(__dirname, '../__fixtures__');

function loadFixtureTables(filename: string) {
  const xml = fs.readFileSync(path.join(FIXTURES_DIR, filename), 'utf-8');
  // XML에서 HTML 스타일 표 추출
  return parseTables(xml);
}

// ─── parseKoreanAmount 단위 테스트 ───────────────────────────────────────────
describe('parseKoreanAmount', () => {
  it('원 단위 숫자를 변환해야 한다', () => {
    expect(parseKoreanAmount('120,000,000,000원')).toBe(120_000_000_000);
  });

  it('억 단위를 변환해야 한다', () => {
    expect(parseKoreanAmount('1,200억원')).toBe(120_000_000_000);
    expect(parseKoreanAmount('120억')).toBe(12_000_000_000);
  });

  it('백만 단위를 변환해야 한다', () => {
    expect(parseKoreanAmount('50,000백만원')).toBe(50_000_000_000);
  });

  it('unitNote 백만원을 적용해야 한다', () => {
    expect(parseKoreanAmount('50,000', '단위: 백만원')).toBe(50_000_000_000);
  });

  it('변환 불가 시 undefined를 반환해야 한다', () => {
    expect(parseKoreanAmount('')).toBeUndefined();
    expect(parseKoreanAmount('해당없음')).toBeUndefined();
  });
});

// ─── parseDate 단위 테스트 ──────────────────────────────────────────────────
describe('parseDate', () => {
  it('YYYYMMDD 형식을 변환해야 한다', () => {
    expect(parseDate('20240601')).toBe('2024-06-01');
  });

  it('YYYY.MM.DD 형식을 변환해야 한다', () => {
    expect(parseDate('2024.06.01')).toBe('2024-06-01');
  });

  it('YYYY년 MM월 DD일 형식을 변환해야 한다', () => {
    expect(parseDate('2024년 6월 1일')).toBe('2024-06-01');
  });

  it('YYYY-MM-DD 형식은 그대로 반환해야 한다', () => {
    expect(parseDate('2024-06-01')).toBe('2024-06-01');
  });

  it('변환 불가 시 undefined를 반환해야 한다', () => {
    expect(parseDate('')).toBeUndefined();
    expect(parseDate('해당없음')).toBeUndefined();
  });
});

// ─── SUPPLY_CONTRACT 매핑 ───────────────────────────────────────────────────
describe('mapKeyValues - SUPPLY_CONTRACT', () => {
  it('supply-contract.xml 픽스처에서 계약금액을 추출해야 한다', () => {
    const tables = loadFixtureTables('supply-contract.xml');
    const result = mapKeyValues(tables, 'SUPPLY_CONTRACT');

    expect(result.docType).toBe('SUPPLY_CONTRACT');
    expect(result.contractAmount).toBe(120_000_000_000);
    expect(result.recentSales).toBe(500_000_000_000);
    expect(result.counterparty).toBe('글로벌바이어주식회사');
    expect(result.rawTableCount).toBeGreaterThan(0);
    expect(result.keyValueSource).not.toBe('none');
  });

  it('salesRatio를 계산해야 한다', () => {
    const tables = loadFixtureTables('supply-contract.xml');
    const result = mapKeyValues(tables, 'SUPPLY_CONTRACT');

    if (result.contractAmount && result.recentSales) {
      expect(result.salesRatio).toBeCloseTo(0.24, 3);
    }
  });

  it('계약기간을 파싱해야 한다', () => {
    const tables = loadFixtureTables('supply-contract.xml');
    const result = mapKeyValues(tables, 'SUPPLY_CONTRACT');

    expect(result.contractStartDate).toBe('2024-06-01');
    expect(result.contractEndDate).toBe('2025-05-31');
  });
});

// ─── SHARE_BUYBACK 매핑 ─────────────────────────────────────────────────────
describe('mapKeyValues - SHARE_BUYBACK', () => {
  it('share-buyback.xml 픽스처에서 취득 정보를 추출해야 한다', () => {
    const tables = loadFixtureTables('share-buyback.xml');
    const result = mapKeyValues(tables, 'SHARE_BUYBACK');

    expect(result.docType).toBe('SHARE_BUYBACK');
    expect(result.acquisitionShares).toBe(1_000_000);
    expect(result.acquisitionAmount).toBe(50_000_000_000);
    expect(result.acquisitionMethod).toBe('장내 직접매수');
    expect(result.acquisitionStartDate).toBe('2024-06-03');
    expect(result.acquisitionEndDate).toBe('2024-09-02');
  });
});

// ─── DIVIDEND 매핑 ──────────────────────────────────────────────────────────
describe('mapKeyValues - DIVIDEND', () => {
  it('dividend.xml 픽스처에서 배당 정보를 추출해야 한다', () => {
    const tables = loadFixtureTables('dividend.xml');
    const result = mapKeyValues(tables, 'DIVIDEND');

    expect(result.docType).toBe('DIVIDEND');
    expect(result.dividendPerShare).toBe(500);
    expect(result.dividendTotal).toBe(25_000_000_000);
    expect(result.dividendRecordDate).toBe('2024-12-31');
  });
});

// ─── PAID_IN_CAPITAL_INCREASE 매핑 ──────────────────────────────────────────
describe('mapKeyValues - PAID_IN_CAPITAL_INCREASE', () => {
  it('paid-in-capital.xml 픽스처에서 증자 정보를 추출해야 한다', () => {
    const tables = loadFixtureTables('paid-in-capital.xml');
    const result = mapKeyValues(tables, 'PAID_IN_CAPITAL_INCREASE');

    expect(result.docType).toBe('PAID_IN_CAPITAL_INCREASE');
    expect(result.newShares).toBe(5_000_000);
    expect(result.existingShares).toBe(45_000_000);
    expect(result.fundingAmount).toBe(100_000_000_000);
    expect(result.issueMethod).toContain('주주배정');
  });

  it('희석률을 계산해야 한다 (SSOT: 신주/(기존+신주)*100, %)', () => {
    const tables = loadFixtureTables('paid-in-capital.xml');
    const result = mapKeyValues(tables, 'PAID_IN_CAPITAL_INCREASE');

    if (result.newShares && result.existingShares) {
      const expected =
        (result.newShares / (result.newShares + result.existingShares)) * 100;
      expect(result.dilutionRate).toBeCloseTo(expected, 2);
    }
  });

  // DAR-538: 예정 이벤트 캘린더 — 청약일·신주 상장예정일 추출
  const dateTable = (rows: string[][]) => [
    {
      tableIndex: 0,
      headers: [],
      rows,
      hasColspan: false,
      hasRowspan: false,
    },
  ];

  it('청약예정일·상장예정일 라벨에서 날짜를 추출해야 한다 (DAR-538)', () => {
    const result = mapKeyValues(
      dateTable([
        ['청약예정일', '2026.08.03'],
        ['신주의 상장 예정일', '2026.08.21'],
      ]),
      'PAID_IN_CAPITAL_INCREASE',
    );
    expect(result.subscriptionDate).toBe('2026-08-03');
    expect(result.listingDate).toBe('2026-08-21');
  });

  it('청약 기간 표기(시작~종료)는 시작일을 채택해야 한다 (DAR-538)', () => {
    const result = mapKeyValues(
      dateTable([['청약일', '2026.08.03 ~ 2026.08.04']]),
      'PAID_IN_CAPITAL_INCREASE',
    );
    expect(result.subscriptionDate).toBe('2026-08-03');
  });

  it('날짜 라벨이 없거나 파싱 불가면 undefined를 유지해야 한다 — 발명 금지 (DAR-538)', () => {
    const noLabel = mapKeyValues(
      dateTable([['발행 금액', '10,000,000,000원']]),
      'PAID_IN_CAPITAL_INCREASE',
    );
    expect(noLabel.subscriptionDate).toBeUndefined();
    expect(noLabel.listingDate).toBeUndefined();

    const unparsable = mapKeyValues(
      dateTable([['청약예정일', '미정']]),
      'PAID_IN_CAPITAL_INCREASE',
    );
    expect(unparsable.subscriptionDate).toBeUndefined();
  });

  it('청약가격 할인 라벨은 청약일로 오추출되지 않아야 한다 (DAR-538)', () => {
    const result = mapKeyValues(
      dateTable([['청약가격 할인율', '25%']]),
      'PAID_IN_CAPITAL_INCREASE',
    );
    expect(result.subscriptionDate).toBeUndefined();
    expect(result.discountRate).toBe(25);
  });
});

// ─── CB_BW_ISSUANCE 매핑 ────────────────────────────────────────────────────
describe('mapKeyValues - CB_BW_ISSUANCE', () => {
  it('cb-issuance.xml 픽스처에서 CB 정보를 추출해야 한다', () => {
    const xml = fs.readFileSync(
      path.join(FIXTURES_DIR, 'cb-issuance.xml'),
      'utf-8',
    );
    const rawText = parseXmlSections(xml).join('\n');
    const tables = loadFixtureTables('cb-issuance.xml');
    const result = mapKeyValues(tables, 'CB_BW_ISSUANCE', rawText);

    expect(result.docType).toBe('CB_BW_ISSUANCE');
    expect(result.issuanceAmount).toBe(30_000_000_000);
    expect(result.maturityDate).toBe('2027-06-01');
    expect(result.bondType).toBe('CB');
  });
});

// ─── 매핑 불가(null eventType) 처리 ────────────────────────────────────────
describe('mapKeyValues - null/unknown eventType', () => {
  it('null eventType 에 대해 메타 정보만 반환해야 한다', () => {
    const result = mapKeyValues([], null);
    expect(result.docType).toBe('UNKNOWN');
    expect(result.rawTableCount).toBe(0);
    expect(result.keyValueSource).toBe('none');
  });
});

// ─── 정정공시 픽스처 핵심 경로 검증 ─────────────────────────────────────────
describe('mapKeyValues - SUPPLY_CONTRACT 정정공시 (amendment fixture)', () => {
  /**
   * [KA-04] supply-contract-amendment.xml 파싱 경로 회귀 테스트
   *
   * 이 픽스처는 3컬럼(항목/정정전/정정후) 표를 첫 번째 테이블로 갖는다.
   * findValueByLabel 은 row[1] (정정 전 값)을 반환하므로
   * contractAmount는 원공시 값(120억)이 추출됨.
   *
   * 이 동작은 현재 mapper 설계 한계이며:
   *   - 원공시 parsedJson 이 이미 존재하면 diff는 computeAmendmentDiff 로 계산
   *   - 정정공시 자체의 정확한 contractAmount는 두 번째 표(Table 1)에서 추출 가능하나
   *     현재 findValueByLabel은 첫 매칭 행에서 중단
   *
   * 목적: 이 제약을 문서화하고 추후 mapper 개선 시 회귀를 감지한다.
   */
  it('[KA-04] 정정공시 픽스처를 파싱했을 때 contractAmount가 추출되어야 한다 (값 정확도 제약 포함)', () => {
    const tables = loadFixtureTables('supply-contract-amendment.xml');
    const result = mapKeyValues(tables, 'SUPPLY_CONTRACT');

    expect(result.docType).toBe('SUPPLY_CONTRACT');
    // 테이블이 2개(정정 diff 표 + 계약 내역 표) 존재해야 한다
    expect(result.rawTableCount).toBe(2);
    // contractAmount는 어떤 테이블에서든 반드시 추출되어야 한다
    expect(result.contractAmount).toBeDefined();
    // keyValueSource가 'none'이 아니어야 한다 (매핑 성공 확인)
    expect(result.keyValueSource).not.toBe('none');
  });

  it('[KA-05] 정정공시 픽스처에서 counterparty가 추출되어야 한다', () => {
    const tables = loadFixtureTables('supply-contract-amendment.xml');
    const result = mapKeyValues(tables, 'SUPPLY_CONTRACT');

    // 두 번째 표에 '계약상대방' 행이 있으므로 counterparty 추출 가능
    expect(result.counterparty).toBe('글로벌바이어주식회사');
  });
});
