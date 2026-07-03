// Engine3 — 변동성 돌파 위성 전략 상수 (DAR-491 [견고화 W1·P14])
//
// 래리 윌리엄스 변동성 돌파(2단 구조의 위성, 자본 25%)의 a-priori frozen 상수. 순수 Rule.
// 거래세 면제 ETF 대상, 일 단위, 익일 시가 청산(청산 배선은 P15 소관).
//
// 정본(SSOT): docs/trading/strategy-rulebook.md §9.1 (룰북 선기재 → 이 상수와 1:1 대조).
//   ★값 변경 절대 규칙: K·목표변동성·추세필터 등 어떤 값도 룰북 §8 3게이트
//   (문서 개정 → 재검증 → 사람 승인)를 통과하지 않고 변경 금지. AI 자동조정 금지(§8.4).
//   K 튜닝은 P16 백테스트 엣지 검증 이후에만(§8 절차). 이 이슈에서 K=0.5 는 frozen.
//
// 기존 시스템 전략 프리셋(strategy-presets.ts STRATEGY_PRESETS 4종)은 무변경 —
// 위성 트랙은 자본 프레임·트랙 성격이 달라 별도 상수 모듈로 분리한다(이슈 작업 4).

/**
 * 돌파 계수 K — 목표가 = 당일 시가 + 전일 Range(H−L) × K.
 * ★a-priori frozen = 0.5 (래리 윌리엄스 표준값). 튜닝은 P16 백테스트 + §8 절차로만.
 */
export const VOL_BREAKOUT_K = 0.5;

/**
 * 목표 일간 변동성(%) — 변동성 조절 사이징의 기준.
 * 사이징계수 = min(1, 목표변동성 / 전일 Range%). (룰북 §8-4 변동성 타게팅 첫 실적용 — 갭 A11.)
 */
export const TARGET_DAILY_VOL_PCT = 1.0;

/**
 * 추세 필터 기본 상태 — OFF. (전일 종가 > SMA(종가,5) 통과 시에만 진입.)
 * ON/OFF 최종 판정은 P16 백테스트에서. 이 이슈에서는 순수 함수로 구현만 하고 기본 비활성.
 */
export const TREND_FILTER_ENABLED_DEFAULT = false;

/** 추세 필터 SMA 기간(일). */
export const TREND_SMA_PERIOD = 5;

/**
 * 위성 대상 종목 — KODEX 200(069500) 단일.
 * 선정: 거래세 면제(ETF)·유동성 최상. 다종목 확장은 후속 이슈(P16 이후 검토).
 * etf-universe.ts 의 OFFENSE_DOMESTIC(069500)과 동일 코드.
 */
export const SATELLITE_TARGET_ETF_CODE = '069500';

/** 트랙 식별 태그(forward 영속 styleTag SSOT, P15 배선 시 사용). */
export const SATELLITE_STYLE_TAG = 'satellite:vol-breakout';

/**
 * 위성 자본 배분 비율 — 총자본의 25%. (2단 프레임: 코어 65% / 위성 25% / 버퍼 10%.)
 * ★실제 2단 자본 프레임 배선·활성 게이트는 P16 소관. 여기서는 a-priori 상수로만 선기재한다.
 */
export const SATELLITE_CAPITAL_ALLOCATION_PCT = 0.25;

/** 위성 프리셋(문서↔코드 대조용 단일 객체). strategy-presets.ts StrategyPreset 패턴 준용. */
export interface SatelliteBreakoutPreset {
  /** URL/DB 식별 키(kebab-case). */
  key: string;
  /** 화면 표기용 한국어 라벨. */
  label: string;
  /** forward 영속 styleTag. */
  styleTag: string;
  /** 대상 ETF 단축코드. */
  targetEtfCode: string;
  /** 돌파 계수 K (frozen). */
  k: number;
  /** 목표 일간 변동성(%). */
  targetDailyVolPct: number;
  /** 추세 필터 기본 활성 여부. */
  trendFilterEnabled: boolean;
  /** 추세 필터 SMA 기간(일). */
  trendSmaPeriod: number;
  /** 위성 자본 배분 비율. */
  capitalAllocationPct: number;
}

/** 변동성 돌파 위성 프리셋(frozen 상수 묶음). */
export const VOLATILITY_BREAKOUT_PRESET: SatelliteBreakoutPreset = {
  key: 'satellite-vol-breakout',
  label: '변동성 돌파 위성',
  styleTag: SATELLITE_STYLE_TAG,
  targetEtfCode: SATELLITE_TARGET_ETF_CODE,
  k: VOL_BREAKOUT_K,
  targetDailyVolPct: TARGET_DAILY_VOL_PCT,
  trendFilterEnabled: TREND_FILTER_ENABLED_DEFAULT,
  trendSmaPeriod: TREND_SMA_PERIOD,
  capitalAllocationPct: SATELLITE_CAPITAL_ALLOCATION_PCT,
} as const;
