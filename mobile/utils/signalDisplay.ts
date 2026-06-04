// 신호/포지션 상태·점수를 테마 토큰 색상과 한국어 레이블로 매핑하는 헬퍼.
// 하드코딩 색상 금지 — 항상 ThemeColors 토큰만 반환한다.
// 색상 단독 의미 전달 금지 규칙에 따라 레이블 헬퍼를 항상 동반 사용한다.

import type { SignalGrade, ExitAction } from '@app-types/signal.types';
import type { ThesisStatus } from '@app-types/portfolio.types';

import type { ThemeColors } from '@theme';

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

/** 손익률 색상: 양수 success / 음수 error / 보합 textTertiary */
export function pnlColor(pnlPercent: number, colors: ThemeColors): string {
  if (pnlPercent > 0) return colors.success;
  if (pnlPercent < 0) return colors.error;
  return colors.textTertiary;
}

/** +/- 부호를 포함한 손익률 포맷 */
export function formatPnlPercent(pnlPercent: number): string {
  const sign = pnlPercent > 0 ? '+' : '';
  return `${sign}${pnlPercent.toFixed(1)}%`;
}
