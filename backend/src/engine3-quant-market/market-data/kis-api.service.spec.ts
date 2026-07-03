/**
 * kis-api.service.spec.ts — KIS OpenAPI 어댑터 (DAR-140, 실제 키/네트워크 호출 없음)
 *
 * 검증: 키 미설정 graceful, OAuth 토큰 발급·캐시 재사용, 현재가/분봉 파싱, 에러 graceful.
 *   axios 는 모킹 — 실 호출 0.
 */

jest.mock('axios');
jest.mock('axios-retry');

import axios from 'axios';
import { ConfigService } from '@nestjs/config';
import { KisApiService, KisApiUnavailableError } from './kis-api.service';

const mockClient = { get: jest.fn(), post: jest.fn() };
(axios.create as jest.Mock).mockReturnValue(mockClient);

function makeConfig(env: Record<string, string | undefined>): ConfigService {
  return { get: (k: string) => env[k] } as unknown as ConfigService;
}

const KEYS = { KIS_APP_KEY: 'ak', KIS_APP_SECRET: 'sk' };

describe('KisApiService (DAR-140)', () => {
  beforeEach(() => {
    mockClient.get.mockReset();
    mockClient.post.mockReset();
  });

  describe('isConfigured / graceful', () => {
    it('키 미설정이면 isConfigured=false', () => {
      const svc = new KisApiService(makeConfig({}));
      expect(svc.isConfigured).toBe(false);
    });
    it('키 설정이면 isConfigured=true', () => {
      const svc = new KisApiService(makeConfig(KEYS));
      expect(svc.isConfigured).toBe(true);
    });
    it('키 미설정 시 getAccessToken 은 KisApiUnavailableError', async () => {
      const svc = new KisApiService(makeConfig({}));
      await expect(svc.getAccessToken(0)).rejects.toBeInstanceOf(KisApiUnavailableError);
      expect(mockClient.post).not.toHaveBeenCalled();
    });
  });

  describe('getAccessToken — 발급·캐시', () => {
    it('client_credentials 로 토큰 발급', async () => {
      mockClient.post.mockResolvedValue({ data: { access_token: 'tok1', expires_in: 86400 } });
      const svc = new KisApiService(makeConfig(KEYS));
      const tok = await svc.getAccessToken(1000);
      expect(tok).toBe('tok1');
      expect(mockClient.post).toHaveBeenCalledTimes(1);
      expect(mockClient.post.mock.calls[0][0]).toContain('/oauth2/tokenP');
      expect(mockClient.post.mock.calls[0][1]).toMatchObject({
        grant_type: 'client_credentials', appkey: 'ak', appsecret: 'sk',
      });
    });

    it('만료 전 재호출은 캐시 재사용(추가 발급 없음)', async () => {
      mockClient.post.mockResolvedValue({ data: { access_token: 'tok1', expires_in: 86400 } });
      const svc = new KisApiService(makeConfig(KEYS));
      await svc.getAccessToken(1000);
      const tok2 = await svc.getAccessToken(1000 + 60_000); // 1분 후, 만료 한참 전
      expect(tok2).toBe('tok1');
      expect(mockClient.post).toHaveBeenCalledTimes(1);
    });

    it('만료 후에는 재발급', async () => {
      mockClient.post
        .mockResolvedValueOnce({ data: { access_token: 'tokA', expires_in: 120 } })
        .mockResolvedValueOnce({ data: { access_token: 'tokB', expires_in: 120 } });
      const svc = new KisApiService(makeConfig(KEYS));
      const a = await svc.getAccessToken(0);
      const b = await svc.getAccessToken(200_000); // 만료(120-60=60초 캐시) 이후
      expect(a).toBe('tokA');
      expect(b).toBe('tokB');
      expect(mockClient.post).toHaveBeenCalledTimes(2);
    });

    it('access_token 결측 응답은 KisApiUnavailableError', async () => {
      mockClient.post.mockResolvedValue({ data: {} });
      const svc = new KisApiService(makeConfig(KEYS));
      await expect(svc.getAccessToken(0)).rejects.toBeInstanceOf(KisApiUnavailableError);
    });
  });

  describe('fetchCurrentPrice — 현재가 파싱', () => {
    it('output.stck_prpr 등을 정수로 파싱', async () => {
      mockClient.post.mockResolvedValue({ data: { access_token: 'tok', expires_in: 86400 } });
      mockClient.get.mockResolvedValue({
        data: { output: { stck_prpr: '23,500', stck_oprc: '23000', stck_hgpr: '24000', stck_lwpr: '22500', acml_vol: '1234567' } },
      });
      const svc = new KisApiService(makeConfig(KEYS));
      const q = await svc.fetchCurrentPrice('005930', 0);
      expect(q).toEqual({ stockCode: '005930', price: 23500, open: 23000, high: 24000, low: 22500, volume: 1234567 });
      // tr_id 헤더 확인
      expect(mockClient.get.mock.calls[0][1].headers.tr_id).toBe('FHKST01010100');
    });

    it('output 결측이면 null', async () => {
      mockClient.post.mockResolvedValue({ data: { access_token: 'tok', expires_in: 86400 } });
      mockClient.get.mockResolvedValue({ data: {} });
      const svc = new KisApiService(makeConfig(KEYS));
      expect(await svc.fetchCurrentPrice('005930', 0)).toBeNull();
    });

    it('네트워크 에러는 graceful null', async () => {
      mockClient.post.mockResolvedValue({ data: { access_token: 'tok', expires_in: 86400 } });
      mockClient.get.mockRejectedValue(new Error('boom'));
      const svc = new KisApiService(makeConfig(KEYS));
      expect(await svc.fetchCurrentPrice('005930', 0)).toBeNull();
    });
  });

  describe('fetchMinuteCandles — 분봉 파싱(최신→오름차순)', () => {
    it('output2 를 시간 오름차순으로 반환', async () => {
      mockClient.post.mockResolvedValue({ data: { access_token: 'tok', expires_in: 86400 } });
      mockClient.get.mockResolvedValue({
        data: {
          output2: [
            { stck_cntg_hour: '093000', stck_oprc: '100', stck_hgpr: '110', stck_lwpr: '95', stck_prpr: '105', cntg_vol: '10' },
            { stck_cntg_hour: '092900', stck_oprc: '99', stck_hgpr: '101', stck_lwpr: '98', stck_prpr: '100', cntg_vol: '8' },
          ],
        },
      });
      const svc = new KisApiService(makeConfig(KEYS));
      const candles = await svc.fetchMinuteCandles('005930', '', 0);
      expect(candles.map((c) => c.time)).toEqual(['092900', '093000']); // 오름차순
      expect(candles[1]).toEqual({ time: '093000', open: 100, high: 110, low: 95, close: 105, volume: 10 });
      expect(mockClient.get.mock.calls[0][1].headers.tr_id).toBe('FHKST03010200');
    });

    it('에러는 graceful 빈 배열', async () => {
      mockClient.post.mockResolvedValue({ data: { access_token: 'tok', expires_in: 86400 } });
      mockClient.get.mockRejectedValue(new Error('boom'));
      const svc = new KisApiService(makeConfig(KEYS));
      expect(await svc.fetchMinuteCandles('005930', '', 0)).toEqual([]);
    });
  });

  describe('fetchMinuteCandlesFullDay — 당일 전 구간 페이지네이션 (DAR-377)', () => {
    const noSleep = (_ms: number) => Promise.resolve();
    const page = (rowsNewestFirst: Array<[string, number]>) => ({
      data: {
        output2: rowsNewestFirst.map(([t, v]) => ({
          stck_cntg_hour: t,
          stck_oprc: String(v),
          stck_hgpr: String(v),
          stck_lwpr: String(v),
          stck_prpr: String(v),
          cntg_vol: '1',
        })),
      },
    });

    it('가장 이른 시각을 앵커로 과거를 페이지네이션·중복제거·오름차순 반환', async () => {
      mockClient.post.mockResolvedValue({ data: { access_token: 'tok', expires_in: 86400 } });
      mockClient.get
        // page1(anchor ''): 최신부터 093000,092900 → 오름차순 [092900,093000]
        .mockResolvedValueOnce(page([['093000', 105], ['092900', 100]]))
        // page2(anchor 092900): 090100,090000 → earliest 090000 ≤ 0900 → 종료
        .mockResolvedValueOnce(page([['090100', 91], ['090000', 90]]));
      const svc = new KisApiService(makeConfig(KEYS));

      const candles = await svc.fetchMinuteCandlesFullDay('005930', { sleep: noSleep, nowMs: 0 });

      expect(candles.map((c) => c.time)).toEqual(['090000', '090100', '092900', '093000']);
      expect(mockClient.get).toHaveBeenCalledTimes(2);
      // 두 번째 페이지 앵커가 page1 의 가장 이른 시각(092900)인지 확인.
      expect(mockClient.get.mock.calls[1][1].params.FID_INPUT_HOUR_1).toBe('092900');
    });

    it('빈 페이지를 만나면 즉시 종료(그때까지 수집분 반환)', async () => {
      mockClient.post.mockResolvedValue({ data: { access_token: 'tok', expires_in: 86400 } });
      mockClient.get
        .mockResolvedValueOnce(page([['093000', 105], ['092900', 100]]))
        .mockResolvedValueOnce(page([])); // 빈 페이지 → 종료
      const svc = new KisApiService(makeConfig(KEYS));

      const candles = await svc.fetchMinuteCandlesFullDay('005930', { sleep: noSleep, nowMs: 0 });

      expect(candles.map((c) => c.time)).toEqual(['092900', '093000']);
      expect(mockClient.get).toHaveBeenCalledTimes(2);
    });

    it('진전 없음(같은 earliest 반복)이면 무한루프 없이 종료', async () => {
      mockClient.post.mockResolvedValue({ data: { access_token: 'tok', expires_in: 86400 } });
      mockClient.get.mockResolvedValue(page([['093000', 105], ['092900', 100]])); // 매번 동일
      const svc = new KisApiService(makeConfig(KEYS));

      const candles = await svc.fetchMinuteCandlesFullDay('005930', { sleep: noSleep, nowMs: 0 });

      expect(candles.map((c) => c.time)).toEqual(['092900', '093000']);
      expect(mockClient.get).toHaveBeenCalledTimes(2); // page1 + page2(진전없음 감지) → 종료
    });
  });

  describe('fetchIndexPrice — 업종지수 현재값 (DAR-371)', () => {
    it('상승 케이스: 소수 2자리 보존·전일대비 부호 적용·등락률 자체산출', async () => {
      mockClient.post.mockResolvedValue({ data: { access_token: 'tok', expires_in: 86400 } });
      mockClient.get.mockResolvedValue({
        data: {
          output: {
            bstp_nmix_prpr: '9,033.15',
            bstp_nmix_prdy_vrss: '31.05',
            prdy_vrss_sign: '2', // 상승
            bstp_nmix_oprc: '9,288.89',
            bstp_nmix_hgpr: '9,385.59',
            bstp_nmix_lwpr: '8,875.33',
          },
        },
      });
      const svc = new KisApiService(makeConfig(KEYS));
      const q = await svc.fetchIndexPrice('0001', 0);
      expect(q).not.toBeNull();
      expect(q!.indexCode).toBe('0001');
      expect(q!.price).toBe(9033.15); // 정수 반올림 없이 소수 보존
      expect(q!.change).toBe(31.05);
      expect(q!.prevClose).toBe(9002.1); // price − change
      expect(q!.changePercent).toBe(0.34); // 31.05/9002.1*100 ≈ 0.34
      expect(q!.open).toBe(9288.89);
      expect(q!.high).toBe(9385.59);
      expect(q!.low).toBe(8875.33);
      // 지수 tr_id·업종(U) 마켓 구분 확인
      expect(mockClient.get.mock.calls[0][1].headers.tr_id).toBe('FHPUP02100000');
      expect(mockClient.get.mock.calls[0][1].params).toMatchObject({
        FID_COND_MRKT_DIV_CODE: 'U',
        FID_INPUT_ISCD: '0001',
      });
    });

    it('하락 케이스: prdy_vrss_sign=5 → 음수 등락', async () => {
      mockClient.post.mockResolvedValue({ data: { access_token: 'tok', expires_in: 86400 } });
      mockClient.get.mockResolvedValue({
        data: {
          output: {
            bstp_nmix_prpr: '792.00',
            bstp_nmix_prdy_vrss: '8.00',
            prdy_vrss_sign: '5', // 하락
            bstp_nmix_oprc: '800',
            bstp_nmix_hgpr: '801',
            bstp_nmix_lwpr: '790',
          },
        },
      });
      const svc = new KisApiService(makeConfig(KEYS));
      const q = await svc.fetchIndexPrice('1001', 0);
      expect(q!.change).toBe(-8);
      expect(q!.prevClose).toBe(800);
      expect(q!.changePercent).toBe(-1); // -8/800*100
    });

    it('output 결측이면 null', async () => {
      mockClient.post.mockResolvedValue({ data: { access_token: 'tok', expires_in: 86400 } });
      mockClient.get.mockResolvedValue({ data: {} });
      const svc = new KisApiService(makeConfig(KEYS));
      expect(await svc.fetchIndexPrice('0001', 0)).toBeNull();
    });

    it('현재 지수 0/음수면 null(이상 응답 방어)', async () => {
      mockClient.post.mockResolvedValue({ data: { access_token: 'tok', expires_in: 86400 } });
      mockClient.get.mockResolvedValue({ data: { output: { bstp_nmix_prpr: '0' } } });
      const svc = new KisApiService(makeConfig(KEYS));
      expect(await svc.fetchIndexPrice('0001', 0)).toBeNull();
    });

    it('네트워크 에러는 graceful null', async () => {
      mockClient.post.mockResolvedValue({ data: { access_token: 'tok', expires_in: 86400 } });
      mockClient.get.mockRejectedValue(new Error('boom'));
      const svc = new KisApiService(makeConfig(KEYS));
      expect(await svc.fetchIndexPrice('0001', 0)).toBeNull();
    });

    it('키 미설정이면 KisApiUnavailableError throw(소비측이 폴백 전환)', async () => {
      const svc = new KisApiService(makeConfig({}));
      await expect(svc.fetchIndexPrice('0001', 0)).rejects.toBeInstanceOf(KisApiUnavailableError);
    });
  });

  describe('fetchDailyPrices — 기간별 일봉 파싱(ETF 공용, DAR-484)', () => {
    it('output2(최신→과거)를 거래일 오름차순으로 파싱', async () => {
      mockClient.post.mockResolvedValue({ data: { access_token: 'tok', expires_in: 86400 } });
      mockClient.get.mockResolvedValue({
        data: {
          output2: [
            // KIS 는 최신→과거 순으로 준다.
            { stck_bsop_date: '20260703', stck_oprc: '10,000', stck_hgpr: '10200', stck_lwpr: '9900', stck_clpr: '10100', acml_vol: '123456', acml_tr_pbmn: '1250000000' },
            { stck_bsop_date: '20260702', stck_oprc: '9800', stck_hgpr: '9950', stck_lwpr: '9750', stck_clpr: '9900', acml_vol: '111222', acml_tr_pbmn: '1100000000' },
          ],
        },
      });
      const svc = new KisApiService(makeConfig(KEYS));
      const bars = await svc.fetchDailyPrices('069500', '20260624', '20260703', 0);
      expect(bars.map((b) => b.tradeDate)).toEqual(['20260702', '20260703']);
      expect(bars[1]).toEqual({
        tradeDate: '20260703',
        open: 10000,
        high: 10200,
        low: 9900,
        close: 10100,
        volume: 123456,
        tradingValue: 1250000000,
      });
    });

    it('올바른 엔드포인트·파라미터(FID_PERIOD_DIV_CODE=D, 시장코드 J)로 호출', async () => {
      mockClient.post.mockResolvedValue({ data: { access_token: 'tok', expires_in: 86400 } });
      mockClient.get.mockResolvedValue({ data: { output2: [] } });
      const svc = new KisApiService(makeConfig(KEYS));
      await svc.fetchDailyPrices('360750', '20260101', '20260103', 0);
      const [url, cfg] = mockClient.get.mock.calls[0];
      expect(url).toContain('/quotations/inquire-daily-itemchartprice');
      expect(cfg.params).toMatchObject({
        FID_COND_MRKT_DIV_CODE: 'J',
        FID_INPUT_ISCD: '360750',
        FID_INPUT_DATE_1: '20260101',
        FID_INPUT_DATE_2: '20260103',
        FID_PERIOD_DIV_CODE: 'D',
      });
    });

    it('output2 결측/빈배열이면 [] (graceful)', async () => {
      mockClient.post.mockResolvedValue({ data: { access_token: 'tok', expires_in: 86400 } });
      mockClient.get.mockResolvedValue({ data: {} });
      const svc = new KisApiService(makeConfig(KEYS));
      expect(await svc.fetchDailyPrices('069500', '20260624', '20260703', 0)).toEqual([]);
    });

    it('네트워크 에러는 graceful [] (소실 정직 로깅)', async () => {
      mockClient.post.mockResolvedValue({ data: { access_token: 'tok', expires_in: 86400 } });
      mockClient.get.mockRejectedValue(new Error('boom'));
      const svc = new KisApiService(makeConfig(KEYS));
      expect(await svc.fetchDailyPrices('069500', '20260624', '20260703', 0)).toEqual([]);
    });

    it('키 미설정이면 KisApiUnavailableError throw', async () => {
      const svc = new KisApiService(makeConfig({}));
      await expect(
        svc.fetchDailyPrices('069500', '20260624', '20260703', 0),
      ).rejects.toBeInstanceOf(KisApiUnavailableError);
    });
  });

  describe('fetchDailyPricesRaw — 정규화 바 + KIS 원본 응답 동시 반환 (DAR-490)', () => {
    it('bars 는 fetchDailyPrices 와 동일, raw 는 axios 응답 본문(data) 그대로', async () => {
      const body = {
        rt_cd: '0',
        output2: [
          { stck_bsop_date: '20260703', stck_oprc: '10000', stck_hgpr: '10200', stck_lwpr: '9900', stck_clpr: '10100', acml_vol: '123456', acml_tr_pbmn: '1250000000' },
          { stck_bsop_date: '20260702', stck_oprc: '9800', stck_hgpr: '9950', stck_lwpr: '9750', stck_clpr: '9900', acml_vol: '111222', acml_tr_pbmn: '1100000000' },
        ],
      };
      mockClient.post.mockResolvedValue({ data: { access_token: 'tok', expires_in: 86400 } });
      mockClient.get.mockResolvedValue({ data: body });
      const svc = new KisApiService(makeConfig(KEYS));

      const { bars, raw } = await svc.fetchDailyPricesRaw('069500', '20260624', '20260703', 0);
      expect(bars.map((b) => b.tradeDate)).toEqual(['20260702', '20260703']); // 오름차순
      expect(raw).toBe(body); // 원본 그대로(가공 없음) — S3 보관용
    });

    it('네트워크 에러는 graceful { bars: [], raw: null }', async () => {
      mockClient.post.mockResolvedValue({ data: { access_token: 'tok', expires_in: 86400 } });
      mockClient.get.mockRejectedValue(new Error('boom'));
      const svc = new KisApiService(makeConfig(KEYS));

      expect(await svc.fetchDailyPricesRaw('069500', '20260624', '20260703', 0)).toEqual({
        bars: [],
        raw: null,
      });
    });

    it('키 미설정이면 KisApiUnavailableError throw', async () => {
      const svc = new KisApiService(makeConfig({}));
      await expect(
        svc.fetchDailyPricesRaw('069500', '20260624', '20260703', 0),
      ).rejects.toBeInstanceOf(KisApiUnavailableError);
    });
  });
});
