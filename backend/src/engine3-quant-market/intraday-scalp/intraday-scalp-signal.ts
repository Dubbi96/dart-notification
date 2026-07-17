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

/** 윈도우 스캔 결과(DAR-415). */
export interface ScalpScanResult {
  /** 윈도우 내 **첫 충족봉** 인덱스(없으면 -1). */
  index: number;
  /** 첫 충족봉(없으면 null). 진입가=candle.close, 진입ts=candle.ts. */
  candle: ScalpCandle | null;
  /** 첫 충족봉의 진입 판정(없으면 평가한 마지막 봉의 판정 — 미충족 사유 표면화). */
  decision: ScalpEntryDecision;
  /** 이번 호출에서 평가한 분봉 수(fromIndex 이후). 커서 전진·가시성용. */
  scanned: number;
}

/**
 * 분봉 윈도우 스캔 — `fromIndex` 이후의 **각 분봉을 '현재'로 두고**(그 시점 직전 N분 윈도우로)
 * 3조건을 순회 평가, **첫 충족 분봉**을 반환한다(순수 함수, DAR-415).
 *
 * 배경(DAR-415 버그): 스케줄러는 10분마다 1회만 평가하는데 `evaluateScalpEntry`는 **최신 1봉만**
 * 검사한다. 사이클 사이(10봉)에 발생한 충족 순간이 ':X2분 스냅샷'의 최신봉일 때만 잡혀
 * 대부분 누락된다(0619 실측: 215 stock-min 충족 → 진입 0). 사이클당 신규 도착 분봉을
 * 전부 스캔해 충족 순간을 빠짐없이 포착한다.
 *
 * point-in-time 안전: 인덱스 i 평가는 `candles.slice(0, i+1)`만 사용 — 미래 분봉을 보지 않는다
 * (VWAP·평균거래량·돌파고가 모두 i 시점까지의 데이터로만 산출). `evaluateScalpEntry`를 그대로
 * 재사용하므로 단봉 판정과 완전히 동일한 규칙이다(신호 정의 SSOT).
 *
 * 순수 함수 — 상태·부수효과 0. 커서 관리(미평가 구간)·dedup(종목당 1라운드트립)·체결·리스크·청산은
 * engine5 가 강제한다.
 *
 * ★DAR-531 미래봉 하드가드: `nowMs`(KST 벽시계를 UTC 컴포넌트에 담은 naive 현재 instant, ms)를
 *   주면 `ts > nowMs`(=현재보다 미래) 분봉은 평가 대상에서 제외한다. 개장 직후 KIS 가 반환한 전일
 *   분봉이 당일로 오라벨되면 09:00~15:30 봉이 '오늘 미래 시각'이 되는데, 그런 유령봉을 진입 근거로
 *   삼는 것을 차단한다(수집 계층 적재 거부의 이중 방어 — 오염이 이미 DB 에 있어도 진입 0). 봉은 시간
 *   오름차순이라 첫 미래봉 이후는 전부 미래 → prefix 로 잘라 원 인덱스(커서)를 보존한다.
 *
 * @param candles  당일 분봉(시간 오름차순).
 * @param fromIndex 평가 시작 인덱스(직전 사이클까지 평가해 비충족 확정된 구간은 건너뛴다). 기본 0.
 * @param params    진입 파라미터(미지정 시 DEFAULT_SCALP_ENTRY_PARAMS).
 * @param nowMs     현재 KST 벽시계 naive instant(ms). 주면 미래봉 제외(미지정 시 전체 평가 — 하위호환).
 */
export function scanEntrySignals(
  candles: readonly ScalpCandle[],
  fromIndex = 0,
  params: ScalpEntryParams = DEFAULT_SCALP_ENTRY_PARAMS,
  nowMs?: number,
): ScalpScanResult {
  // ★DAR-531: 미래봉(ts > now)을 평가 대상에서 제외. 오름차순 가정 → 첫 미래봉 인덱스까지만 유효.
  //   prefix 절단이라 유효 구간의 원 인덱스가 그대로 보존돼 engine5 스캔 커서와 정합한다.
  let cutoff = candles.length;
  if (nowMs !== undefined) {
    for (let i = 0; i < candles.length; i++) {
      if (candles[i].ts.getTime() > nowMs) {
        cutoff = i;
        break;
      }
    }
  }
  const eligible = cutoff === candles.length ? candles : candles.slice(0, cutoff);

  const start = Math.max(0, fromIndex);
  // 평가 봉이 하나도 없을 때를 위한 폴백 판정(유효 구간 기준 = 최신 상태, 미충족 사유 표면화용).
  let lastDecision = evaluateScalpEntry(eligible, params);
  let scanned = 0;
  for (let i = start; i < eligible.length; i++) {
    scanned++;
    const decision = evaluateScalpEntry(eligible.slice(0, i + 1), params);
    lastDecision = decision;
    if (decision.triggered && decision.currentPrice !== null) {
      return { index: i, candle: eligible[i], decision, scanned };
    }
  }
  return { index: -1, candle: null, decision: lastDecision, scanned };
}
