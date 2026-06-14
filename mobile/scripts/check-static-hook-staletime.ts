/**
 * DAR-275 결정론적 검증: 정적 기업데이터 hook staleTime 30분 일관성.
 *
 * 배경: 전역 기본 staleTime=5분(services/queryClient.ts)이라 미설정 hook 은 5분 상속.
 * DAR-263 이 useCompanyDetail 을 30분으로 상향했으나, 같은 기업상세 화면에서
 * 더(또는 동등하게) 정적인 아래 hook 들은 5분에 머물러 정책이 불일치했다:
 *   - hooks/useFinancials.ts        재무제표(분기 1회 갱신 — 가장 정적)
 *   - hooks/useEventStudy.ts        3쿼리(과거 이벤트 통계 — 산출 후 사실상 불변)
 *   - hooks/useInsiderHoldings.ts   내부자/대량보유(공시 기반 저빈도)
 *
 * 해결: 세 hook 의 useQuery/useInfiniteQuery 에 staleTime 1000*60*30(30분) 명시
 *   (useEventStudy 는 3쿼리 모두). 기업메타(useCompanyDetail 30분)와 동일 정책 정렬.
 *
 * 이 스크립트가 검증하는 것:
 *  (A) 세 hook 소스에 staleTime: 1000*60*30 이 기대 횟수만큼 존재(파일별 쿼리 수)
 *  (B) 기존 동작 키(enabled·queryKey)가 보존되어 회귀가 없음
 *  (C) 동작: staleTime 30분이면 재진입(같은 키 재fetch) 시 재요청이 없음을
 *      QueryClient.fetchQuery 디듀프로 양/음성 대조 단언
 *
 * 실행: npx tsx scripts/check-static-hook-staletime.ts  (실패 시 exit 1)
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { QueryClient } from '@tanstack/react-query';

let failures = 0;
function assert(name: string, cond: boolean, detail = '') {
  if (cond) {
    console.log(`  ✓ ${name}`);
  } else {
    failures += 1;
    console.error(`  ✗ ${name} ${detail}`);
  }
}

const STALE_30M = 1000 * 60 * 30;
const STALE_RE = /staleTime:\s*1000\s*\*\s*60\s*\*\s*30/g;

function read(file: string): string {
  return readFileSync(join(__dirname, '..', 'hooks', file), 'utf8');
}

// 같은 키를 두 번 fetch 했을 때 queryFn 실행 횟수(재진입 = 같은 키의 새 fetch).
async function countFetches(staleTime: number): Promise<number> {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  let calls = 0;
  const queryFn = async () => {
    calls += 1;
    return { ok: true };
  };
  await client.fetchQuery({ queryKey: ['static', 'k'], queryFn, staleTime });
  await client.fetchQuery({ queryKey: ['static', 'k'], queryFn, staleTime });
  client.clear();
  return calls;
}

async function main() {
  console.log('DAR-275 정적 기업데이터 hook staleTime 30분 일관성');

  // ── (A) 파일별 staleTime 30분 명시 횟수 ────────────────────────────────
  const cases: Array<{ file: string; expected: number }> = [
    { file: 'useFinancials.ts', expected: 1 },
    { file: 'useEventStudy.ts', expected: 3 }, // 3쿼리 모두
    { file: 'useInsiderHoldings.ts', expected: 1 },
  ];
  for (const { file, expected } of cases) {
    const src = read(file);
    const hits = (src.match(STALE_RE) ?? []).length;
    assert(`${file}: staleTime 1000*60*30 ×${expected}`, hits === expected, `(got ${hits})`);
  }
  assert('상수 값이 30분(1,800,000ms)', STALE_30M === 1_800_000, `(got ${STALE_30M})`);

  // ── (B) 기존 동작 키 보존(회귀 가드) ───────────────────────────────────
  const fin = read('useFinancials.ts');
  assert('useFinancials queryKey 보존', /queryKey:\s*\['financials', corpCode, fsDiv \?\? 'CFS'\]/.test(fin));
  assert('useFinancials enabled 보존', /enabled:\s*Boolean\(corpCode\)/.test(fin));

  const es = read('useEventStudy.ts');
  assert('useEventStudy company queryKey 보존', /\['event-study', 'company', corpCode, eventType, marketType\]/.test(es));
  assert('useEventStudy results queryKey 보존', /\['event-study', eventType, marketType\]/.test(es));
  assert('useEventStudy observations queryKey 보존', /\['event-study', 'observations', bucketKey\]/.test(es));
  assert('useEventStudy observations enabled 보존', /enabled:\s*Boolean\(bucketKey\) && enabled/.test(es));
  assert('useEventStudy getNextPageParam 보존', /getNextPageParam:/.test(es));

  const ins = read('useInsiderHoldings.ts');
  assert('useInsiderHoldings queryKey 보존', /\['insider-holdings', 'company', corpCode, query\]/.test(ins));
  assert('useInsiderHoldings enabled 보존', /enabled:\s*Boolean\(corpCode\)/.test(ins));

  // ── (C) 동작: 30분이면 재진입 시 재요청 없음, 0이면 매번 재요청 ────────
  const freshCalls = await countFetches(STALE_30M);
  assert('staleTime 30분: 재진입 시 재요청 없음 (queryFn 1회)', freshCalls === 1, `(got ${freshCalls})`);
  const staleCalls = await countFetches(0);
  assert('대조군 staleTime 0: 재진입 시 재요청 발생 (queryFn 2회)', staleCalls === 2, `(got ${staleCalls})`);

  if (failures > 0) {
    console.error(`\n${failures}개 실패`);
    process.exit(1);
  }
  console.log('\n전수 통과');
}

main();
