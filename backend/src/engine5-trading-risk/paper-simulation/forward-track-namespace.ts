/**
 * forward-track-namespace.ts — forward 트랙 네임스페이스 순수 Rule (개장 체결 정렬, 2026-07-06)
 *
 * "저녁 = 주문 결정(PENDING 예약) → 익일 개장 = 실시간 틱 체결" 의미론을 시스템 모의 외
 * 철학 스타일 4종·전략 forward 4종까지 확장하면서, 트랙 식별(포트폴리오 이름 규약 ↔ styleTag)·
 * 트랙별 초기원금·체결 시 exit 파라미터·체결 알림 메타를 **한 곳의 순수 함수**로 모은다.
 *
 * 설계 원칙:
 *  - I/O·prisma·서비스 import 0 (philosophy-style / strategy-presets 순수 상수만 의존) —
 *    paper-simulation.service ↔ strategy-forward-simulation.service 간 순환 import 를 차단한다.
 *  - 이름 규약 파서는 **화이트리스트 검증**(철학 4종·전략 프리셋 키)이다 — 도출 불가한 이름
 *    (예: 코어 `[alloc:dual-momentum]` — 자체 체결기 보유)은 null 로 스킵(안전, do-no-harm).
 *  - ★AI 금지영역 불가침: 전부 결정론적 순수 함수(side-effect 0), AI 0.
 */

import {
  PHILOSOPHY_STYLES,
  PhilosophyStyle,
  STYLE_LABELS,
  STYLE_PORTFOLIO_PREFIX,
} from './philosophy-style';
import {
  findPreset,
  STRATEGY_INITIAL_CAPITAL,
  StrategyPreset,
} from '../../engine3-quant-market/backtest/strategies/strategy-presets';

/** 시스템 모의 네임스페이스(styleTag) — PaperSimulationService.TRADE_STRATEGY_KEY 의 SSOT. */
export const PAPER_SIM_STYLE_TAG = 'paper-simulation';

/** 전략 forward styleTag 접두사 — 철학 스타일(BUFFETT 등)·단타(intraday-scalp)와 충돌 없는 네임스페이스. */
export const STRATEGY_TAG_PREFIX = 'strategy:';

/** 일봉 forward 트랙 공통 가상 초기원금(시스템 모의·철학과 동일 — 스펙이 동치 봉인). */
export const FORWARD_TRACK_INITIAL_CAPITAL = 10_000_000;

/** 전략 forward 트레이드/스냅샷 태그 — 예: 'strategy:event-edge'. */
export function strategyStyleTag(key: string): string {
  return `${STRATEGY_TAG_PREFIX}${key}`;
}

/** 전략 forward 포트폴리오 이름 — 예: '모의운용 포트폴리오 [strategy:event-edge]'. */
export function strategyForwardPortfolioName(key: string): string {
  return `${STYLE_PORTFOLIO_PREFIX} [${strategyStyleTag(key)}]`;
}

/**
 * 프리셋 exitRules → Position exit 파라미터 대입값(순수 함수).
 * Position.stopLossPct/takeProfitPct 는 양수 컨벤션(exit 엔진이 abs 판정) → 부호 정규화.
 */
export function presetExitParams(preset: StrategyPreset): {
  stopLossPct: number;
  takeProfitPct: number;
  maxHoldDays: number;
} {
  return {
    stopLossPct: Math.abs(preset.params.exitRules.stopLossPct),
    takeProfitPct: Math.abs(preset.params.exitRules.takeProfitPct),
    maxHoldDays: preset.params.exitRules.maxHoldDays,
  };
}

/**
 * 포트폴리오 이름(규약) → 트랙 네임스페이스(styleTag) 역산. 하드코딩 목록 금지 — 규약 파서.
 *   '모의운용 포트폴리오'                     → 'paper-simulation' (시스템 모의)
 *   '모의운용 포트폴리오 [BUFFETT]'            → 'BUFFETT' (철학 4종 화이트리스트)
 *   '모의운용 포트폴리오 [strategy:<key>]'     → 'strategy:<key>' (프리셋 키 존재 검증)
 *   그 외(미상 접미사·코어 [alloc:*] 등)        → null (스킵 — 각 트랙 자체 체결기 소관)
 */
export function styleTagForForwardPortfolioName(name: string): string | null {
  if (name === STYLE_PORTFOLIO_PREFIX) return PAPER_SIM_STYLE_TAG;
  const m = name.match(/^(.+) \[([^\]]+)\]$/);
  if (!m || m[1] !== STYLE_PORTFOLIO_PREFIX) return null;
  const tag = m[2];
  if ((PHILOSOPHY_STYLES as readonly string[]).includes(tag)) return tag;
  if (tag.startsWith(STRATEGY_TAG_PREFIX)) {
    const key = tag.slice(STRATEGY_TAG_PREFIX.length);
    if (findPreset(key)) return tag;
  }
  return null;
}

/**
 * 트랙별 가상 초기원금 — 개장 체결기의 SSOT 현금 산정 입력.
 * 전략 forward 는 프리셋 상수(STRATEGY_INITIAL_CAPITAL), 그 외(시스템 모의·철학)는 공통 10M.
 */
export function initialCapitalForStyleTag(styleTag: string): number {
  return styleTag.startsWith(STRATEGY_TAG_PREFIX)
    ? STRATEGY_INITIAL_CAPITAL
    : FORWARD_TRACK_INITIAL_CAPITAL;
}

/**
 * 트랙별 체결 시 exit 파라미터 오버라이드.
 *   전략 forward: 프리셋 exitRules 가 정본(THESIS 룰 미혼입 — 전략 정체성 보존).
 *   시스템 모의·철학: null → 체결기가 thesis exitRules 파생 + 기본 익절(+20%) 적용(기존 동작).
 */
export function exitParamsForStyleTag(styleTag: string): {
  stopLossPct: number;
  takeProfitPct: number;
  maxHoldDays: number;
} | null {
  if (!styleTag.startsWith(STRATEGY_TAG_PREFIX)) return null;
  const preset = findPreset(styleTag.slice(STRATEGY_TAG_PREFIX.length));
  return preset ? presetExitParams(preset) : null;
}

/** 체결 알림 메타 — strategyKey 는 styleTag 그대로(트랙 식별 보존), 라벨·딥링크는 트랙별. */
export interface TrackNotificationMeta {
  strategyKey: string;
  strategyLabel: string;
  deepLink: string;
}

/** 시스템 모의 체결 알림 메타(기존 상수와 동일 — 스펙이 동치 봉인). */
const SYSTEM_TRACK_META: TrackNotificationMeta = {
  strategyKey: PAPER_SIM_STYLE_TAG,
  strategyLabel: '시스템 모의',
  deepLink: '/portfolio?tab=sim',
};

/**
 * styleTag → 체결 알림 메타(순수 함수).
 *   'paper-simulation' → 시스템 모의(/portfolio?tab=sim — 기존 동작 그대로)
 *   철학 4종           → 스타일 한글 라벨(/portfolio?tab=style)
 *   'strategy:<key>'   → 프리셋 라벨(/portfolio?tab=strategy)
 *   미상               → styleTag 라벨 + /portfolio 폴백(정직 — 위장 라벨 금지)
 */
export function trackNotificationMeta(styleTag: string): TrackNotificationMeta {
  if (styleTag === PAPER_SIM_STYLE_TAG) return SYSTEM_TRACK_META;
  if ((PHILOSOPHY_STYLES as readonly string[]).includes(styleTag)) {
    return {
      strategyKey: styleTag,
      strategyLabel: STYLE_LABELS[styleTag as PhilosophyStyle],
      deepLink: '/portfolio?tab=style',
    };
  }
  if (styleTag.startsWith(STRATEGY_TAG_PREFIX)) {
    const preset = findPreset(styleTag.slice(STRATEGY_TAG_PREFIX.length));
    if (preset) {
      return {
        strategyKey: styleTag,
        strategyLabel: preset.label,
        deepLink: '/portfolio?tab=strategy',
      };
    }
  }
  return { strategyKey: styleTag, strategyLabel: styleTag, deepLink: '/portfolio' };
}

/** YYYYMMDD → 그 KST 날짜 자정의 절대 시각(Date). 예약 체결 예정 거래일(entryDate) 영속용. */
export function kstMidnightOf(ymd: string): Date {
  return new Date(`${ymd.slice(0, 4)}-${ymd.slice(4, 6)}-${ymd.slice(6, 8)}T00:00:00+09:00`);
}
