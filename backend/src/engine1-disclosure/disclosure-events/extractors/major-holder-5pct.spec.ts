// backend/src/disclosure-events/extractors/major-holder-5pct.spec.ts
// DAR-337: 대량보유(5%룰) extractor 단위 테스트 (실제 공시 샘플 기반)

import { extract } from './major-holder-5pct';
import { ParsedJson } from '../../disclosure-documents/types/parsed-json.type';
import * as sample from '../__fixtures__/major-holder-5pct-sample.json';

const EMPTY: ParsedJson = {
  docType: 'OTHER',
  rawTableCount: 0,
  keyValueSource: 'none',
} as ParsedJson;

describe('major-holder-5pct extract', () => {
  it('전 필드 존재 → 보유비율·변동·방향·목적 추출', () => {
    const r = extract(sample as ParsedJson, '주식등의 대량보유상황보고서');
    expect(r.holderName).toBe('국민연금공단');
    expect(r.holdingRatio).toBe(8.52);
    expect(r.previousHoldingRatio).toBe(6.31);
    // 파생: 8.52 - 6.31 = 2.21 (%p), 부호 양수 → INCREASE
    expect(r.holdingRatioChange).toBe(2.21);
    expect(r.changeDirection).toBe('INCREASE');
    expect(r.heldShares).toBe(5_230_000);
    expect(r.holdingPurpose).toBe('SIMPLE_INVESTMENT');
    expect(r.derivedDataMissing).toBe(false);
  });

  it('지분 감소 → DECREASE + 음수 변동치', () => {
    const r = extract(
      { ...EMPTY, holdingRatio: 5.1, previousHoldingRatio: 7.4 } as ParsedJson,
      '주식등의 대량보유상황보고서',
    );
    expect(r.holdingRatioChange).toBe(-2.3);
    expect(r.changeDirection).toBe('DECREASE');
  });

  it('소수 비율(0<r<1) → *100 정규화', () => {
    const r = extract(
      { ...EMPTY, holdingRatio: 0.085, previousHoldingRatio: 0.063 } as ParsedJson,
      '대량보유상황보고',
    );
    expect(r.holdingRatio).toBe(8.5);
    expect(r.previousHoldingRatio).toBe(6.3);
  });

  it('보유목적: 보고서명 키워드(경영참가)로 분류', () => {
    const r = extract(
      { ...EMPTY, holdingRatio: 9.0 } as ParsedJson,
      '주식등의 대량보유상황보고서 (경영참가 목적)',
    );
    expect(r.holdingPurpose).toBe('MANAGEMENT_PARTICIPATION');
  });

  it('직전 비율 부재 → 변동치 null·방향 UNKNOWN(보유비율은 추출)', () => {
    const r = extract({ ...EMPTY, holdingRatio: 6.0 } as ParsedJson, '대량보유상황보고');
    expect(r.holdingRatio).toBe(6.0);
    expect(r.holdingRatioChange).toBeNull();
    expect(r.changeDirection).toBe('UNKNOWN');
    expect(r.derivedDataMissing).toBe(false);
  });

  it('구조화 필드 부재(빈 parsedJson) → 전 null·derivedDataMissing(상위 NEEDS_REVIEW 경로)', () => {
    const r = extract(EMPTY, '주식등의 대량보유상황보고서');
    expect(r.holdingRatio).toBeNull();
    expect(r.previousHoldingRatio).toBeNull();
    expect(r.holdingRatioChange).toBeNull();
    expect(r.changeDirection).toBe('UNKNOWN');
    expect(r.holdingPurpose).toBe('UNKNOWN');
    expect(r.derivedDataMissing).toBe(true);
  });

  it('음수/NaN 보유비율 → null (방어)', () => {
    const neg = extract({ ...EMPTY, holdingRatio: -3 } as ParsedJson, '대량보유상황보고');
    expect(neg.holdingRatio).toBeNull();
    const nan = extract({ ...EMPTY, holdingRatio: NaN } as ParsedJson, '대량보유상황보고');
    expect(nan.holdingRatio).toBeNull();
  });
});
