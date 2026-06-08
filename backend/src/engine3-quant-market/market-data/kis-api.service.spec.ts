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
});
