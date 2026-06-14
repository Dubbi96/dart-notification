// backend/src/engine1-disclosure/disclosure-documents/utils/dilution.util.spec.ts
// DAR-246: 희석률 SSOT 단위 테스트 + 세 경로(매퍼·추출기·서비스) 동일입력 동일출력 보증.

import { computeDilutionRate } from './dilution.util';
import { mapKeyValues } from '../mappers/key-value.mapper';
import { Table } from '../types/table.type';
import { extract } from '../../disclosure-events/extractors/capital-increase';
import { ParsedJson } from '../types/parsed-json.type';
import { DisclosureEventsService } from '../../disclosure-events/disclosure-events.service';
import { EventType } from '@prisma/client';

describe('computeDilutionRate (SSOT)', () => {
  it('신주/(기존+신주)*100, 소수점 2자리 (%)', () => {
    // 10M / (10M + 50M) * 100 = 16.666... → 16.67
    expect(computeDilutionRate(10_000_000, 50_000_000)).toBe(16.67);
    // 1000만 / (1000만 + 9000만) * 100 = 10.0  (이슈 예시: 기존공식 11.11과 구분)
    expect(computeDilutionRate(10_000_000, 90_000_000)).toBe(10.0);
    // 5M / (5M + 45M) * 100 = 10.0
    expect(computeDilutionRate(5_000_000, 45_000_000)).toBe(10.0);
  });

  it('newShares = 0 → 0% (희석 없음)', () => {
    expect(computeDilutionRate(0, 50_000_000)).toBe(0);
  });

  it('null/undefined 입력 → null', () => {
    expect(computeDilutionRate(null, 50_000_000)).toBeNull();
    expect(computeDilutionRate(10_000_000, null)).toBeNull();
    expect(computeDilutionRate(undefined, undefined)).toBeNull();
  });

  it('기존주식 ≤ 0 → null (분모 결손, 허위 100% 방지)', () => {
    expect(computeDilutionRate(10_000_000, 0)).toBeNull();
    expect(computeDilutionRate(10_000_000, -1)).toBeNull();
  });

  it('newShares < 0 → null (비정상 입력)', () => {
    expect(computeDilutionRate(-1, 50_000_000)).toBeNull();
  });
});

describe('dilutionRate SSOT — 세 경로 동일입력 동일출력 (DAR-246)', () => {
  // 동일 입력
  const NEW = 10_000_000;
  const EXISTING = 50_000_000;
  const EXPECTED = 16.67; // 10M / (10M + 50M) * 100

  it('SSOT 헬퍼 기준값', () => {
    expect(computeDilutionRate(NEW, EXISTING)).toBe(EXPECTED);
  });

  it('① 매퍼(key-value.mapper) — parsedJson.dilutionRate', () => {
    const tables: Table[] = [
      {
        tableIndex: 0,
        headers: [],
        rows: [
          ['신주 발행 주식수', String(NEW)],
          ['기존 발행 주식수', String(EXISTING)],
        ],
        hasColspan: false,
        hasRowspan: false,
      },
    ];
    const result = mapKeyValues(tables, 'PAID_IN_CAPITAL_INCREASE');
    expect(result.newShares).toBe(NEW);
    expect(result.existingShares).toBe(EXISTING);
    expect(result.dilutionRate).toBe(EXPECTED);
  });

  it('② 추출기(capital-increase.extract) — CapitalIncreaseData.dilutionRate', () => {
    const parsed = {
      docType: 'PAID_IN_CAPITAL_INCREASE',
      rawTableCount: 1,
      keyValueSource: 'table_0',
      newShares: NEW,
      existingShares: EXISTING,
    } as ParsedJson;
    const result = extract(parsed, '유상증자(주주배정)');
    expect(result.dilutionRate).toBe(EXPECTED);
  });

  it('③ 서비스(computeDerivedValues) — result.dilutionRate', () => {
    const service = new DisclosureEventsService(
      {} as never,
      {} as never,
    );
    const result = service.computeDerivedValues(
      EventType.PAID_IN_CAPITAL_INCREASE,
      { newShares: NEW, existingShares: EXISTING },
    );
    expect(result['dilutionRate']).toBe(EXPECTED);
  });

  it('세 경로 산출값이 서로 일치한다', () => {
    const tables: Table[] = [
      {
        tableIndex: 0,
        headers: [],
        rows: [
          ['신주 발행 주식수', String(NEW)],
          ['기존 발행 주식수', String(EXISTING)],
        ],
        hasColspan: false,
        hasRowspan: false,
      },
    ];
    const mapperValue = mapKeyValues(
      tables,
      'PAID_IN_CAPITAL_INCREASE',
    ).dilutionRate;

    const extractorValue = extract(
      {
        docType: 'PAID_IN_CAPITAL_INCREASE',
        rawTableCount: 1,
        keyValueSource: 'table_0',
        newShares: NEW,
        existingShares: EXISTING,
      } as ParsedJson,
      '',
    ).dilutionRate;

    const service = new DisclosureEventsService({} as never, {} as never);
    const serviceValue = service.computeDerivedValues(
      EventType.PAID_IN_CAPITAL_INCREASE,
      { newShares: NEW, existingShares: EXISTING },
    )['dilutionRate'];

    expect(mapperValue).toBe(extractorValue);
    expect(extractorValue).toBe(serviceValue);
    expect(mapperValue).toBe(computeDilutionRate(NEW, EXISTING));
  });
});
