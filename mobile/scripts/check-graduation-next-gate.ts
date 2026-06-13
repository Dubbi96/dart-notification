/**
 * DAR-197 결정론적 검증: 홈 졸업 트래커 first-screen 과밀 → 요약(바+카운트+다음 게이트) + 상세 접기.
 *
 * 과밀(수정 전): 홈 첫 뷰포트에 5게이트 표 전부 + Sharpe 참고행 + 면책줄이 적층.
 * 해결(수정 후): 홈은 진척바 + X/Y 통과 + '다음 게이트' 1개만 요약. 전체 표/Sharpe는 접기(opt-in).
 *
 * 이 스크립트는 요약의 핵심 선택 로직 pickNextGate 를 검증한다.
 *   우선순위: ① 미달(pass=false) → ② 미측정/표본부족(pass=null) → ③ 전부 통과면 null.
 *   동순위는 gates 배열 순서(도메인 G1..G7) 유지.
 *
 * 실행: node scripts/check-graduation-next-gate.ts  (실패 시 exit 1)
 */
import { pickNextGate } from '../utils/graduation.ts';

import type { GateId, GraduationGate, GraduationReport } from '../types/graduation.types.ts';

type GateSpec = { id: GateId; pass: boolean | null; lowSample?: boolean };

function gate({ id, pass, lowSample = false }: GateSpec): GraduationGate {
  return {
    id,
    label: `게이트 ${id}`,
    currentValue: pass === null ? null : 50,
    threshold: 55,
    comparator: 'gte',
    unit: 'percent',
    pass,
    sampleSize: lowSample ? 3 : 30,
    lowSample,
    measurable: pass !== null,
  };
}

function report(specs: GateSpec[]): GraduationReport {
  const gates = specs.map(gate);
  const passedCount = gates.filter((g) => g.pass === true).length;
  return {
    portfolioId: 'pf',
    asOf: '2026-06-14T00:00:00.000Z',
    gates,
    passedCount,
    totalGates: gates.length,
    allPassed: passedCount === gates.length,
    progress: gates.length ? passedCount / gates.length : 0,
    lowSample: gates.some((g) => g.lowSample),
    sharpe: 1.23,
  };
}

interface Scenario {
  name: string;
  report: GraduationReport;
  /** 기대 다음 게이트 id(없으면 null = 전부 통과) */
  expect: GateId | null;
}

const scenarios: Scenario[] = [
  {
    name: '미달 게이트 우선 — pass=false 가 가장 actionable',
    report: report([
      { id: 'G1', pass: true },
      { id: 'G2', pass: null }, // 미측정이지만
      { id: 'G3', pass: false }, // 미달이 우선
      { id: 'G5', pass: true },
    ]),
    expect: 'G3',
  },
  {
    name: '미달 다수 — 배열 순서상 첫 미달 선택(도메인 G순)',
    report: report([
      { id: 'G1', pass: true },
      { id: 'G2', pass: false },
      { id: 'G3', pass: false },
    ]),
    expect: 'G2',
  },
  {
    name: '미달 없음 — 미측정/표본부족(pass=null) 첫 게이트로 폴백',
    report: report([
      { id: 'G1', pass: true },
      { id: 'G2', pass: null, lowSample: true },
      { id: 'G5', pass: true },
    ]),
    expect: 'G2',
  },
  {
    name: '전부 통과 — null(졸업 도달 라인)',
    report: report([
      { id: 'G1', pass: true },
      { id: 'G2', pass: true },
      { id: 'G3', pass: true },
    ]),
    expect: null,
  },
  {
    name: '미달과 미측정 혼재 — 미측정이 앞서도 미달이 우선',
    report: report([
      { id: 'G1', pass: null },
      { id: 'G2', pass: false },
    ]),
    expect: 'G2',
  },
];

let failures = 0;
for (const sc of scenarios) {
  const picked = pickNextGate(sc.report);
  const pickedId = picked?.id ?? null;
  const ok = pickedId === sc.expect;
  if (!ok) failures++;
  console.log(
    `${ok ? 'PASS' : 'FAIL'} | ${sc.name}\n   선택=${pickedId ?? '—(전부통과)'} [기대 ${sc.expect ?? '—(전부통과)'}]`,
  );
}

console.log(`\n결과: ${scenarios.length - failures}/${scenarios.length} PASS`);
if (failures > 0) {
  console.error('FAILURES present');
  process.exit(1);
}
console.log('All scenarios passed');
