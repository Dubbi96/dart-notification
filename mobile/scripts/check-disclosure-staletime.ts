// DAR-334 결정론 검증: 공시 상세 4개 쿼리(useDisclosureDetail/Event/Analysis/FiledFacts)에
// staleTime 누락(=default 0, 매 mount refetch) → 형제 정본(useCompanyDetail/useFinancials)과 동일한
// staleTime: 1000*60*30(30분) 추가. rcpNo 단건은 발행 후 사실상 불변이므로 재진입 시 불필요 refetch 억제.
// 판정 축:
//   (A) 4개 상세 훅 각각이 staleTime: 1000 * 60 * 30 바인딩
//   (B) 값 정합: 1000*60*30 === 1800000(30분), 형제 정본과 동일 상수
//   (C) 회귀: 목록/검색 무한쿼리(useDisclosures/useDisclosureSearch)에는 staleTime 미추가(동작 불변)
//   (D) 총 staleTime 출현 정확히 4회(상세 4훅에만), 과·소 적용 방지
//   (E) enabled:!!rcpNo·retry:false 등 기존 옵션 보존(추가만, 제거/변경 없음)
import { readFileSync } from 'fs';
import { join } from 'path';

const root = join(__dirname, '..');
const rel = 'hooks/useDisclosures.ts';
const src = readFileSync(join(root, rel), 'utf8');

let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean) {
  if (cond) {
    pass++;
    console.log(`  ok  ${name}`);
  } else {
    fail++;
    console.error(`FAIL  ${name}`);
  }
}

// export function <name>(...) { ... } 단위로 함수 본문을 추출(중괄호 균형 스캔).
function fnBody(name: string): string {
  const sig = `export function ${name}(`;
  const start = src.indexOf(sig);
  if (start === -1) return '';
  const open = src.indexOf('{', start);
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') {
      depth--;
      if (depth === 0) return src.slice(open, i + 1);
    }
  }
  return src.slice(open);
}

const STALE = /staleTime:\s*1000\s*\*\s*60\s*\*\s*30\b/;

// (A) 상세 4훅 staleTime 바인딩
const detailHooks = [
  'useDisclosureDetail',
  'useDisclosureEvent',
  'useDisclosureAnalysis',
  'useDisclosureFiledFacts',
];
for (const h of detailHooks) {
  const body = fnBody(h);
  ok(`(A) ${h}: 함수 본문 추출`, body.length > 0);
  ok(`(A) ${h}: staleTime 1000*60*30 바인딩`, STALE.test(body));
  // (E) 기존 옵션 보존
  ok(`(E) ${h}: enabled:!!rcpNo 보존`, /enabled:\s*!!rcpNo/.test(body));
}
// retry:false 보존(Event/Analysis/FiledFacts 3종)
for (const h of ['useDisclosureEvent', 'useDisclosureAnalysis', 'useDisclosureFiledFacts']) {
  ok(`(E) ${h}: retry:false 보존`, /retry:\s*false/.test(fnBody(h)));
}

// (B) 값 정합 — 코드 상수와 동일한 산술이 30분(1800000ms)
ok('(B) 1000*60*30 === 1800000(30분)', 1000 * 60 * 30 === 1800000);

// (C) 회귀: 목록/검색 무한쿼리에는 staleTime 미추가(동작 불변)
for (const h of ['useDisclosures', 'useDisclosureSearch']) {
  const body = fnBody(h);
  ok(`(C) ${h}: 함수 본문 추출`, body.length > 0);
  ok(`(C) ${h}: staleTime 미추가(목록/검색 동작 불변)`, !/staleTime/.test(body));
}

// (D) 과·소 적용 방지 — 30분 staleTime 은 상세 4훅에만 정확히 4회.
//     (앵커 갱신 2026-07-02: DAR-420 이 useTodayDisclosureCount 에 별도 5분 staleTime 을
//      의도적으로 추가 → 총 출현은 5회가 되었고, 30분 정책 출현만 4회로 재바인딩.
//      잉여 1회가 정확히 today-count 훅의 5분 정책인지까지 단정해 과·소 적용을 계속 막는다.)
const stale30Count = (src.match(/staleTime:\s*1000\s*\*\s*60\s*\*\s*30\b/g) ?? []).length;
ok('(D) 30분 staleTime 출현 정확히 4회(상세 4훅에만)', stale30Count === 4);
const staleCount = (src.match(/staleTime:/g) ?? []).length;
ok('(D) 총 staleTime 출현 정확히 5회(상세 4 + today-count 1)', staleCount === 5);
const todayBody = fnBody('useTodayDisclosureCount');
ok('(D) useTodayDisclosureCount: 함수 본문 추출', todayBody.length > 0);
ok(
  '(D) 잉여 1회 = useTodayDisclosureCount 의 5분 staleTime(DAR-420 의도적 정책)',
  /staleTime:\s*1000\s*\*\s*60\s*\*\s*5\b/.test(todayBody),
);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
