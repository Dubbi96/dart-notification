import {
  CANDLE_RESOLUTIONS,
  CandleQueryError,
  DEFAULT_CANDLE_LIMIT,
  MAX_CANDLE_LIMIT,
  dateFromTradeDate,
  normalizeCandleQuery,
  parseInstantMs,
  resolveCandleSource,
  tradeDateFromMs,
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
    it('1m 은 원본 하이퍼테이블(분봉 kind)', () => {
      expect(resolveCandleSource('1m')).toEqual({
        relation: 'stock_minute_prices',
        timeColumn: 'ts',
        kind: 'minute',
      });
    });

    it('5m/15m 은 연속집계 뷰(bucket 컬럼·분봉 kind)', () => {
      expect(resolveCandleSource('5m')).toEqual({
        relation: 'stock_candles_5m',
        timeColumn: 'bucket',
        kind: 'minute',
      });
      expect(resolveCandleSource('15m')).toEqual({
        relation: 'stock_candles_15m',
        timeColumn: 'bucket',
        kind: 'minute',
      });
    });

    it('1d 은 KRX 일봉 stock_daily_prices(tradeDate·daily kind) — DAR-384 캐노니컬', () => {
      expect(resolveCandleSource('1d')).toEqual({
        relation: 'stock_daily_prices',
        timeColumn: 'tradeDate',
        kind: 'daily',
      });
    });

    it('모든 해상도가 매핑을 가진다', () => {
      for (const r of CANDLE_RESOLUTIONS) {
        expect(resolveCandleSource(r).relation).toBeTruthy();
      }
    });
  });

  describe('tradeDateFromMs / dateFromTradeDate — 일봉 거래일 환산(DAR-384)', () => {
    it('자정 UTC instant 를 같은 KST 거래일로 환산(=09:00 KST 같은 날)', () => {
      // 2026-06-20T00:00:00Z = 2026-06-20 09:00 KST → 20260620
      expect(tradeDateFromMs(Date.UTC(2026, 5, 20, 0, 0, 0))).toBe('20260620');
    });

    it('KST 자정 직전(UTC 14:59)은 같은 날, UTC 15:00(=KST 자정)은 다음 날', () => {
      expect(tradeDateFromMs(Date.UTC(2026, 5, 20, 14, 59, 0))).toBe('20260620');
      expect(tradeDateFromMs(Date.UTC(2026, 5, 20, 15, 0, 0))).toBe('20260621');
    });

    it('dateFromTradeDate 는 거래일 자정 UTC instant 를 만든다', () => {
      const d = dateFromTradeDate('20260620');
      expect(d?.toISOString()).toBe('2026-06-20T00:00:00.000Z');
    });

    it('자정 UTC time 을 커서로 되넘기면 같은 거래일로 라운드트립(페이지네이션 보존)', () => {
      const d = dateFromTradeDate('20100104'); // 백필 초기 거래일
      expect(d).not.toBeNull();
      expect(tradeDateFromMs(d!.getTime())).toBe('20100104');
    });

    it('형식 불량 거래일은 null', () => {
      expect(dateFromTradeDate('2026062')).toBeNull();
      expect(dateFromTradeDate('20261320')).toBeNull(); // 13월
      expect(dateFromTradeDate('20260640')).toBeNull(); // 40일
      expect(dateFromTradeDate('abcdefgh')).toBeNull();
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
