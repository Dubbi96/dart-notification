import {
  DEFAULT_INDICATOR_LIMIT,
  IndicatorQueryError,
  MAX_INDICATOR_LIMIT,
  normalizeIndicatorQuery,
} from './indicator-query';

/**
 * W13: GET /market-data/indicators 파라미터 검증·기간 제한 — 순수 정규화 단위 테스트.
 * candles(candle-query)와 동일 규약: stockCode 6자리, from/to/before ISO·YYYYMMDD,
 * from>to 거부, limit 기본 200·상한 1000(모바일 대량 전송 방지).
 */
describe('normalizeIndicatorQuery (W13)', () => {
  describe('stockCode 검증', () => {
    it('6자리 숫자면 통과한다', () => {
      const q = normalizeIndicatorQuery({ stockCode: '005930' });
      expect(q.stockCode).toBe('005930');
    });

    it('앞뒤 공백은 trim 후 통과한다', () => {
      expect(normalizeIndicatorQuery({ stockCode: ' 005930 ' }).stockCode).toBe(
        '005930',
      );
    });

    it.each([
      ['미지정', undefined],
      ['빈 문자열', ''],
      ['6자리 미만', '5930'],
      ['7자리', '0059300'],
      ['영문 포함', '00593A'],
    ])('%s 이면 IndicatorQueryError', (_label, stockCode) => {
      expect(() => normalizeIndicatorQuery({ stockCode })).toThrow(
        IndicatorQueryError,
      );
    });
  });

  describe('from/to 구간(기간 제한)', () => {
    it('YYYYMMDD compact 는 KST 거래일로 그대로 환산된다(라운드트립)', () => {
      const q = normalizeIndicatorQuery({
        stockCode: '005930',
        from: '20260101',
        to: '20260630',
      });
      expect(q.fromTradeDate).toBe('20260101');
      expect(q.toTradeDate).toBe('20260630');
    });

    it('ISO instant 는 KST 거래일(YYYYMMDD)로 환산된다', () => {
      // 2026-06-30T16:00:00Z = 2026-07-01 01:00 KST → 거래일 20260701
      const q = normalizeIndicatorQuery({
        stockCode: '005930',
        to: '2026-06-30T16:00:00Z',
      });
      expect(q.toTradeDate).toBe('20260701');
    });

    it('from 이 to 보다 이후면 IndicatorQueryError', () => {
      expect(() =>
        normalizeIndicatorQuery({
          stockCode: '005930',
          from: '20260630',
          to: '20260101',
        }),
      ).toThrow(IndicatorQueryError);
    });

    it('from/to 형식 불량이면 IndicatorQueryError', () => {
      expect(() =>
        normalizeIndicatorQuery({ stockCode: '005930', from: 'not-a-date' }),
      ).toThrow(IndicatorQueryError);
      expect(() =>
        normalizeIndicatorQuery({ stockCode: '005930', to: '2026-13-99' }),
      ).toThrow(IndicatorQueryError);
    });

    it('미지정 구간은 undefined(전 구간 newest-first limit)', () => {
      const q = normalizeIndicatorQuery({ stockCode: '005930' });
      expect(q.fromTradeDate).toBeUndefined();
      expect(q.toTradeDate).toBeUndefined();
      expect(q.beforeTradeDate).toBeUndefined();
    });
  });

  describe('before 커서', () => {
    it('ISO 커서(일봉 캔들 time 자정 UTC)는 같은 거래일로 환산된다(커서 라운드트립)', () => {
      // 20260615 자정 UTC = 09:00 KST 같은 날 → beforeTradeDate 20260615(미만 페이지네이션 정합)
      const q = normalizeIndicatorQuery({
        stockCode: '005930',
        before: '2026-06-15T00:00:00.000Z',
      });
      expect(q.beforeTradeDate).toBe('20260615');
    });

    it('형식 불량 커서는 IndicatorQueryError', () => {
      expect(() =>
        normalizeIndicatorQuery({ stockCode: '005930', before: 'cursor??' }),
      ).toThrow(IndicatorQueryError);
    });
  });

  describe('limit 클램프(대량 전송 방지)', () => {
    it('미지정이면 기본 200', () => {
      expect(normalizeIndicatorQuery({ stockCode: '005930' }).limit).toBe(
        DEFAULT_INDICATOR_LIMIT,
      );
    });

    it('상한 1000 을 넘으면 1000 으로 클램프', () => {
      expect(
        normalizeIndicatorQuery({ stockCode: '005930', limit: '99999' }).limit,
      ).toBe(MAX_INDICATOR_LIMIT);
    });

    it('1 미만이면 1 로 클램프', () => {
      expect(
        normalizeIndicatorQuery({ stockCode: '005930', limit: '0' }).limit,
      ).toBe(1);
      expect(
        normalizeIndicatorQuery({ stockCode: '005930', limit: -5 }).limit,
      ).toBe(1);
    });

    it('비숫자면 기본 200(500 금지)', () => {
      expect(
        normalizeIndicatorQuery({ stockCode: '005930', limit: 'abc' }).limit,
      ).toBe(DEFAULT_INDICATOR_LIMIT);
    });

    it('소수는 내림 처리', () => {
      expect(
        normalizeIndicatorQuery({ stockCode: '005930', limit: '66.9' }).limit,
      ).toBe(66);
    });
  });
});
