import { StrategyParams } from '../ports/backtest.types';

/**
 * DAR-404 — 시스템 트레이딩 전략 변형 프리셋(트레이딩 로직 축).
 *
 * 단일 모의매매(라이브 1년 리플레이, DAR-385)를 '진입/청산/사이징 룰이 다른 전략 변형 4종'으로
 * 분기한다. 각 프리셋은 동일한 point-in-time 리플레이 머신(미래모름)으로 돌려 BacktestRun 한 개씩
 * 트랙을 쌓는다. 거장철학(DAR-76)·페르소나 축과 별개의 '트레이딩 로직' 축이다.
 *
 * ★ 합리적 기본값으로 상수화 — 추후 calibration 으로 조정 가능.
 *
 * DAR-408 — event-edge 의 매수 이벤트 선별은 더 이상 하드코딩 6종이 아니다. EventStudy robust
 *   통계(winsorizedMeanArD20 ?? medianArD20, DAR-402)가 양(+)으로 확인한 이벤트 유형만 동적으로
 *   매수한다(robustEventGate). 산술평균(avgArD20)은 이상치에 오염돼 거짓 양 신호를 만들므로 쓰지
 *   않는다. 양-edge 그룹이 없으면 진입 0(do-no-harm). 데이터가 쌓여 양-edge 가 생기면 자동 활성된다.
 *
 * AI 금지영역: 순수 Rule 상수. AI 개입 0.
 */

/** 모든 전략 공통 초기자본(라이브 리플레이 DEFAULT 와 정렬). */
export const STRATEGY_INITIAL_CAPITAL = 10_000_000;

export interface StrategyPreset {
  /** URL/DB 식별 키(BacktestRun.strategyKey) — kebab-case. */
  key: string;
  /** 화면 표기용 한국어 라벨. */
  label: string;
  /** 전략 설명(한 줄, 게스트 카드에 노출). */
  description: string;
  /** 리플레이 머신에 그대로 주입되는 완전한 전략 파라미터. */
  params: StrategyParams;
  /**
   * DAR-408 — true 면 refresh 시 EventStudy robust 통계로 매수 eventTypes 를 동적 선별한다
   * (정적 params.eventTypes 무시). 양-edge 그룹이 없으면 빈 allowlist → 진입 0(do-no-harm).
   */
  robustEventGate?: boolean;
}

/**
 * 4종 전략 변형. 비교 화면은 이 배열 순서를 기본으로 하되, 누적수익 내림차순 ranking 을 별도 부여한다.
 */
export const STRATEGY_PRESETS: readonly StrategyPreset[] = [
  {
    key: 'event-edge',
    label: '이벤트엣지',
    description:
      'EventStudy robust 통계(winsorized/중앙값)가 양(+) 초과수익을 확인한 이벤트만 데이터 주도로 추종. 양-edge 이벤트가 없으면 진입 안 함(손실 회피). 점수가중 배분, 익절 +20% / 손절 -10% / 최대보유 20거래일.',
    robustEventGate: true,
    params: {
      // eventTypes 는 refresh 시 robust 게이트가 동적 주입(정적 하드코딩 없음, DAR-408).
      minBuyScore: 50,
      entryRule: 'NEXT_OPEN',
      exitRules: {
        takeProfitPct: 20,
        stopLossPct: -10,
        maxHoldDays: 20,
      },
      sizeRule: 'SCORE_WEIGHT',
      maxPositions: 20,
      initialCapital: STRATEGY_INITIAL_CAPITAL,
    },
  },
  {
    key: 'short-momentum',
    label: '단기모멘텀',
    description:
      '고점수(≥70) 신호만 짧게. 익절 +10% / 손절 -5% / 최대보유 5거래일, 균등배분으로 회전을 빠르게.',
    params: {
      minBuyScore: 70,
      entryRule: 'NEXT_OPEN',
      exitRules: {
        takeProfitPct: 10,
        stopLossPct: -5,
        maxHoldDays: 5,
      },
      sizeRule: 'EQUAL_WEIGHT',
      maxPositions: 20,
      initialCapital: STRATEGY_INITIAL_CAPITAL,
    },
  },
  {
    key: 'conservative-value',
    label: '보수가치',
    description:
      '고점수(≥70) 신호를 소수(최대 10종목) 집중. 점수가중 배분, 익절 +20% / 손절 -10% / 최대보유 20거래일로 느긋하게.',
    params: {
      minBuyScore: 70,
      entryRule: 'NEXT_OPEN',
      exitRules: {
        takeProfitPct: 20,
        stopLossPct: -10,
        maxHoldDays: 20,
      },
      sizeRule: 'SCORE_WEIGHT',
      maxPositions: 10,
      initialCapital: STRATEGY_INITIAL_CAPITAL,
    },
  },
  {
    key: 'aggressive-diversified',
    label: '공격분산',
    description:
      '문턱을 낮춰(≥50) 폭넓게(최대 50종목) 분산. 균등배분, 익절 +20% / 손절 -8% / 최대보유 20거래일.',
    params: {
      minBuyScore: 50,
      entryRule: 'NEXT_OPEN',
      exitRules: {
        takeProfitPct: 20,
        stopLossPct: -8,
        maxHoldDays: 20,
      },
      sizeRule: 'EQUAL_WEIGHT',
      maxPositions: 50,
      initialCapital: STRATEGY_INITIAL_CAPITAL,
    },
  },
] as const;

/** 유효한 전략 키 집합(엔드포인트 검증용). */
export const STRATEGY_KEYS: readonly string[] = STRATEGY_PRESETS.map((p) => p.key);

/** 키로 프리셋 조회(없으면 undefined). */
export function findPreset(key: string): StrategyPreset | undefined {
  return STRATEGY_PRESETS.find((p) => p.key === key);
}

/** 진입/청산 룰 요약 문자열(비교 카드 노출용). */
export function summarizeRules(params: StrategyParams, opts?: { robustEventGate?: boolean }): string {
  const { exitRules, minBuyScore, maxPositions, sizeRule } = params;
  const sizeLabel = sizeRule === 'SCORE_WEIGHT' ? '점수가중' : '균등';
  const eventLabel = opts?.robustEventGate
    ? 'robust 양-edge 이벤트 동적 선별 · '
    : params.eventTypes?.length
      ? `이벤트 ${params.eventTypes.length}종 한정 · `
      : '';
  return (
    `${eventLabel}점수 ≥${minBuyScore} · 익절 +${exitRules.takeProfitPct}% / ` +
    `손절 ${exitRules.stopLossPct}% · 최대보유 ${exitRules.maxHoldDays}일 · ` +
    `최대 ${maxPositions}종목 · ${sizeLabel}배분`
  );
}

/**
 * 진입 룰 평문(모바일 StrategyRules.entry 와 1:1). 무엇을 언제 얼마나 사는가.
 * 이벤트 집합·매수점수 문턱·사이징·최대종목수.
 */
export function summarizeEntryRule(params: StrategyParams): string {
  const { minBuyScore, maxPositions, sizeRule } = params;
  const sizeLabel = sizeRule === 'SCORE_WEIGHT' ? '점수가중 배분' : '균등 배분';
  const eventLabel = params.eventTypes?.length
    ? `양(+) 촉매 이벤트 ${params.eventTypes.length}종 한정 · `
    : '전 이벤트 대상 · ';
  return `${eventLabel}매수점수 ≥${minBuyScore} · ${sizeLabel} · 최대 ${maxPositions}종목`;
}

/**
 * 청산 룰 평문(모바일 StrategyRules.exit 와 1:1). 언제 파는가.
 * 익절/손절/(트레일링)/최대보유.
 */
export function summarizeExitRule(params: StrategyParams): string {
  const { exitRules } = params;
  const trailing =
    exitRules.trailingStopPct != null ? ` · 트레일링 ${exitRules.trailingStopPct}%` : '';
  return (
    `익절 +${exitRules.takeProfitPct}% / 손절 ${exitRules.stopLossPct}%` +
    `${trailing} · 최대보유 ${exitRules.maxHoldDays}거래일`
  );
}
