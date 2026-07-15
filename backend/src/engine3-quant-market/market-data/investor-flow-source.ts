/**
 * 수급(투자자별 매매동향)·공매도 소스 어댑터 포트 (갭분석 W16) — 포트/어댑터 분리.
 *
 * 어디서 받는지(KRX 오픈API / KIS)를 인터페이스로 추상화한다. 수집기는 이 인터페이스에만
 * 의존하고, 구독·상품 가용 상태에 따라 구현체를 갈아끼운다(etf-daily-source.ts 패턴).
 *
 * **소스 결정(2026-07-16 실검증 — scripts/live-investor-flow-smoke.ts)**:
 *   - KRX 오픈API 는 투자자별 거래실적·공매도 상품이 카탈로그에 없음(후보 슬러그 전부 HTTP 404,
 *     대조군 sto/stk_bydd_trd 는 200 — 키 자체는 정상). ⇒ KRX 어댑터는 인터페이스만(미가용).
 *   - KIS inquire-investor(FHKST01010900) 200 · 30행(최근 ~30영업일), daily-short-sale
 *     (FHPST04830000) 200 · 일별 행. ⇒ 1차 소스 = KIS.
 *   - 공매도 '잔고'(shortBalanceQty/Ratio)는 무료 소스 미가용 → null 저장(정직 — 합성 금지).
 *
 * ★SHADOW 불가침: 이 데이터는 조회·표면 계층 전용. Buy Score·트레이딩 경로에 입력하지 않는다
 *   (가중치 0 이 아니라 점수화 자체를 하지 않음 — M10 모의운용 무오염).
 */

import { nextTradingDay } from '../../common/time/market-calendar';

/** 투자자별 매매동향 1행(소스 중립). 금액은 원 단위(어댑터가 단위 환산 책임). */
export interface InvestorFlowBar {
  tradeDate: string; // 거래일 YYYYMMDD
  foreignNetBuyQty: number; // 외국인 순매수 수량(주, 음수=순매도)
  foreignNetBuyAmount: number; // 외국인 순매수 금액(원)
  institutionNetBuyQty: number; // 기관 순매수 수량(주)
  institutionNetBuyAmount: number; // 기관 순매수 금액(원)
  individualNetBuyQty: number; // 개인 순매수 수량(주)
  individualNetBuyAmount: number; // 개인 순매수 금액(원)
}

/** 공매도 일별 1행(소스 중립). 잔고 필드는 소스 미가용 시 null(합성 금지). */
export interface ShortSellingBar {
  tradeDate: string; // 거래 기준일 YYYYMMDD
  shortSellingVolume: number; // 공매도 거래량(주)
  shortSellingAmount: number | null; // 공매도 거래대금(원)
  shortBalanceQty: number | null; // 공매도 잔고 수량 — 현 무료 소스 미가용(null)
  shortBalanceRatio: number | null; // 공매도 잔고 비율(%) — 현 무료 소스 미가용(null)
}

/** 소스 조회 옵션 — [startYmd, endYmd] 구간(YYYYMMDD). */
export interface InvestorFlowFetchOptions {
  startYmd: string;
  endYmd: string;
  /** 현재 epoch ms(테스트 주입 가능). */
  nowMs?: number;
}

/**
 * 수급·공매도 소스 어댑터 포트. 구현체(KIS/KRX)는 sourceName 으로 자신을 식별하고
 * (InvestorFlowDaily.source / ShortSellingDaily.source 컬럼 기록), 구간 행을 거래일 오름차순으로
 * 반환한다.
 * ★graceful: 키 미설정 등 '비활성'은 isAvailable()=false 로 수집기가 스킵/폴백 판단,
 *   그 외 실패는 [] 로 정직 표면화(etf-daily-source 규약과 동일).
 */
export interface InvestorFlowSource {
  /** 소스 식별자 — 'KRX' | 'KIS'. */
  readonly sourceName: string;
  /** 소스가 실제 조회 가능한지(키/구독/상품 상태). false 면 수집기가 다음 소스로 폴백. */
  isAvailable(): boolean;
  /** 종목별 투자자 매매동향(거래일 오름차순). */
  fetchInvestorFlow(stockCode: string, opts: InvestorFlowFetchOptions): Promise<InvestorFlowBar[]>;
  /** 종목별 공매도 일별추이(거래일 오름차순). */
  fetchShortSelling(stockCode: string, opts: InvestorFlowFetchOptions): Promise<ShortSellingBar[]>;
}

/**
 * 공매도 잔고 공표일 계산 — tradeDate 의 T+2 영업일(lookahead 불가침, W16 스펙).
 *
 * 공매도 잔고는 KRX 가 거래일(T) 기준 T+2 영업일에 공표한다. 백테스트/as-of 조회가 거래일
 * 기준으로 이 행을 읽으면 미래참조(lookahead)가 되므로, publishedDate 를 행에 분리 저장하고
 * as-of 조회는 publishedDate ≤ 기준일 조건을 강제한다(StockStatusDaily point-in-time 원칙).
 *
 * ★거래(볼륨) 축은 실제로는 T+1 게시지만, 행 단위 publishedDate 하나로 보수적으로 T+2 를
 *   기록한다 — 늦게 잡는 방향은 lookahead 안전(이르게 잡는 방향만 위험).
 *
 * @param tradeDate 거래 기준일 YYYYMMDD
 * @returns 공표일 YYYYMMDD (T+2 영업일 — 주말·KRX 휴장일 건너뜀)
 */
export function computeShortBalancePublishedDate(tradeDate: string): string {
  return nextTradingDay(nextTradingDay(tradeDate));
}
