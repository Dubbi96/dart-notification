// 수익률(%)·승률 표기와 부호→색 규칙의 단일 정본(DAR-177).
// 화면마다 제각각이던 자릿수(toFixed 1 vs 2)·0% 처리·부호색 인라인 분기를
// 여기로 통일한다. 하드코딩 색상 금지 — 항상 ThemeColors 토큰만 반환한다.

import type { ThemeColors } from '@theme';

/**
 * 수익률(%) 표기 — 부호 포함, 자릿수 통일(기본 1자리).
 * - 입력은 이미 퍼센트 단위(예: 12.3 → "+12.3%"). 비율(0~1)이 아님.
 * - 양수만 '+' 부호, 0/음수는 부호 없음(음수는 toFixed의 '-'가 붙는다).
 * - null/undefined/NaN 은 '—'(데이터 없음).
 */
export function formatReturnPct(
  value: number | null | undefined,
  opts?: { digits?: number },
): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '—';
  const digits = opts?.digits ?? 1;
  const sign = value > 0 ? '+' : '';
  return `${sign}${value.toFixed(digits)}%`;
}

/**
 * 승률 표기 — 비율(0~1)을 정수 %로. null/undefined 는 fallback(기본 '—').
 * 일부 화면은 '표본 부족' 등 도메인 카피를 fallback 으로 넘긴다.
 */
export function formatWinRate(
  value: number | null | undefined,
  opts?: { fallback?: string },
): string {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return opts?.fallback ?? '—';
  }
  return `${Math.round(value * 100)}%`;
}

/**
 * 부호→색 단일 규칙: 양수 success / 음수 error / 보합(0) textSecondary.
 * 보합(0%)에 textTertiary(≈2.5:1, 거의 안 보임)를 쓰지 않고 AA 가독성의
 * textSecondary 를 사용한다(DAR-148). 방향 단서는 호출부 아이콘/부호가 병행.
 */
export function returnColor(value: number, colors: ThemeColors): string {
  if (value > 0) return colors.success;
  if (value < 0) return colors.error;
  return colors.textSecondary;
}
