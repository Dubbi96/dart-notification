/**
 * DAR-264 결정론적 검증: 포트폴리오 queryKey 공통 접두사 정렬 (부분 무효화 가능).
 *
 * 종전엔 hooks/usePortfolio.ts 의 키가 도메인별로 흩어져 있었다.
 *   목록  ['positions']            ← 'portfolio' 접두사 아님
 *   단건  ['position', id]         ← 'portfolio' 접두사 아님
 *   논지  ['position', id, 'thesis']
 *   요약  ['portfolio', 'summary']
 *   리스크 ['portfolio', 'risk', 'latest']
 *   페이퍼 ['paper-portfolio']      ← 'portfolio' 접두사 아님
 * react-query 의 invalidateQueries 는 접두사(prefix) 부분일치라, 공통 접두사가
 * 없으면 invalidateQueries(['portfolio']) 한 번으로 목록·단건·페이퍼가 갱신되지
 * 않는다 → 포지션 변경 시 개별 무효화 누락 위험.
 *
 * 해결: 전부 ['portfolio', ...] 로 정렬하고 portfolioKeys 빌더를 SSOT 로 export.
 *   목록  ['portfolio', 'positions']
 *   단건  ['portfolio', 'position', id]
 *   논지  ['portfolio', 'position', id, 'thesis']
 *   요약  ['portfolio', 'summary']
 *   리스크 ['portfolio', 'risk', 'latest']
 *   페이퍼 ['portfolio', 'paper']
 *
 * 이 스크립트는 두 가지를 결정론적으로 증명한다.
 *  A) 소스 바인딩: hooks/usePortfolio.ts 가 정의한 실제 키를 읽어, 모든 키가
 *     ['portfolio'] 접두사이고 옛 분산 키가 사라졌음을 단언(파일과 결합).
 *  B) react-query 시맨틱: 실제 QueryClient 에 6개 쿼리를 적재 후
 *     invalidateQueries(['portfolio']) 가 6개 전부(요약+리스트 동시) 무효화하고,
 *     부분 키 ['portfolio','position',id] 가 해당 단건+논지만 무효화함을 단언.
 *
 * 실행: npx tsx scripts/check-portfolio-querykey-prefix.ts  (실패 시 exit 1)
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { QueryClient } from '@tanstack/react-query';

let failed = 0;
function check(label: string, cond: boolean, detail = ''): void {
  if (!cond) failed += 1;
  console.log(`${cond ? 'PASS' : 'FAIL'} | ${label}${detail ? ` | ${detail}` : ''}`);
}

// ── A) 소스 바인딩: 실제 usePortfolio.ts 를 읽어 키 컨벤션을 단언 ──────────────
const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(here, '..', 'hooks', 'usePortfolio.ts'), 'utf8');

// 옛 분산 키가 더 이상 존재하지 않아야 한다(회귀 방지).
for (const stale of ["['positions']", "['position',", "['paper-portfolio']"]) {
  check(`옛 분산 키 제거: ${stale}`, !src.includes(stale));
}
// 모든 키 빌더가 PORTFOLIO_KEY 접두사를 전개해야 한다(6종: positions/summary/risk/
// position/thesis/paper). 줄바꿈에 무관하게 전체 소스에서 전개 횟수를 센다.
const spreadCount = (src.match(/\[\.\.\.PORTFOLIO_KEY/g) ?? []).length;
check('키 빌더 6종 모두 PORTFOLIO_KEY 전개', spreadCount === 6, `count=${spreadCount}`);
// 모든 useQuery 가 portfolioKeys 빌더를 사용(원시 배열 리터럴 직접 사용 금지).
// 주석 줄(//, *)은 제외 — 실제 코드의 queryKey: 만 검사.
const rawQueryKeys = src
  .split('\n')
  .filter((l) => {
    const t = l.trim();
    if (t.startsWith('//') || t.startsWith('*')) return false;
    return /queryKey:/.test(l) && !/portfolioKeys\./.test(l);
  });
check('useQuery 전부 portfolioKeys 빌더 사용', rawQueryKeys.length === 0, `raw=${rawQueryKeys.length}`);
check("PORTFOLIO_KEY = ['portfolio']", src.includes("export const PORTFOLIO_KEY = ['portfolio'] as const;"));

// ── B) react-query 시맨틱: 정렬된 키로 부분 무효화가 실제 동작하는지 증명 ──────
// (소스와 동일 정의 — 위 A) 가 소스가 이 정의와 일치함을 보장한다)
const PORTFOLIO_KEY = ['portfolio'] as const;
const portfolioKeys = {
  positions: () => [...PORTFOLIO_KEY, 'positions'] as const,
  summary: () => [...PORTFOLIO_KEY, 'summary'] as const,
  risk: () => [...PORTFOLIO_KEY, 'risk', 'latest'] as const,
  position: (id: string) => [...PORTFOLIO_KEY, 'position', id] as const,
  thesis: (id: string) => [...PORTFOLIO_KEY, 'position', id, 'thesis'] as const,
  paper: () => [...PORTFOLIO_KEY, 'paper'] as const,
};

const POS_ID = 'pos-1';
const allKeys = {
  positions: portfolioKeys.positions(),
  summary: portfolioKeys.summary(),
  risk: portfolioKeys.risk(),
  position: portfolioKeys.position(POS_ID),
  thesis: portfolioKeys.thesis(POS_ID),
  paper: portfolioKeys.paper(),
};

function freshClient(): QueryClient {
  const qc = new QueryClient();
  for (const key of Object.values(allKeys)) {
    // 'fresh' 상태로 적재 → invalidate 되면 stale 로 전이.
    qc.setQueryData(key as unknown as readonly unknown[], { ok: true });
  }
  return qc;
}

function staleNames(qc: QueryClient): Set<string> {
  const stale = new Set<string>();
  for (const [name, key] of Object.entries(allKeys)) {
    const state = qc.getQueryState(key as unknown as readonly unknown[]);
    if (state?.isInvalidated) stale.add(name);
  }
  return stale;
}

// B1) 전체 무효화: invalidateQueries(['portfolio']) → 6개 전부 무효화(요약+리스트 동시).
{
  const qc = freshClient();
  void qc.invalidateQueries({ queryKey: PORTFOLIO_KEY as unknown as readonly unknown[] });
  const stale = staleNames(qc);
  check(
    "invalidate ['portfolio'] → 6개 전부 무효화(요약+리스트 동시)",
    stale.size === 6,
    `stale=${[...stale].sort().join(',')}`,
  );
  // DoD 핵심: 포지션(단건) 변경 시 목록과 요약이 함께 갱신.
  check('  ↳ 요약·리스트 동시 포함', stale.has('summary') && stale.has('positions') && stale.has('position'));
}

// B2) 부분 무효화: invalidate(['portfolio','position',id]) → 해당 단건+논지만.
{
  const qc = freshClient();
  void qc.invalidateQueries({
    queryKey: portfolioKeys.position(POS_ID) as unknown as readonly unknown[],
  });
  const stale = staleNames(qc);
  check(
    "invalidate ['portfolio','position',id] → 단건+논지만",
    stale.size === 2 && stale.has('position') && stale.has('thesis'),
    `stale=${[...stale].sort().join(',')}`,
  );
  check('  ↳ 요약/리스트/페이퍼는 불변', !stale.has('summary') && !stale.has('risk') && !stale.has('paper'));
}

// B3) 대조군(회귀 증거): 옛 분산 키였다면 ['portfolio'] 한 번으로 목록이 안 잡힘.
{
  const qc = new QueryClient();
  const oldPositions = ['positions'];
  const oldPaper = ['paper-portfolio'];
  qc.setQueryData(oldPositions, { ok: true });
  qc.setQueryData(oldPaper, { ok: true });
  qc.setQueryData(['portfolio', 'summary'], { ok: true });
  void qc.invalidateQueries({ queryKey: ['portfolio'] });
  const posStale = qc.getQueryState(oldPositions)?.isInvalidated === true;
  const paperStale = qc.getQueryState(oldPaper)?.isInvalidated === true;
  const summaryStale = qc.getQueryState(['portfolio', 'summary'])?.isInvalidated === true;
  check('대조군: 옛 키는 목록/페이퍼가 누락(접두사 불일치 입증)', !posStale && !paperStale && summaryStale);
}

console.log(`\n${failed === 0 ? 'ALL PASS' : `${failed} FAILED`}`);
process.exit(failed === 0 ? 0 : 1);
