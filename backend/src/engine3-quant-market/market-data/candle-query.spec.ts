import {
  CANDLE_RESOLUTIONS,
  CandleQueryError,
  DEFAULT_CANDLE_LIMIT,
  MAX_CANDLE_LIMIT,
  normalizeCandleQuery,
  parseInstantMs,
  resolveCandleSource,
} from './candle-query';

describe('candle-query (DAR-378 순수 정규화)', () => {
  describe('parseInstantMs', () => {
    it('ISO 8601 을 epoch ms 로 파싱', () => {
      expect(parseInstantMs('2026-06-20T00:00:00.000Z')).toBe(
        Date.UTC(2026, 5, 20, 0, 0, 0),
      );
    });

    it('compact YYYYMMDD 를 UTC 자정으로 파싱', () => {
      expect(parseInstantMs('20260620')).toBe(Date.UTC(2026, 5, 20, 0, 0, 0));
    });

    it('compact YYYYMMDDHHmm 을 UTC 로 파싱', () => {
      expect(parseInstantMs('202606200930')).toBe(
        Date.UTC(2026, 5, 20, 9, 30, 0),
      );
    });

    it('compact YYYYMMDDHHmmss 를 UTC 로 파싱', () => {
      expect(parseInstantMs('20260620093015')).toBe(
        Date.UTC(2026, 5, 20, 9, 30, 15),
      );
    });

    it('빈 값·null 은 null', () => {
      expect(parseInstantMs('')).toBeNull();
      expect(parseInstantMs(null)).toBeNull();
      expect(parseInstantMs(undefined)).toBeNull();
      expect(parseInstantMs('   ')).toBeNull();
    });

    it('형식 불량은 null', () => {
      expect(parseInstantMs('not-a-date')).toBeNull();
      expect(parseInstantMs('20261320')).toBeNull(); // 13월
      expect(parseInstantMs('20260640')).toBeNull(); // 40일
      expect(parseInstantMs('202606209960')).toBeNull(); // 99시
    });
  });

  describe('resolveCandleSource — 해상도→관계 화이트리스트', () => {
    it('1m 은 원본 하이퍼테이블', () => {
      expect(resolveCandleSource('1m')).toEqual({
        relation: 'stock_minute_prices',
        timeColumn: 'ts',
      });
    });

    it('5m/15m/1d 는 연속집계 뷰(bucket 컬럼)', () => {
      expect(resolveCandleSource('5m')).toEqual({
        relation: 'stock_candles_5m',
        timeColumn: 'bucket',
      });
      expect(resolveCandleSource('15m')).toEqual({
        relation: 'stock_candles_15m',
        timeColumn: 'bucket',
      });
      expect(resolveCandleSource('1d')).toEqual({
        relation: 'stock_candles_1d',
        timeColumn: 'bucket',
      });
    });

    it('모든 해상도가 매핑을 가진다', () => {
      for (const r of CANDLE_RESOLUTIONS) {
        expect(resolveCandleSource(r).relation).toBeTruthy();
      }
    });
  });

  describe('normalizeCandleQuery — 검증', () => {
    it('stockCode 6자리 숫자 아니면 오류', () => {
      expect(() => normalizeCandleQuery({ stockCode: '12345' })).toThrow(
        CandleQueryError,
      );
      expect(() => normalizeCandleQuery({ stockCode: 'ABCDEF' })).toThrow(
        CandleQueryError,
      );
      expect(() => normalizeCandleQuery({ stockCode: undefined })).toThrow(
        CandleQueryError,
      );
    });

    it('정상 stockCode 통과 + 기본 해상도 1m', () => {
      const q = normalizeCandleQuery({ stockCode: '005930' });
      expect(q.stockCode).toBe('005930');
      expect(q.resolution).toBe('1m');
      expect(q.source.relation).toBe('stock_minute_prices');
      expect(q.limit).toBe(DEFAULT_CANDLE_LIMIT);
    });

    it('알 수 없는 해상도는 오류', () => {
      expect(() =>
        normalizeCandleQuery({ stockCode: '005930', resolution: '3m' }),
      ).toThrow(CandleQueryError);
    });

    it('from > to 는 오류', () => {
      expect(() =>
        normalizeCandleQuery({
          stockCode: '005930',
          from: '20260620',
          to: '20260619',
        }),
      ).toThrow(CandleQueryError);
    });

    it('from == to 는 허용', () => {
      const q = normalizeCandleQuery({
        stockCode: '005930',
        from: '20260620',
        to: '20260620',
      });
      expect(q.fromMs).toBe(q.toMs);
    });

    it('from/to/before 형식 불량은 각각 오류', () => {
      expect(() =>
        normalizeCandleQuery({ stockCode: '005930', from: 'xxx' }),
      ).toThrow(/from/);
      expect(() =>
        normalizeCandleQuery({ stockCode: '005930', to: 'xxx' }),
      ).toThrow(/to/);
      expect(() =>
        normalizeCandleQuery({ stockCode: '005930', before: 'xxx' }),
      ).toThrow(/before/);
    });

    it('limit 클램프: 0→1, 초과→MAX, 미지정→기본, 소수→내림', () => {
      expect(normalizeCandleQuery({ stockCode: '005930', limit: 0 }).limit).toBe(
        1,
      );
      expect(
        normalizeCandleQuery({ stockCode: '005930', limit: 99999 }).limit,
      ).toBe(MAX_CANDLE_LIMIT);
      expect(
        normalizeCandleQuery({ stockCode: '005930', limit: '50.9' }).limit,
      ).toBe(50);
      expect(
        normalizeCandleQuery({ stockCode: '005930', limit: 'abc' }).limit,
      ).toBe(DEFAULT_CANDLE_LIMIT);
    });

    it('before(커서)를 epoch ms 로 정규화', () => {
      const q = normalizeCandleQuery({
        stockCode: '005930',
        before: '202606200930',
      });
      expect(q.beforeMs).toBe(Date.UTC(2026, 5, 20, 9, 30, 0));
    });
  });
});
