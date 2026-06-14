/**
 * DAR-263 결정론적 검증: useCompanyDetail staleTime 30분.
 *
 * 종전 hooks/useCompanyDetail.ts 는 staleTime 미설정 → React Query 전역 기본값
 * (staleTime 0)이 적용돼, 기업 메타(법인명·업종·종목코드)가 거의 불변임에도
 * 종목상세 재진입(새 옵저버 마운트)마다 stale 판정 → 즉시 재요청이 발생했다.
 * 타 훅(marketIndices·search·eventStudy 등)은 staleTime 을 의도적으로 설정했는데
 * 기업상세만 누락된 상태였다.
 *
 * 해결: staleTime: 1000 * 60 * 30 (30분) 추가.
 *
 * 본 체크는 React Query QueryClient 의 fetchQuery 디듀프 의미론으로 동작을 재현한다.
 *   - fresh(staleTime 내) 데이터는 재요청하지 않는다 → queryFn 1회만 실행.
 *   - 대조군(staleTime 0, 옛 동작)은 같은 키를 다시 fetch 하면 queryFn 재실행.
 * 즉 "재진입 시 불필요 재요청 없음"(DoD)을 양/음성 대조로 단언한다.
 * 더해 실제 훅 소스가 1000*60*30 을 사용하는지 정적으로 확인한다.
 *
 * 실행: npx tsx scripts/check-company-detail-staletime.ts  (실패 시 exit 1)
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

// 동일 키를 두 번 fetch 했을 때 queryFn 실행 횟수를 센다.
// (재진입 = 같은 키의 새 fetch 요청 시뮬레이션)
async function countFetches(staleTime: number): Promise<number> {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  let calls = 0;
  const queryFn = async () => {
    calls += 1;
    return { corpCode: '00126380', corpName: '삼성전자' };
  };
  await client.fetchQuery({ queryKey: ['company', '00126380'], queryFn, staleTime });
  // 두 번째 진입: 캐시가 fresh 면 재실행 안 함.
  await client.fetchQuery({ queryKey: ['company', '00126380'], queryFn, staleTime });
  client.clear();
  return calls;
}

const STALE_30M = 1000 * 60 * 30;

async function main() {
  console.log('DAR-263 useCompanyDetail staleTime 30분');

  // 1) 신규 동작: staleTime 30분 → 재진입 시 재요청 없음 (queryFn 1회)
  const freshCalls = await countFetches(STALE_30M);
  assert('staleTime 30분: 재진입 시 재요청 없음 (queryFn 1회)', freshCalls === 1, `(got ${freshCalls})`);

  // 2) 대조군(옛 동작): staleTime 0 → 재진입마다 재요청 (queryFn 2회)
  const staleCalls = await countFetches(0);
  assert('대조군 staleTime 0: 재진입 시 재요청 발생 (queryFn 2회)', staleCalls === 2, `(got ${staleCalls})`);

  // 3) 정적 확인: 실제 훅이 1000*60*30 staleTime 을 사용 (scripts/ 기준 ../hooks)
  const src = readFileSync(join(__dirname, '..', 'hooks', 'useCompanyDetail.ts'), 'utf8');
  assert('훅 소스에 staleTime: 1000 * 60 * 30 존재', /staleTime:\s*1000\s*\*\s*60\s*\*\s*30/.test(src));
  assert('상수 값이 30분(1,800,000ms)', STALE_30M === 1_800_000, `(got ${STALE_30M})`);

  if (failures > 0) {
    console.error(`\n${failures}개 실패`);
    process.exit(1);
  }
  console.log('\n4/4 통과');
}

main();
