// 신호/포지션 상태·점수를 테마 토큰 색상과 한국어 레이블로 매핑하는 헬퍼.
// 하드코딩 색상 금지 — 항상 ThemeColors 토큰만 반환한다.
// 색상 단독 의미 전달 금지 규칙에 따라 레이블 헬퍼를 항상 동반 사용한다.

import type { SignalGrade, ExitAction } from '@app-types/signal.types';
import type { ThesisStatus } from '@app-types/portfolio.types';

import { SCORE_ONE_LINER, EXIT_SCORE_ONE_LINER } from './copy';
import { formatReturnPct, returnColor } from './numberFormat';

import type { ThemeColors } from '@theme';

/**
 * Buy Score 1줄 평문 (기획 §3-3). grade 우선, 없으면 점수 구간 폴백.
 * 반환 문구는 utils/copy.ts 기준이며 항상 '(참고)' 꼬리표를 포함한다.
 */
export function scoreOneLiner(score: number, grade?: SignalGrade): string {
  switch (grade) {
    case 'STRONG_BUY':
      return SCORE_ONE_LINER.STRONG_BUY;
    case 'BUY':
      return SCORE_ONE_LINER.BUY;
    case 'WATCH':
      return SCORE_ONE_LINER.WATCH;
    case 'NEUTRAL':
      return SCORE_ONE_LINER.NEUTRAL;
    case 'AVOID':
      return SCORE_ONE_LINER.AVOID;
    case 'BLOCKED':
      return SCORE_ONE_LINER.BLOCKED;
    default:
      if (score >= 80) return SCORE_ONE_LINER.SCORE_80_PLUS;
      if (score >= 60) return SCORE_ONE_LINER.SCORE_60_79;
      if (score >= 30) return SCORE_ONE_LINER.SCORE_30_59;
      return SCORE_ONE_LINER.SCORE_0_29;
  }
}

/** Exit Score 1줄 평문 (기획 §3-3). 항상 '(참고)' 꼬리표 포함. */
export function exitScoreOneLiner(action: ExitAction): string {
  switch (action) {
    case 'EXIT':
    case 'BLOCK_REBUY':
      return EXIT_SCORE_ONE_LINER.EXIT;
    case 'REDUCE':
      return EXIT_SCORE_ONE_LINER.REDUCE;
    case 'WATCH':
      return EXIT_SCORE_ONE_LINER.WATCH;
    case 'HOLD':
      return EXIT_SCORE_ONE_LINER.HOLD;
  }
}

// ScoreGauge 등급 밴드 컷(§5). 게이지에 등급 경계 틱을 그릴 위치.
export const BUY_SCORE_CUTS = [30, 60, 80] as const; // 등급 경계
export const EXIT_SCORE_CUTS = [30, 70] as const; // Exit 등급 경계

/**
 * 다음 등급 컷까지 남은 점수(§5). 최상위 구간이면 null.
 * 예: buy score 78 → '+2'(다음 컷 80)
 */
export function nextCutGap(score: number, kind: 'buy' | 'exit'): string | null {
  const cuts = kind === 'buy' ? BUY_SCORE_CUTS : EXIT_SCORE_CUTS;
  const next = cuts.find((c) => c > score);
  if (next === undefined) return null;
  return `+${next - score}`;
}

/** Buy Score 구간별 색상: 0~29 error / 30~59 warning / 60~79 primary / 80↑ success */
export function buyScoreColor(score: number, colors: ThemeColors): string {
  if (score >= 80) return colors.success;
  if (score >= 60) return colors.primary;
  if (score >= 30) return colors.warning;
  return colors.error;
}

/** Exit Score 구간별 색상: 0~29 success / 30~69 warning / 70↑ error */
export function exitScoreColor(score: number, colors: ThemeColors): string {
  if (score >= 70) return colors.error;
  if (score >= 30) return colors.warning;
  return colors.success;
}

export function gradeColor(grade: SignalGrade, colors: ThemeColors): string {
  switch (grade) {
    case 'STRONG_BUY':
      return colors.success;
    case 'BUY':
      return colors.primary;
    case 'WATCH':
      return colors.warning;
    case 'NEUTRAL':
      // 방향성 없음 → 중립 톤(WATCH 경고색과 변별). 색 단독 금지 규칙상 라벨 병행.
      return colors.textSecondary;
    case 'AVOID':
      return colors.error;
    case 'BLOCKED':
      return colors.textTertiary;
  }
}

export function gradeLabel(grade: SignalGrade): string {
  switch (grade) {
    case 'STRONG_BUY':
      return '강한매수';
    case 'BUY':
      return '매수';
    case 'WATCH':
      return '관망';
    case 'NEUTRAL':
      return '중립';
    case 'AVOID':
      return '회피';
    case 'BLOCKED':
      return '차단';
  }
}

export function exitActionColor(action: ExitAction, colors: ThemeColors): string {
  switch (action) {
    case 'HOLD':
      return colors.success;
    case 'WATCH':
    case 'REDUCE':
      return colors.warning;
    case 'EXIT':
    case 'BLOCK_REBUY':
      return colors.error;
  }
}

export function exitActionLabel(action: ExitAction): string {
  switch (action) {
    case 'HOLD':
      return '보유';
    case 'WATCH':
      return '관찰';
    case 'REDUCE':
      return '축소';
    case 'EXIT':
      return '청산';
    case 'BLOCK_REBUY':
      return '재매수 차단';
  }
}

export function thesisStatusColor(status: ThesisStatus, colors: ThemeColors): string {
  switch (status) {
    case 'ACTIVE':
      return colors.primary;
    case 'WATCHING':
      return colors.warning;
    case 'VIOLATED':
      return colors.error;
    case 'EXPIRED':
      return colors.textTertiary;
  }
}

export function thesisStatusLabel(status: ThesisStatus): string {
  switch (status) {
    case 'ACTIVE':
      return '유효';
    case 'WATCHING':
      return '관찰';
    case 'VIOLATED':
      return '훼손';
    case 'EXPIRED':
      return '만료';
  }
}

/**
 * 포지션 상태칩 톤(DAR-368) — 시스템 트레이딩 자동 동작 언어.
 *  - 'auto-sell' : 하드룰 손절·청산 결정(EXIT). 시스템이 다음 평가 시 자동 매도(체결 예정).
 *  - 'monitoring': 논거 훼손 등 소프트(VIOLATED). 자동 매도 전, 시스템이 자동 모니터링 중.
 *  - 'neutral'   : 그 외(유효/관찰/만료).
 */
export type PositionActionTone = 'auto-sell' | 'monitoring' | 'neutral';

/** 포지션 상태칩에 표시할 시스템 자동 동작 디스크립터(DAR-368). */
export interface PositionSystemAction {
  /** 칩 라벨(자동 동작 언어 — 수동 '검토 필요' 금지). */
  label: string;
  tone: PositionActionTone;
  /** 시스템이 자동 매도를 체결/예정 중인가(하드룰 손절·청산 결정). */
  isAutoSell: boolean;
  /** 스크린리더 동선 — 사용자 조치 불필요(시스템 자동)임을 명시. */
  a11yLabel: string;
}

/**
 * 모의투자는 **시스템 트레이딩 현황**이므로 포지션 상태를 자동 동작 언어로 표기한다(DAR-368).
 * 하드룰 손절(-8% 등)은 Engine5가 자동 체결하며 사용자 승인이 불필요하다 — 어떤 상태도
 * 수동 매도('매도 검토 필요')를 요구하지 않는다.
 *
 *  1. exitAction === 'EXIT' → 시스템이 다음 평가 시 자동 매도 → '자동 매도 예정'(auto-sell).
 *     (포지션이 아직 목록에 보이면 미체결 = 예정. 체결되면 거래내역으로 이동한다 → '예정'이 정직.)
 *  2. thesisStatus === 'VIOLATED' → 소프트 훼손, 시스템 자동 모니터링 → '시스템 모니터링'.
 *  3. 그 외 → Thesis 상태 라벨(유효/관찰/만료).
 */
export function positionSystemAction(position: {
  thesisStatus: ThesisStatus;
  exitAction?: ExitAction;
}): PositionSystemAction {
  if (position.exitAction === 'EXIT') {
    return {
      label: '자동 매도 예정',
      tone: 'auto-sell',
      isAutoSell: true,
      a11yLabel: '하드룰 손절 — 시스템이 다음 평가 시 자동 매도합니다. 사용자 조치 불필요.',
    };
  }
  if (position.thesisStatus === 'VIOLATED') {
    return {
      label: '시스템 모니터링',
      tone: 'monitoring',
      isAutoSell: false,
      a11yLabel: '논거 훼손 — 시스템이 자동 모니터링 중입니다. 사용자 조치 불필요.',
    };
  }
  return {
    label: thesisStatusLabel(position.thesisStatus),
    tone: 'neutral',
    isAutoSell: false,
    a11yLabel: `Thesis 상태 ${thesisStatusLabel(position.thesisStatus)}`,
  };
}

/**
 * 손익률 색상 — 부호→색 단일 규칙 `returnColor`의 손익 도메인 별칭(DAR-177).
 * 양수 success / 음수 error / 보합 textSecondary(AA, DAR-148).
 * `opts.digits` 는 표기 자릿수와 맞춘다(기본 1) — 반올림 후 0 은 보합색(DAR-312).
 */
export function pnlColor(
  pnlPercent: number,
  colors: ThemeColors,
  opts?: { digits?: number },
): string {
  return returnColor(pnlPercent, colors, opts);
}

/** +/- 부호를 포함한 손익률 포맷 — 정본 `formatReturnPct`(자릿수 1) 별칭. */
export function formatPnlPercent(pnlPercent: number): string {
  return formatReturnPct(pnlPercent, { digits: 1 });
}

/**
 * 스파크라인(최근 종가 시계열) 추세 색상 — 첫→마지막 종가 부호로 산정(DAR-256).
 * 당일 등락률 색(`pnlColor`)을 5일 추세 라인에 그대로 입히면 '오늘 +/5일 -' 종목에서
 * 우하향 라인이 상승색으로 칠해져 색=의미 정직계약을 위반한다. 라인의 기울기와 색을
 * 일치시키기 위해 추세(마지막 - 처음)의 부호로 색을 정한다.
 * 점 2개 미만이거나 양끝이 같으면 중립(textSecondary, returnColor 보합 규칙과 동일).
 */
export function sparklineTrendColor(values: number[], colors: ThemeColors): string {
  if (values.length < 2) return colors.textSecondary;
  return returnColor(values[values.length - 1] - values[0], colors);
}

/**
 * 스파크라인 추세 방향 한국어 레이블(DAR-256) — 색 단독 의미 금지 규칙에 따라
 * 라인 색·기울기를 낭독(접근성)으로도 전달하기 위한 동반 레이블.
 * 점 2개 미만이면 빈 문자열(추세 없음).
 */
export function sparklineTrendLabel(values: number[]): string {
  if (values.length < 2) return '';
  const delta = values[values.length - 1] - values[0];
  if (delta > 0) return '상승';
  if (delta < 0) return '하락';
  return '횡보';
}
