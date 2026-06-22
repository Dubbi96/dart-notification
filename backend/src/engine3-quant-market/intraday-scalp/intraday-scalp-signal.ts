// Engine3 — 분봉 단타(intraday scalping) 진입 신호 (순수 Rule, DAR-411)
//
// AI 금지영역 불가침: 진입 판정은 분봉 데이터 기반 순수 수식. AI/LLM 개입 0.
// 이 모듈은 "신호 정의"만 소유한다(engine3 = 시세·지표 도메인). 모의 체결·리스크·
// 영속은 engine5 가 독립 강제한다. 순수 함수라 fixture 로 결정론적 검증 가능.
//
// 진입 3조건 AND(이슈 DAR-411 설계):
//   1) 거래량 폭발: 현재 분 거래량 ≥ 직전 N분 평균 거래량 × volumeMultiple(기본 2.5)
//   2) 돌파: 현재가(분봉 종가) > 직전 M분 고가
//   3) 추세 확인: 현재가 > 당일 VWAP

/** 분봉 1개(VWAP·돌파·거래량 계산 입력). 가격은 원(KRW), ts 는 KST 벽시계 분 시각. */
export interface ScalpCandle {
  ts: Date;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

/** 진입 판정 파라미터(상수화 — 이슈 요구: N 상수화). */
export interface ScalpEntryParams {
  /** 거래량 폭발 배수 (현재 분 거래량 / 직전 평균). 기본 2.5 */
  volumeMultiple: number;
  /** 직전 평균 거래량 산출 구간(분). 기본 20 */
  volumeAvgLookbackMin: number;
  /** 돌파 기준 고가 산출 구간(분). 기본 15 */
  breakoutLookbackMin: number;
}

export const DEFAULT_SCALP_ENTRY_PARAMS: ScalpEntryParams = {
  volumeMultiple: 2.5,
  volumeAvgLookbackMin: 20,
  breakoutLookbackMin: 15,
};

/** 진입 사유 태그(영속·표면화 SSOT). */
export const SCALP_ENTRY_TAG = 'VOLUME_BREAKOUT_VWAP';

export interface ScalpEntryDecision {
  /** 3조건 AND 충족 여부 */
  triggered: boolean;
  reasons: {
    volumeExplosion: boolean;
    breakout: boolean;
    aboveVwap: boolean;
  };
  /** 현재 분봉 종가(체결 기준가). 데이터 없으면 null */
  currentPrice: number | null;
  /** 당일 VWAP. 거래량 0이면 null */
  vwap: number | null;
  /** 직전 N분 평균 거래량 */
  avgVolume: number | null;
  /** 현재 분 거래량 / 평균 거래량 */
  volumeRatio: number | null;
  /** 직전 M분 고가(돌파 기준) */
  breakoutHigh: number | null;
  /** 분봉 표본 부족(장 초반 등) — graceful 미진입 */
  insufficientData: boolean;
  /** 사람이 읽는 요약(진입 사유 / 미충족 사유) */
  detail: string;
}

/**
 * 당일 VWAP — Σ(전형가격 × 거래량) / Σ(거래량). 전형가격 = (고+저+종)/3.
 * 거래량 합이 0이면 null(추세 확인 불가 → 미진입).
 */
export function computeVwap(candles: readonly ScalpCandle[]): number | null {
  let pv = 0;
  let vol = 0;
  for (const c of candles) {
    const typical = (c.high + c.low + c.close) / 3;
    pv += typical * c.volume;
    vol += c.volume;
  }
  if (vol <= 0) return null;
  return pv / vol;
}

function mean(nums: readonly number[]): number {
  if (nums.length === 0) return 0;
  let s = 0;
  for (const n of nums) s += n;
  return s / nums.length;
}

/**
 * 분봉 단타 진입 신호 판정(순수 함수).
 *
 * @param candles 당일 분봉(시간 오름차순). **마지막 원소가 "현재(평가 시점)"** 다.
 * @param params 진입 파라미터(미지정 시 DEFAULT_SCALP_ENTRY_PARAMS).
 *
 * 표본이 부족하면(직전 평균·돌파 구간을 채우지 못함) insufficientData=true 로 graceful 미진입.
 */
export function evaluateScalpEntry(
  candles: readonly ScalpCandle[],
  params: ScalpEntryParams = DEFAULT_SCALP_ENTRY_PARAMS,
): ScalpEntryDecision {
  const empty: ScalpEntryDecision = {
    triggered: false,
    reasons: { volumeExplosion: false, breakout: false, aboveVwap: false },
    currentPrice: null,
    vwap: null,
    avgVolume: null,
    volumeRatio: null,
    breakoutHigh: null,
    insufficientData: true,
    detail: '분봉 표본 없음 — 미진입',
  };

  if (candles.length === 0) return empty;

  const minRequired = Math.max(params.volumeAvgLookbackMin, params.breakoutLookbackMin) + 1;
  if (candles.length < minRequired) {
    return {
      ...empty,
      currentPrice: candles[candles.length - 1].close,
      detail: `분봉 표본 부족(${candles.length}/${minRequired}) — 미진입`,
    };
  }

  const current = candles[candles.length - 1];
  const prior = candles.slice(0, -1);

  // 1) 거래량 폭발
  const volWindow = prior.slice(-params.volumeAvgLookbackMin);
  const avgVolume = mean(volWindow.map((c) => c.volume));
  const volumeRatio = avgVolume > 0 ? current.volume / avgVolume : null;
  const volumeExplosion = avgVolume > 0 && current.volume >= avgVolume * params.volumeMultiple;

  // 2) 돌파(현재 종가 > 직전 M분 고가)
  const breakoutWindow = prior.slice(-params.breakoutLookbackMin);
  const breakoutHigh = Math.max(...breakoutWindow.map((c) => c.high));
  const breakout = current.close > breakoutHigh;

  // 3) 추세 확인(현재 종가 > 당일 VWAP)
  const vwap = computeVwap(candles);
  const aboveVwap = vwap !== null && current.close > vwap;

  const triggered = volumeExplosion && breakout && aboveVwap;

  const detail = triggered
    ? `${SCALP_ENTRY_TAG} 진입: 거래량 ${volumeRatio?.toFixed(2)}배·${current.close} > 고가 ${breakoutHigh}·VWAP ${vwap?.toFixed(0)}`
    : `미진입(거래량폭발=${volumeExplosion}·돌파=${breakout}·VWAP상회=${aboveVwap})`;

  return {
    triggered,
    reasons: { volumeExplosion, breakout, aboveVwap },
    currentPrice: current.close,
    vwap,
    avgVolume,
    volumeRatio,
    breakoutHigh,
    insufficientData: false,
    detail,
  };
}
