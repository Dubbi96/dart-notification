import {
  buildFeatureSnapshot,
  canonicalizeFeatureJson,
  collectMissingFeatureKeys,
} from './feature-snapshot';
import { FeatureSnapshotInput } from './feature-snapshot.types';

function input(overrides: Partial<FeatureSnapshotInput> = {}): FeatureSnapshotInput {
  return {
    corpCode: '00126380',
    stockCode: '005930',
    asOf: new Date('2026-07-31T10:05:00.000Z'),
    marketSessionDate: '20260731',
    schemaVersion: 'legacy-buy-score.v1',
    features: { chart: { rsi14: 51.2, ma20: null }, persona: 'VALUE' },
    sourceRefs: { disclosure: { rcpNo: '20260731000123' }, price: '005930:20260731' },
    quality: {
      missingFeatureKeys: ['chart.ma20'],
      staleFeatureKeys: [],
      validationErrors: [],
    },
    ...overrides,
  };
}

describe('FeatureSnapshot domain', () => {
  it('같은 의미의 object key 순서와 quality set 순서가 달라도 동일 hash를 만든다', () => {
    const first = buildFeatureSnapshot(input());
    const second = buildFeatureSnapshot(
      input({
        features: { persona: 'VALUE', chart: { ma20: null, rsi14: 51.2 } },
        sourceRefs: { price: '005930:20260731', disclosure: { rcpNo: '20260731000123' } },
        quality: {
          missingFeatureKeys: ['chart.ma20', 'chart.ma20'],
          staleFeatureKeys: [],
          validationErrors: [],
        },
      }),
    );

    expect(second.contentHash).toBe(first.contentHash);
    expect(first.contentHash).toBe(
      '6a91e25f3b898bca639edf347d93cdde9557a7248e9c37c891abbf68e37160eb',
    );
    expect(second.quality.missingFeatureKeys).toEqual(['chart.ma20']);
  });

  it('관측 시점·schema·출처가 바뀌면 hash가 바뀐다', () => {
    const base = buildFeatureSnapshot(input()).contentHash;
    expect(
      buildFeatureSnapshot(input({ asOf: new Date('2026-07-31T10:05:01.000Z') })).contentHash,
    ).not.toBe(base);
    expect(
      buildFeatureSnapshot(input({ schemaVersion: 'legacy-buy-score.v2' })).contentHash,
    ).not.toBe(base);
    expect(
      buildFeatureSnapshot(input({ sourceRefs: { disclosure: { rcpNo: 'different' } } }))
        .contentHash,
    ).not.toBe(base);
  });

  it.each([
    { corpCode: '123' },
    { stockCode: 'A05930' },
    { marketSessionDate: '20260230' },
    { schemaVersion: 'bad schema' },
    { asOf: new Date('invalid') },
  ])('잘못된 식별자·날짜·schema를 fail-fast한다: %p', (override) => {
    expect(() => buildFeatureSnapshot(input(override))).toThrow(/Invalid feature snapshot/);
  });

  it('JSON 비호환 값과 비-객체 payload를 거절한다', () => {
    expect(() => buildFeatureSnapshot(input({ features: { bad: Number.NaN } }))).toThrow(
      /Invalid feature JSON/,
    );
    expect(() => buildFeatureSnapshot(input({ sourceRefs: [] }))).toThrow(/must be a JSON object/);
    expect(() => canonicalizeFeatureJson(new Date())).toThrow(/plain JSON objects/);
    expect(canonicalizeFeatureJson({ separator: '\u2028\u2029' })).toBe(
      '{"separator":"\\u2028\\u2029"}',
    );
  });

  it('null leaf를 결정적인 missing feature key로 수집한다', () => {
    expect(
      collectMissingFeatureKeys({ z: null, chart: { rsi14: 50, ma20: null }, rows: [null] }),
    ).toEqual(['chart.ma20', 'rows[0]', 'z']);
  });

  it('caller 입력을 복제·동결해 생성 후 mutation이 snapshot을 바꾸지 못한다', () => {
    const features = { chart: { rsi14: 51.2 } };
    const snapshot = buildFeatureSnapshot(input({ features }));

    features.chart.rsi14 = 99;

    expect(snapshot.features.chart).toEqual({ rsi14: 51.2 });
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.isFrozen(snapshot.features.chart)).toBe(true);
  });
});
