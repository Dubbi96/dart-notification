// 졸업 트래커 요약 로직(DAR-197) — 홈 첫 화면 과밀 해소.
// 홈에선 전체 5게이트 표 대신 '바+카운트+다음 게이트 1개'만 요약 노출하고,
// 게이트별 표/Sharpe는 progressive disclosure(접기)로 옮긴다.
// 순수 함수만(테마/뷰 의존 0) — 결정론적 검증 가능.

import type { GraduationGate, GraduationReport } from '@app-types/graduation.types';

/**
 * 홈 요약에 노출할 '가장 관련 높은 다음 게이트' 1개를 고른다.
 * 우선순위: ① 미달(pass=false, 가장 actionable) → ② 미측정/표본부족(pass=null, 데이터 더 필요)
 * → ③ 전부 통과면 null(졸업 도달). 동순위는 report.gates 배열 순서(도메인 G1..G7)로 결정.
 */
export function pickNextGate(report: GraduationReport): GraduationGate | null {
  const failing = report.gates.find((g) => g.pass === false);
  if (failing) return failing;
  const pending = report.gates.find((g) => g.pass === null);
  if (pending) return pending;
  return null;
}
