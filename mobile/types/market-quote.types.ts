/**
 * 종목 최신 시세(quote) 타입 — 백엔드 StockQuoteService 응답과 1:1 (DAR-158).
 * 가격 배지(현재가·전일대비%·5일 스파크라인) 종단연결용. 데이터 없는 종목은 null.
 */
export interface StockQuote {
  stockCode: string;
  corpCode: string | null;
  /** 최종가(원) — 실시간 우선, 폴백 최신 일봉 종가. */
  price: number;
  /** 직전 기준 종가(원). 없으면 null. */
  previousClose: number | null;
  /** 전일대비 절대 등락(원). 없으면 null. */
  change: number | null;
  /** 전일대비 등락률(%) 소수 2자리. 없으면 null. */
  changePercent: number | null;
  /** 가격 기준 일봉일(YYYYMMDD). */
  tradeDate: string | null;
  /** 가격 출처 — 'REALTIME'(KIS 신선) | 'DAILY'(일봉 종가). */
  source: 'REALTIME' | 'DAILY';
  /** 최근 종가 스파크라인(오래된→최신, 최대 5개). */
  sparkline: number[];
}

/** stockCode → StockQuote|null 맵. 조회 안 된 종목 키는 null. */
export type StockQuoteMap = Record<string, StockQuote | null>;

/**
 * 당일 분봉 1캔들 — 백엔드 KisMinuteCandle 와 1:1 (DAR-354). 인트라데이 시·고·저·종·거래량.
 * 시각은 체결시각 HHMMSS 문자열. 데이터 없으면 빈 배열.
 */
export interface MinuteCandle {
  /** 체결시각 HHMMSS (예: '093000'). */
  time: string;
  /** 해당 분 시가(원). */
  open: number;
  /** 해당 분 고가(원). */
  high: number;
  /** 해당 분 저가(원). */
  low: number;
  /** 해당 분 종가(체결가, 원). */
  close: number;
  /** 해당 분 거래량(주). */
  volume: number;
}

/**
 * 분봉 조회 응답 — 백엔드 MinuteCandlesResult 와 1:1 (DAR-352/354).
 * ★정직(DAR-140 계약): KIS_REALTIME 은 '실제 시장 실시간가'. 캔들 time(HHMMSS)은 시장 시각이라
 * 환경 시계(2026)와 괴리될 수 있어 asOf(서버 조회 ISO 시각)와 함께 고지한다. UNAVAILABLE 이면 빈 배열.
 */
export interface MinuteCandlesResult {
  /** 조회한 6자리 종목코드. */
  stockCode: string;
  /** 캔들 출처 — 'KIS_REALTIME'(실데이터) | 'UNAVAILABLE'(키 미설정·장마감·실패로 0행). */
  source: 'KIS_REALTIME' | 'UNAVAILABLE';
  /** 서버가 KIS 를 조회한 시각(ISO). 미가용/미조회 시 빈 문자열. */
  asOf: string;
  /** 당일 분봉(시간 오름차순). 미가용 시 빈 배열. */
  candles: MinuteCandle[];
}

/**
 * 구간 캔들 1점 — 백엔드 CandlePoint 와 1:1 (DAR-378/384). 일봉(1d)에선 time 이 거래일 자정 UTC.
 * 분봉(HHMMSS)과 달리 time 은 ISO 8601(UTC instant)이라 날짜·시각 모두 표현한다.
 */
export interface CandleSeriesPoint {
  /** 버킷 시각(ISO 8601, UTC). 일봉이면 거래일 자정 UTC(=09:00 KST 같은 날). */
  time: string;
  open: number;
  high: number;
  low: number;
  close: number;
  /** 거래량(주). */
  volume: number;
}

/**
 * 구간 캔들 조회 응답 — 백엔드 CandleSeriesResult 와 1:1 (DAR-384, GET /market-data/candles).
 * ★일봉(1d)의 캐노니컬 소스는 KRX 일봉(StockDailyPrice 딥히스토리, source=EOD). ★정직: source/asOf
 * 로 출처·조회시각 고지(환경 시계 괴리 가능). UNAVAILABLE(미백필/조회불가)이면 빈 배열 graceful.
 */
export interface CandleSeriesResult {
  /** 조회한 6자리 종목코드. */
  stockCode: string;
  /** 해상도 — 일봉 훅은 '1d'. */
  resolution: '1m' | '5m' | '15m' | '1d';
  /** 캔들 출처 — 'EOD'(KRX 일봉) | 'TIMESCALE'(분봉 집계) | 'UNAVAILABLE'(미백필/조회불가 0행). */
  source: 'EOD' | 'TIMESCALE' | 'UNAVAILABLE';
  /** 서버 조회 시각(ISO). 미가용/미조회 시 빈 문자열. */
  asOf: string;
  /** 반환 캔들 수. */
  count: number;
  /** 다음(과거) 페이지 커서(가장 오래된 버킷 ISO). 더 없으면 null. */
  nextCursor: string | null;
  /** 시간 오름차순 캔들. 미가용 시 빈 배열. */
  candles: CandleSeriesPoint[];
}
