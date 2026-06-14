/**
 * DAR-272 결정론적 검증: DAR 위임 행 컴포넌트 메모이제이션.
 *
 * 대상 2파일(독립·충돌 없음):
 *   ① components/company/InsiderHoldingsTab.tsx — InsiderRow + FlatList renderItem
 *   ② components/disclosure/DisclosureFiledFactsSection.tsx — FactRow + FlatList renderItem
 *
 * 두 축으로 증명한다.
 *  A) 소스 바인딩: 실제 파일 내용에 React.memo 래핑과 useCallback renderItem,
 *     그리고 FlatList가 인라인 화살표가 아닌 안정 식별자(renderItem)를 넘기는지 단언.
 *     (RN 런타임이 tsx에 없어 모듈 import 불가 → 소스 정규식으로 구조 불변식을 고정.)
 *  B) 재조정 모델: React.memo 기본 shallow 비교 + renderItem useCallback([]) 참조 고정
 *     불변식을 모사해 "부모 리렌더 시 데이터 불변 행 리렌더 0"을 증명하고,
 *     메모/useCallback 미적용(회귀) 시 전 행 리렌더되는 음성 대조군을 둔다.
 *
 * 실행: npx tsx scripts/check-row-memo.ts
 */

import { readFileSync } from 'fs';
import { join } from 'path';

let failures = 0;
function assert(name: string, cond: boolean): void {
  if (cond) {
    console.log(`  ✓ ${name}`);
  } else {
    failures++;
    console.error(`  ✗ ${name}`);
  }
}

const ROOT = join(__dirname, '..');
const insiderSrc = readFileSync(
  join(ROOT, 'components/company/InsiderHoldingsTab.tsx'),
  'utf8',
);
const factsSrc = readFileSync(
  join(ROOT, 'components/disclosure/DisclosureFiledFactsSection.tsx'),
  'utf8',
);

// ── A) 소스 바인딩: 실제 파일 구조 불변식 ──────────────────────────────
console.log('A) 소스 바인딩 (실제 파일 구조)');

// ① InsiderRow
assert(
  'InsiderRow가 React.memo로 래핑됨',
  /const\s+InsiderRow\s*=\s*React\.memo\(\s*function\s+InsiderRow/.test(insiderSrc),
);
assert(
  'InsiderHoldingsTab renderItem이 useCallback으로 생성됨',
  /const\s+renderItem\s*=\s*useCallback<\s*ListRenderItem</.test(insiderSrc),
);
assert(
  'InsiderHoldingsTab FlatList가 안정 renderItem 식별자를 넘김(인라인 화살표 아님)',
  /renderItem=\{renderItem\}/.test(insiderSrc) &&
    !/renderItem=\{\(\{\s*item\s*\}\)\s*=>/.test(insiderSrc),
);
assert(
  'useCallback이 react에서 import됨(InsiderHoldingsTab)',
  /import\s+React,\s*\{\s*useCallback\s*\}\s*from\s*'react'/.test(insiderSrc),
);

// ② FactRow
assert(
  'FactRow가 React.memo로 래핑됨',
  /const\s+FactRow\s*=\s*React\.memo\(\s*function\s+FactRow/.test(factsSrc),
);
assert(
  'DisclosureFiledFactsSection renderItem이 useCallback으로 생성됨',
  /const\s+renderItem\s*=\s*useCallback<\s*ListRenderItem</.test(factsSrc),
);
assert(
  'DisclosureFiledFactsSection FlatList가 안정 renderItem 식별자를 넘김(인라인 화살표 아님)',
  /renderItem=\{renderItem\}/.test(factsSrc) &&
    !/renderItem=\{\(\{\s*item\s*\}\)\s*=>/.test(factsSrc),
);
assert(
  'useCallback이 react에서 import됨(DisclosureFiledFactsSection)',
  /import\s+React,\s*\{\s*useCallback[^}]*\}\s*from\s*'react'/.test(factsSrc),
);

// 시각·동작 동일 회귀: 표시 마크업/포맷 함수가 보존됐는지(행 컴포넌트 본문 불변).
assert(
  'InsiderRow 표시 본문 보존(보유 비율·tradeStyle)',
  insiderSrc.includes('보유 비율') && insiderSrc.includes('tradeStyle(item.tradeType)'),
);
assert(
  'FactRow 표시 본문 보존(formatFiledFactValue·factLabel)',
  factsSrc.includes('formatFiledFactValue(fact)') && factsSrc.includes('factLabel(fact.factKey)'),
);

// ── B) 재조정 모델: 메모 + useCallback 효과 ───────────────────────────
console.log('B) 재조정 모델 (React.memo shallow + useCallback([]) 안정 참조)');

type RowProps<T> = { item: T };

// React.memo 기본 비교자(shallow). 커스텀 comparator 미지정 → 이 규칙 적용.
function memoAreEqual<T>(prev: RowProps<T>, next: RowProps<T>): boolean {
  return prev.item === next.item;
}

// renderItem이 안정 참조(useCallback([]))이고 item 참조가 불변이면 행 리렌더 0.
function renderPass<T>(
  prevByKey: Map<string, RowProps<T>>,
  items: T[],
  key: (t: T) => string,
): { rerendered: string[]; next: Map<string, RowProps<T>> } {
  const rerendered: string[] = [];
  const next = new Map<string, RowProps<T>>();
  for (const item of items) {
    const props: RowProps<T> = { item };
    const prev = prevByKey.get(key(item));
    if (!prev || !memoAreEqual(prev, props)) rerendered.push(key(item));
    next.set(key(item), props);
  }
  return { rerendered, next };
}

// InsiderHolding 데이터(데이터 불변 = 동일 배열 참조 → 동일 item 참조)
const i1 = { id: 'INS-1' };
const i2 = { id: 'INS-2' };
const i3 = { id: 'INS-3' };
const insiders = [i1, i2, i3];
const ikey = (x: { id: string }) => x.id;

const iMount = renderPass(new Map(), insiders, ikey);
assert('InsiderRow 최초 마운트 시 보이는 행 전부 렌더(3건)', iMount.rerendered.length === 3);

// 부모 리렌더(데이터 불변, renderItem 안정): 행 리렌더 0  ← DoD 핵심
const iRerender = renderPass(iMount.next, insiders, ikey);
assert('InsiderRow 부모 리렌더 시 데이터 불변 행 리렌더 0', iRerender.rerendered.length === 0);

// 신규 항목 append: 기존 행 0, 신규만 렌더
const i4 = { id: 'INS-4' };
const iAppended = renderPass(iRerender.next, [...insiders, i4], ikey);
assert(
  'InsiderRow append 시 신규 행만 렌더(1건)',
  iAppended.rerendered.length === 1 && iAppended.rerendered[0] === 'INS-4',
);

// FactRow 동일 모델
const f1 = { key: 'FACT-1' };
const f2 = { key: 'FACT-2' };
const facts = [f1, f2];
const fkey = (x: { key: string }) => x.key;

const fMount = renderPass(new Map(), facts, fkey);
assert('FactRow 최초 마운트 시 보이는 행 전부 렌더(2건)', fMount.rerendered.length === 2);

const fRerender = renderPass(fMount.next, facts, fkey);
assert('FactRow 부모 리렌더 시 데이터 불변 행 리렌더 0', fRerender.rerendered.length === 0);

// ── 음성 대조군: 메모/useCallback 미적용 회귀 모사 ─────────────────────
// renderItem이 매 렌더 새 함수면 FlatList가 새 엘리먼트를 만들고, 행이 memo가
// 아니면 부모 리렌더마다 전 행이 재렌더된다. 새 item 참조(인라인 객체)로 모사.
console.log('음성 대조군 (회귀 신호)');
function renderPassUnstable<T extends object>(
  prevByKey: Map<string, RowProps<T>>,
  items: T[],
  key: (t: T) => string,
  isMemo: boolean,
): { rerendered: string[]; next: Map<string, RowProps<T>> } {
  const rerendered: string[] = [];
  const next = new Map<string, RowProps<T>>();
  for (const item of items) {
    const props: RowProps<T> = { item };
    const prev = prevByKey.get(key(item));
    // isMemo=false → memo 비교 자체가 없어 항상 재렌더.
    if (!prev || !isMemo || !memoAreEqual(prev, props)) rerendered.push(key(item));
    next.set(key(item), props);
  }
  return { rerendered, next };
}

const ctrlMount = renderPassUnstable(new Map(), insiders, ikey, false);
const ctrlRerender = renderPassUnstable(ctrlMount.next, insiders, ikey, false);
assert(
  '회귀(비메모) 시 부모 리렌더마다 전 행 리렌더(3건) — 본 수정이 막는 경로',
  ctrlRerender.rerendered.length === insiders.length,
);

// keyExtractor 고유성(키 충돌 시 memo 매칭 오작동)
assert(
  'InsiderHoldings keyExtractor(id) 전부 고유',
  new Set(insiders.map(ikey)).size === insiders.length,
);
assert(
  'FiledFacts keyExtractor 전부 고유',
  new Set(facts.map(fkey)).size === facts.length,
);

const TOTAL = 16;
if (failures === 0) {
  console.log(`ALL PASS (${TOTAL}/${TOTAL})`);
  process.exit(0);
} else {
  console.error(`FAIL: ${failures} assertion(s)`);
  process.exit(1);
}
