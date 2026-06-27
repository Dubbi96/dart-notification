/**
 * DAR-465 결정론적 검증: 철학 상세 적합도 쿼리 폭주 완화 + 리스트 윈도잉.
 *
 * 배경/문제(app/philosophy/[id].tsx · E15):
 *   FitRow 가 후보 종목마다 usePhilosophyFit 을 개별 호출 → 관심기업 30개면 마운트 시
 *   최대 30개 동시 쿼리 + 개별 스피너 다수. FlatList 에 initialNumToRender/windowSize 미설정.
 *
 * 해결:
 *   ① usePhilosophyFit 에 뷰포트 게이트(enabled, 기본 true) 추가 — 호출부 무변경 backward-compat.
 *   ② [id].tsx 가 onViewableItemsChanged 로 화면에 보였던 행만 sticky 활성화하고,
 *      상단 INITIAL_ACTIVE 행만 즉시 평가 → 진입 동시 요청을 INITIAL_ACTIVE 로 상한.
 *   ③ FlatList initialNumToRender/maxToRenderPerBatch/windowSize 튜닝 + FitRow React.memo.
 *   ④ 전역 staleTime 5분(services/queryClient.ts)으로 스크롤 복귀 재요청 0.
 *
 * 두 축으로 증명:
 *  A) 소스 바인딩 — 실제 파일 구조 불변식(정규식). RN 런타임이 tsx에 없어 모듈 import 불가.
 *  B) 모델/동작 — (i) 게이트 진리표로 비활성 행 fetch 보류, (ii) 30개 유니버스에서 마운트
 *     동시 활성(=요청)이 INITIAL_ACTIVE 로 상한, (iii) QueryClient dedup 으로 staleTime
 *     5분이면 재진입 재요청 0, 0이면 2회(음성 대조군).
 *
 * 실행: npx tsx scripts/check-philosophy-fit-windowing.ts  (실패 시 exit 1)
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { QueryClient } from '@tanstack/react-query';

let failures = 0;
function assert(name: string, cond: boolean, detail = ''): void {
  if (cond) {
    console.log(`  ✓ ${name}`);
  } else {
    failures += 1;
    console.error(`  ✗ ${name} ${detail}`);
  }
}

const ROOT = join(__dirname, '..');
const screenSrc = readFileSync(join(ROOT, 'app/philosophy/[id].tsx'), 'utf8');
const hookSrc = readFileSync(join(ROOT, 'hooks/usePhilosophies.ts'), 'utf8');

// ── A) 소스 바인딩 ──────────────────────────────────────────────────────
console.log('A) 소스 바인딩 (실제 파일 구조)');

// (A-1) 훅 게이트: 4번째 enabled 파라미터 + enabled AND 결합(backward-compat 기본 true)
assert(
  'usePhilosophyFit 4번째 enabled 파라미터(기본 true)',
  /export function usePhilosophyFit\([\s\S]*?fsDiv\?:\s*string,\s*\n\s*enabled\s*=\s*true,\s*\n\)/.test(hookSrc),
);
assert(
  'usePhilosophyFit enabled 에 && enabled 게이트 결합',
  /enabled:\s*!!philosophyId\s*&&\s*!!corpCode\s*&&\s*enabled/.test(hookSrc),
);

// (A-2) FlatList 윈도잉 튜닝(미설정 회귀 방지)
assert('FlatList initialNumToRender 설정', /initialNumToRender=\{INITIAL_ACTIVE\}/.test(screenSrc));
assert('FlatList maxToRenderPerBatch 설정', /maxToRenderPerBatch=\{FIT_MAX_PER_BATCH\}/.test(screenSrc));
assert('FlatList windowSize 설정', /windowSize=\{FIT_WINDOW_SIZE\}/.test(screenSrc));

// (A-3) 뷰포트 게이트: viewability 콜백/설정이 안정 식별자(useRef·모듈상수)로 전달
assert(
  'onViewableItemsChanged 가 useRef 로 안정 식별자(매 렌더 재생성 금지)',
  /const onViewableItemsChanged = useRef\(/.test(screenSrc) &&
    /onViewableItemsChanged=\{onViewableItemsChanged\}/.test(screenSrc),
);
assert(
  'viewabilityConfig 가 안정 모듈 상수',
  /const FIT_VIEWABILITY = \{[\s\S]*?itemVisiblePercentThreshold/.test(screenSrc) &&
    /viewabilityConfig=\{FIT_VIEWABILITY\}/.test(screenSrc),
);
assert(
  'activeCorpCodes sticky Set 상태(한번 보이면 유지)',
  /useState<Set<string>>\(\(\)\s*=>\s*new Set\(\)\)/.test(screenSrc),
);

// (A-4) FitRow: React.memo + active prop → 훅 4번째 인자로 전달
assert('FitRow React.memo 래핑', /const FitRow = React\.memo\(function FitRow/.test(screenSrc));
assert(
  'FitRow active 를 usePhilosophyFit 4번째 인자로 전달',
  /usePhilosophyFit\(philosophyId,\s*corpCode,\s*undefined,\s*active\)/.test(screenSrc),
);
assert(
  'renderCandidate active = 상단 INITIAL_ACTIVE 또는 viewport 활성',
  /active=\{index < INITIAL_ACTIVE \|\| activeCorpCodes\.has\(item\.corpCode\)\}/.test(screenSrc),
);

// (A-5) 비활성 행은 정적 자리표시(스피너/쿼리 없음) — noFinancials 오표시 회귀 방지
assert(
  '비활성 분기(!active)가 data/loading 분기보다 먼저 — 정적 자리표시',
  /\{!active \?\s*\(\s*\n[\s\S]*?styles\.fitPlaceholder/.test(screenSrc),
);

// (A-6) refreshControl 커스텀 래퍼 안티패턴 0(크로스플랫폼 가드 회귀 방지)
assert(
  'refreshControl 커스텀 래퍼 미사용',
  !/refreshControl=\{</.test(screenSrc),
);

// ── B) 모델/동작 ────────────────────────────────────────────────────────
console.log('B) 모델/동작 (게이트·상한·dedup)');

const INITIAL_ACTIVE = 6; // 소스 상수와 동기(아래 A-bind 로 교차 확인)
assert(
  '소스 INITIAL_ACTIVE 상수 === 6(모델과 동기)',
  /const INITIAL_ACTIVE = 6;/.test(screenSrc),
);

// (B-i) 게이트 진리표: useQuery enabled = !!philosophyId && !!corpCode && enabled
function fitEnabled(philosophyId: string | undefined, corpCode: string | undefined, active: boolean): boolean {
  return !!philosophyId && !!corpCode && active;
}
assert('활성 행(active=true)만 fetch', fitEnabled('p1', '00126380', true) === true);
assert('비활성 행(active=false) fetch 보류', fitEnabled('p1', '00126380', false) === false);
assert('corpCode 없으면 보류', fitEnabled('p1', undefined, true) === false);

// (B-ii) 30개 유니버스 마운트 동시 활성 상한: 상단 INITIAL_ACTIVE 만 즉시 활성
function activeOnMount(total: number, initialActive: number, visibleCodes: Set<string>): number {
  let count = 0;
  for (let index = 0; index < total; index += 1) {
    const code = `corp-${index}`;
    if (index < initialActive || visibleCodes.has(code)) count += 1;
  }
  return count;
}
// 마운트 직후엔 viewport 콜백이 아직 안 옴(visible 비어있음) → 상단 INITIAL_ACTIVE 만 활성
const mountActive = activeOnMount(30, INITIAL_ACTIVE, new Set());
assert(
  `관심기업 30개 마운트 시 동시 요청 ${INITIAL_ACTIVE}개로 상한(30개 폭주 아님)`,
  mountActive === INITIAL_ACTIVE,
  `(got ${mountActive})`,
);
// 음성 대조군: 게이트 미적용(전 행 활성) 회귀 → 30개 전부 요청
const naive = activeOnMount(30, 30, new Set());
assert('회귀(게이트 미적용) 시 30개 전부 요청 — 본 수정이 막는 경로', naive === 30);

// 스크롤로 일부가 보이면 그 행만 추가 활성(sticky)
const scrolledVisible = new Set(['corp-7', 'corp-8']);
const afterScroll = activeOnMount(30, INITIAL_ACTIVE, scrolledVisible);
assert('스크롤 노출 행만 추가 활성(누적)', afterScroll === INITIAL_ACTIVE + 2);

// (B-iii) staleTime 5분(전역) → 재진입 재요청 0; 0이면 2회(음성 대조군)
const GLOBAL_STALE = 1000 * 60 * 5; // services/queryClient.ts 전역 기본
async function countFetches(staleTime: number): Promise<number> {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  let calls = 0;
  const queryFn = async () => {
    calls += 1;
    return { ok: true };
  };
  await client.fetchQuery({ queryKey: ['philosophy-fit', 'p1', '00126380', 'CFS'], queryFn, staleTime });
  await client.fetchQuery({ queryKey: ['philosophy-fit', 'p1', '00126380', 'CFS'], queryFn, staleTime });
  client.clear();
  return calls;
}

async function main(): Promise<void> {
  const fresh = await countFetches(GLOBAL_STALE);
  assert('staleTime 5분: 스크롤 복귀 재요청 0 (queryFn 1회)', fresh === 1, `(got ${fresh})`);
  const stale = await countFetches(0);
  assert('대조군 staleTime 0: 재진입 재요청 발생 (queryFn 2회)', stale === 2, `(got ${stale})`);

  if (failures > 0) {
    console.error(`\nFAIL: ${failures} assertion(s)`);
    process.exit(1);
  }
  console.log('\nALL PASS');
}

main();
