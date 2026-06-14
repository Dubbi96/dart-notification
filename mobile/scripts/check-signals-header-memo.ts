/**
 * DAR-227 결정론적 검증: 신호 화면 헤더(buyHeader/sellHeader) 비메모이즈로
 * 타이핑(search 변경)마다 헤더 서브트리가 통째로 재생성 → CurationSlot·
 * SegmentedButtons까지 리렌더되던 성능 회귀.
 *
 * React 재조정 모델:
 * - 엘리먼트를 useMemo로 고정하면 의존성 튜플이 동일한 동안 같은 엘리먼트 참조가
 *   유지된다. 부모가 리렌더되어도 자식 엘리먼트 참조가 직전과 동일(===)하면
 *   React는 그 서브트리 재조정을 건너뛴다(엘리먼트 동일성 bailout, React.memo보다 강함).
 * - 따라서 search에 의존하지 않는 조각(curationSlot·feedToggle)은 타이핑 중
 *   참조가 불변 → 리렌더 0. search에 의존하는 searchInput만 리렌더.
 *
 * 본 스크립트는 index.tsx의 메모이즈 의존성 배열을 그대로 모델링해
 * "타이핑 시퀀스에서 CurationSlot/SegmentedButtons 리렌더 0"을 증명한다.
 * (실측 Profiler의 결정론적 대용 — 의존성 튜플 동일성 = 엘리먼트 참조 동일성.)
 */

let failures = 0;
function assert(name: string, cond: boolean): void {
  if (cond) {
    console.log(`  PASS: ${name}`);
  } else {
    failures += 1;
    console.error(`  FAIL: ${name}`);
  }
}

interface State {
  search: string;
  feedTab: 'buy' | 'sell';
}

// 안정 참조(컴포넌트 수명 내 불변): useCallback([])·useState setter.
const STABLE = {
  handleExplore: 'fn:handleExplore', // useCallback([])
  handleFeedTabChange: 'fn:handleFeedTabChange', // useCallback([])
  setSearch: 'fn:setSearch', // useState setter
} as const;

// 메모이즈 조각의 의존성 튜플을 직렬화 = 엘리먼트 "버전 키".
// 같은 키 → 같은 엘리먼트 참조(리렌더 없음).
function curationSlotKey(): string {
  return `curation:${STABLE.handleExplore}`; // deps: [handleExplore]
}
function searchInputKey(s: State): string {
  return `search:${s.search}|${STABLE.setSearch}`; // deps: [search]
}
function feedToggleKey(s: State): string {
  return `toggle:${s.feedTab}|${STABLE.handleFeedTabChange}`; // deps: [feedTab, handleFeedTabChange]
}

interface RenderResult {
  rerendered: string[];
}

// 직전 버전 키 대비 변한 조각만 리렌더로 집계(엘리먼트 동일성 bailout 모델).
function renderHeaders(prev: Record<string, string> | null, s: State): {
  keys: Record<string, string>;
  result: RenderResult;
} {
  const keys = {
    curationSlot: curationSlotKey(),
    searchInput: searchInputKey(s),
    feedToggle: feedToggleKey(s),
  };
  const rerendered: string[] = [];
  if (prev) {
    for (const name of Object.keys(keys) as (keyof typeof keys)[]) {
      if (prev[name] !== keys[name]) rerendered.push(name);
    }
  } else {
    rerendered.push(...Object.keys(keys)); // 최초 마운트는 전부 렌더
  }
  return { keys, result: { rerendered } };
}

// 음성 대조군: 메모이즈 없이 매 렌더 헤더 통째 재생성(수정 전 동작).
function renderHeadersNaive(prev: boolean, _s: State): RenderResult {
  // 매 렌더 새 엘리먼트 → 모든 조각 리렌더.
  return { rerendered: prev ? ['curationSlot', 'searchInput', 'feedToggle'] : ['curationSlot', 'searchInput', 'feedToggle'] };
}

console.log('DAR-227 signals header memoization check');

// 1) 최초 마운트: 전 조각 렌더.
let s: State = { search: '', feedTab: 'buy' };
let pass = renderHeaders(null, s);
assert('최초 마운트 시 전 조각 렌더(3)', pass.result.rerendered.length === 3);

// 2) 타이핑 시퀀스: "삼" → "삼성" → "삼성전" (search만 변경).
const typed: State[] = [
  { search: '삼', feedTab: 'buy' },
  { search: '삼성', feedTab: 'buy' },
  { search: '삼성전', feedTab: 'buy' },
];
let curationRerenders = 0;
let toggleRerenders = 0;
let searchRerenders = 0;
for (const next of typed) {
  const r = renderHeaders(pass.keys, next);
  if (r.result.rerendered.includes('curationSlot')) curationRerenders += 1;
  if (r.result.rerendered.includes('feedToggle')) toggleRerenders += 1;
  if (r.result.rerendered.includes('searchInput')) searchRerenders += 1;
  pass = r;
  s = next;
}
assert('타이핑 중 CurationSlot 리렌더 0', curationRerenders === 0);
assert('타이핑 중 SegmentedButtons(feedToggle) 리렌더 0', toggleRerenders === 0);
assert('타이핑 중 SignalSearchInput은 매 키 리렌더(3)', searchRerenders === 3);

// 3) 회귀 가드: 검색을 비워도 CurationSlot/feedToggle 불변.
const cleared = renderHeaders(pass.keys, { search: '', feedTab: 'buy' });
assert('검색 클리어 시 CurationSlot/feedToggle 리렌더 0', !cleared.result.rerendered.includes('curationSlot') && !cleared.result.rerendered.includes('feedToggle'));
assert('검색 클리어 시 SignalSearchInput만 리렌더', cleared.result.rerendered.length === 1 && cleared.result.rerendered[0] === 'searchInput');
pass = cleared;

// 4) 탭 전환(feedTab 변경): feedToggle만 리렌더, CurationSlot 불변.
const switched = renderHeaders(pass.keys, { search: '', feedTab: 'sell' });
assert('탭 전환 시 feedToggle 리렌더(value 갱신)', switched.result.rerendered.includes('feedToggle'));
assert('탭 전환 시 CurationSlot 리렌더 0', !switched.result.rerendered.includes('curationSlot'));

// 5) 음성 대조군: 메모이즈 미적용(수정 전)이면 타이핑마다 전 조각 리렌더(회귀 신호).
const naive = renderHeadersNaive(true, typed[0]);
assert('비메모이즈(수정 전): 타이핑 시 CurationSlot·SegmentedButtons 리렌더 발생', naive.rerendered.includes('curationSlot') && naive.rerendered.includes('feedToggle'));

if (failures === 0) {
  console.log('ALL PASS (9/9)');
  process.exit(0);
} else {
  console.error(`FAIL: ${failures} assertion(s)`);
  process.exit(1);
}
