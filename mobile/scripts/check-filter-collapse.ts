/**
 * DAR-196 결정론적 검증: 신호 탭 3행 필터칩(등급·투자성향·이벤트)을 단일 "필터"
 * 토글 뒤로 접는 progressive disclosure.
 *
 * SignalExplorer의 순수 유도값을 그대로 모델링해 다음을 증명한다.
 *  1) 기본은 접힘(filtersExpanded=false) → 3행 필터칩은 공간을 차지하지 않는다.
 *  2) 활성 필터 수 = 등급·투자성향·이벤트 중 선택된 개수(검색어는 제외 — 별도 상단 검색바).
 *  3) 배지는 활성 수>0 일 때만 노출, 토글 강조도 동일 조건.
 *
 * 화면 코드와의 1:1 대응:
 *   activeFilterCount = (grade!==undefined?1:0)+(persona!==undefined?1:0)+(eventType!==undefined?1:0)
 *   badgeShown        = activeFilterCount > 0
 *   filterRowsRendered = filtersExpanded   (펼침일 때만 3행 렌더)
 */

interface FilterState {
  grade?: string;
  persona?: string;
  eventType?: string;
  search: string; // 상단 검색바 입력 — 배지 집계에서 제외돼야 함
  filtersExpanded: boolean;
}

// SignalExplorer.tsx의 유도식을 그대로 옮긴 순수 함수
function activeFilterCount(s: FilterState): number {
  return (
    (s.grade !== undefined ? 1 : 0) +
    (s.persona !== undefined ? 1 : 0) +
    (s.eventType !== undefined ? 1 : 0)
  );
}
function badgeShown(s: FilterState): boolean {
  return activeFilterCount(s) > 0;
}
function filterRowsRendered(s: FilterState): boolean {
  return s.filtersExpanded; // 펼침일 때만 3행 칩 렌더
}

interface Case {
  name: string;
  state: FilterState;
  expectCount: number;
  expectBadge: boolean;
  expectRows: boolean;
}

const cases: Case[] = [
  {
    name: '기본(접힘·필터없음) → 피드 상단, 3행 미렌더',
    state: { search: '', filtersExpanded: false },
    expectCount: 0,
    expectBadge: false,
    expectRows: false,
  },
  {
    name: '검색만 입력 → 배지 0(검색은 필터 집계 제외), 접힘 유지',
    state: { search: '삼성', filtersExpanded: false },
    expectCount: 0,
    expectBadge: false,
    expectRows: false,
  },
  {
    name: '등급 1개 활성·접힘 → 배지 1로 활성 발견',
    state: { grade: 'BUY', search: '', filtersExpanded: false },
    expectCount: 1,
    expectBadge: true,
    expectRows: false,
  },
  {
    name: '등급+투자성향 활성·펼침 → 배지 2 + 3행 렌더',
    state: { grade: 'BUY', persona: 'value', search: '', filtersExpanded: true },
    expectCount: 2,
    expectBadge: true,
    expectRows: true,
  },
  {
    name: '3종 전부 활성 → 배지 3',
    state: { grade: 'STRONG_BUY', persona: 'growth', eventType: 'EARNINGS', search: '', filtersExpanded: true },
    expectCount: 3,
    expectBadge: true,
    expectRows: true,
  },
  {
    name: '필터없이 펼침 → 3행 렌더되나 배지/초기화 없음',
    state: { search: '', filtersExpanded: true },
    expectCount: 0,
    expectBadge: false,
    expectRows: true,
  },
  {
    name: '검색+이벤트 활성 → 배지 1(검색 비집계)',
    state: { eventType: 'MERGER', search: 'LG', filtersExpanded: false },
    expectCount: 1,
    expectBadge: true,
    expectRows: false,
  },
];

let failures = 0;
for (const c of cases) {
  const cnt = activeFilterCount(c.state);
  const badge = badgeShown(c.state);
  const rows = filterRowsRendered(c.state);
  const ok = cnt === c.expectCount && badge === c.expectBadge && rows === c.expectRows;
  if (!ok) failures++;
  console.log(
    `${ok ? 'PASS' : 'FAIL'} | ${c.name}\n` +
      `   count=${cnt}(exp ${c.expectCount}) badge=${badge}(exp ${c.expectBadge}) rows=${rows}(exp ${c.expectRows})`,
  );
}

console.log(`\n결과: ${cases.length - failures}/${cases.length} PASS`);
if (failures > 0) {
  console.error('FAILURES present');
  process.exit(1);
}
console.log('All cases passed');
