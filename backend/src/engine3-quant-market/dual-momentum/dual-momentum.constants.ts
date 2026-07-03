// Engine3 — 듀얼모멘텀 코어 전략 상수 (DAR-492 [견고화 W1·P12])
//
// 한국형 듀얼모멘텀(Antonacci GEM 변형)의 a-priori frozen 상수. 순수 Rule.
// 2단 구조의 코어(자본 65%): 국내 상장 ETF, 월말 1회 리밸런싱. 거래세 면제(ETF).
//
// 정본(SSOT): docs/trading/strategy-rulebook.md §9.2 (룰북 선기재 → 이 상수와 1:1 대조).
//   ★값 변경 절대 규칙: 룩백·유니버스·자본비율 등 어떤 값도 룰북 §8 3게이트
//   (문서 개정 → 재검증 → 사람 승인)를 통과하지 않고 변경 금지. AI 자동조정 금지(§8.4).
//   유니버스 코드는 P16 백테스트 엣지 검증 이후에도 §8 절차로만 변경한다. 이 이슈에서 frozen.
//
// 이 이슈 범위(순수 판정 계층만): forward 트랙·크론·DB 쓰기는 P13, 백테스트 게이트는 P16 소관.
// 월말 거래일 판정은 P09 common/time/market-calendar.ts(lastTradingDayOfMonth)를 P13 이 사용 —
// 이 이슈에서 재구현 금지(측정 트랙·시각 판정 무접촉).
//
// 기존 시스템 전략 프리셋(strategy-presets.ts STRATEGY_PRESETS 4종)은 무변경 —
// 코어 트랙은 자본 프레임·타임프레임(월단위)이 달라 별도 상수 모듈로 분리한다(이슈 작업 4).
// 위성(변동성 돌파, §9.1/DAR-491)과 병렬 — volatility-breakout.constants.ts 와 나란한 구조.

/**
 * 모멘텀 룩백 = 252 거래일 (a-priori frozen).
 *
 * ★"252영업일 또는 캘린더 12개월 — 택1" (이슈 지정) → **252 거래일** 채택. 근거:
 *   1. 순수 함수 결정론 — bars 배열 인덱스 산술만 사용, 캘린더/날짜 판정 의존을 제거한다.
 *      (거래일·월말 판정은 P09 market-calendar SSOT·P13 소관 — 이 이슈 재구현 금지.)
 *   2. 1년 ≈ 252 KRX 거래일(시장 표준).
 *   3. EtfDailyPrice 는 거래일만 존재(주말·휴장 없음)하므로 252봉 = 약 12개월.
 *   변경은 §8 절차로만.
 */
export const MOMENTUM_LOOKBACK_DAYS = 252;

/**
 * 최소 이력 = 룩백 + 현재봉 = 253봉.
 * 12개월 수익률은 현재 종가와 252 거래일 전 종가가 모두 있어야 산출 가능 → 253봉 필요.
 * ★이슈의 "13개월 미만 이력 시 null"(fail-safe)을 거래일 기준으로 정밀화한 값이다
 *   (12개월 룩백 + 안전마진의 보수적 서술 → 정확한 요구치 253봉). 미달 시 computeMomentum=null.
 */
export const MIN_MOMENTUM_BARS = MOMENTUM_LOOKBACK_DAYS + 1;

/**
 * 공격A(MomA) — TIGER 미국S&P500(360750). 해외주식 모멘텀.
 * etf-universe.ts 의 OFFENSE_INTL(360750)과 동일 코드.
 */
export const CORE_OFFENSE_INTL_CODE = '360750';

/**
 * 공격B(MomB) — KODEX 200(069500). 국내주식 모멘텀.
 * etf-universe.ts 의 OFFENSE_DOMESTIC(069500)과 동일 코드.
 */
export const CORE_OFFENSE_DOMESTIC_CODE = '069500';

/**
 * 절대모멘텀 임계(MomT) — KODEX 단기채권(153130). 무위험 대용(T-bill) 절대 모멘텀 필터.
 * max(MomA, MomB) 가 이 값을 초과해야만 공격 자산에 진입(Antonacci out-of-market 필터).
 * etf-universe.ts 의 CASH_SHORT(153130)과 동일 코드.
 */
export const CORE_ABS_MOMENTUM_FILTER_CODE = '153130';

/**
 * 방어 자산 — KODEX 종합채권(273130). 절대모멘텀 미충족(공격 모멘텀 ≤ 단기채) 시 100% 회피처.
 * etf-universe.ts 의 DEFENSE_BOND(273130)과 동일 코드.
 */
export const CORE_DEFENSE_BOND_CODE = '273130';

/**
 * 트랙 식별 태그(forward 영속 styleTag SSOT, P13 배선 시 사용).
 * ★§9 선기재 placeholder(룰북 표)의 `alloc:dual-momentum` 과 동일 — 기존 절 무변경 원칙 준수.
 */
export const CORE_STYLE_TAG = 'alloc:dual-momentum';

/**
 * 리밸런싱 주기 — 매월 마지막 거래일 1회 판정.
 * ★실제 월말 거래일 판정은 P09 market-calendar(lastTradingDayOfMonth) 로 P13 이 수행. 여기선 상수 라벨만.
 */
export const CORE_REBALANCE_TIMING = 'MONTHLY_LAST_TRADING_DAY' as const;

/**
 * 코어 자본 배분 비율 — 총자본의 65%. (2단 프레임: 코어 65% / 위성 25% / 버퍼 10%.)
 * ★실제 2단 자본 프레임 배선·활성 게이트는 P16 소관. 여기서는 a-priori 상수로만 선기재한다.
 */
export const CORE_CAPITAL_ALLOCATION_PCT = 0.65;

/** 코어 프리셋(문서↔코드 대조용 단일 객체). strategy-presets.ts StrategyPreset 패턴 준용. */
export interface DualMomentumPreset {
  /** URL/DB 식별 키(kebab-case). */
  key: string;
  /** 화면 표기용 한국어 라벨. */
  label: string;
  /** forward 영속 styleTag. */
  styleTag: string;
  /** 공격A(해외주식) ETF 단축코드. */
  offenseIntlCode: string;
  /** 공격B(국내주식) ETF 단축코드. */
  offenseDomesticCode: string;
  /** 절대모멘텀 임계(단기채) ETF 단축코드. */
  absMomentumFilterCode: string;
  /** 방어(종합채권) ETF 단축코드. */
  defenseBondCode: string;
  /** 모멘텀 룩백(거래일, frozen). */
  lookbackDays: number;
  /** 리밸런싱 주기. */
  rebalanceTiming: string;
  /** 코어 자본 배분 비율. */
  capitalAllocationPct: number;
}

/** 듀얼모멘텀 코어 프리셋(frozen 상수 묶음). */
export const DUAL_MOMENTUM_PRESET: DualMomentumPreset = {
  key: 'core-dual-momentum',
  label: '듀얼모멘텀 코어',
  styleTag: CORE_STYLE_TAG,
  offenseIntlCode: CORE_OFFENSE_INTL_CODE,
  offenseDomesticCode: CORE_OFFENSE_DOMESTIC_CODE,
  absMomentumFilterCode: CORE_ABS_MOMENTUM_FILTER_CODE,
  defenseBondCode: CORE_DEFENSE_BOND_CODE,
  lookbackDays: MOMENTUM_LOOKBACK_DAYS,
  rebalanceTiming: CORE_REBALANCE_TIMING,
  capitalAllocationPct: CORE_CAPITAL_ALLOCATION_PCT,
} as const;
