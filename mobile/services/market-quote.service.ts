import type { ApiResponse } from '@app-types/api.types';
import type {
  CandleSeriesResult,
  IndicatorSeriesResult,
  MinuteCandlesResult,
  StockQuoteMap,
} from '@app-types/market-quote.types';

import { api } from './api';

/** 일봉 조회 옵션 — limit 으로 최근 N 거래일을 받는다(구간 미지정=newest-first 다운샘플). */
export interface DailyCandlesOptions {
  /** 한 페이지 캔들 수(기본 서버 200, 최대 1000). 구간 프리셋이 최근 N 거래일로 환산. */
  limit?: number;
  /** 구간 시작(포함) — YYYYMMDD/ISO. 미지정 시 최근 limit 거래일. */
  from?: string;
  /** 구간 끝(포함). */
  to?: string;
}

/** 기술지표 조회 옵션(W13) — 일봉과 동일 규약(limit=최근 N 거래일, 구간 미지정=newest-first). */
export interface DailyIndicatorsOptions {
  /** 한 페이지 지표 행 수(기본 서버 200, 최대 1000). 일봉 구간 프리셋과 동일 limit 사용(조인 정합). */
  limit?: number;
  /** 구간 시작(포함) — YYYYMMDD/ISO. */
  from?: string;
  /** 구간 끝(포함). */
  to?: string;
}

/**
 * 종목 최신 시세 조회 서비스 (DAR-158, read-only). 게스트 열람 가능(OptionalJwtAuthGuard).
 * 다건 종목코드를 콤마구분으로 보내 단일 in 쿼리로 조회(N+1 회피). 데이터 없는 종목은 null.
 */
export const marketQuoteService = {
  /** 다건 종목 최신 시세. 빈 입력이면 네트워크 호출 없이 빈 맵. */
  getQuotes: (stockCodes: string[]): Promise<StockQuoteMap> => {
    const codes = stockCodes.filter((c) => /^\d{6}$/.test(c));
    if (codes.length === 0) return Promise.resolve({});
    return api
      .get<ApiResponse<StockQuoteMap>>('/market-data/quote', {
        params: { stockCodes: codes.join(',') },
      })
      .then((r) => r.data.data);
  },

  /**
   * 단일 종목 당일 분봉(인트라데이) 조회 (DAR-354, read-only). 백엔드 GET /market-data/minute-candles
   * (DAR-352) 와 1:1. 응답 MinuteCandlesResult: candles(시각 오름차순)+source+asOf(환경시계 괴리 고지용).
   * 6자리 코드가 아니면 네트워크 호출 없이 UNAVAILABLE 빈 결과. 미가용 시 candles 빈 배열 graceful.
   */
  getMinuteCandles: (stockCode: string): Promise<MinuteCandlesResult> => {
    if (!/^\d{6}$/.test(stockCode)) {
      return Promise.resolve({ stockCode, source: 'UNAVAILABLE', asOf: '', candles: [] });
    }
    return api
      .get<ApiResponse<MinuteCandlesResult>>('/market-data/minute-candles', {
        params: { stockCode },
      })
      .then((r) => r.data.data);
  },

  /**
   * 단일 종목 일봉(딥히스토리) 조회 (DAR-384, read-only). 백엔드 GET /market-data/candles?resolution=1d
   * 와 1:1 — 1d 의 캐노니컬 소스는 KRX 일봉(StockDailyPrice 백필, source=EOD). 구간 미지정 시 최근
   * limit 거래일(newest-first 다운샘플)을 받는다(환경 시계 비의존). 6자리 코드가 아니면 네트워크
   * 호출 없이 UNAVAILABLE 빈 결과. 미가용 시 candles 빈 배열 graceful.
   */
  getDailyCandles: (
    stockCode: string,
    options?: DailyCandlesOptions,
  ): Promise<CandleSeriesResult> => {
    if (!/^\d{6}$/.test(stockCode)) {
      return Promise.resolve({
        stockCode,
        resolution: '1d',
        source: 'UNAVAILABLE',
        asOf: '',
        count: 0,
        nextCursor: null,
        candles: [],
      });
    }
    return api
      .get<ApiResponse<CandleSeriesResult>>('/market-data/candles', {
        params: {
          stockCode,
          resolution: '1d',
          ...(options?.limit != null ? { limit: options.limit } : {}),
          ...(options?.from != null ? { from: options.from } : {}),
          ...(options?.to != null ? { to: options.to } : {}),
        },
      })
      .then((r) => r.data.data);
  },

  /**
   * 단일 종목 기술지표(EOD 파생) 구간 조회 (W13, read-only). 백엔드 GET /market-data/indicators
   * 와 1:1 — 일봉 캔들과 동일 파라미터 규약(limit=최근 N 거래일)이라 tradeDate 조인이 정합한다.
   * ★정직: latestTradeDate(지표 기준일)를 응답에 포함 — 화면이 T+1 stale 을 숨기지 않고 배지 고지.
   * 6자리 코드가 아니면 네트워크 호출 없이 UNAVAILABLE 빈 결과. 미가용 시 points 빈 배열 graceful.
   */
  getDailyIndicators: (
    stockCode: string,
    options?: DailyIndicatorsOptions,
  ): Promise<IndicatorSeriesResult> => {
    if (!/^\d{6}$/.test(stockCode)) {
      return Promise.resolve({
        stockCode,
        source: 'UNAVAILABLE',
        asOf: '',
        latestTradeDate: null,
        count: 0,
        nextCursor: null,
        points: [],
      });
    }
    return api
      .get<ApiResponse<IndicatorSeriesResult>>('/market-data/indicators', {
        params: {
          stockCode,
          ...(options?.limit != null ? { limit: options.limit } : {}),
          ...(options?.from != null ? { from: options.from } : {}),
          ...(options?.to != null ? { to: options.to } : {}),
        },
      })
      .then((r) => r.data.data);
  },
};
