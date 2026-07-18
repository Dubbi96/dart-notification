/**
 * DAR-560/R-21 결정론적 검증: "스켈레톤은 에러·pause 폴백 의무" —
 *   상세 화면 스켈레톤(DetailSkeleton)은 10초 무기한 로딩 시 재시도 오버레이로 자동 전환해야
 *   하고, 그러려면 모든 콜사이트가 onRetry 를 넘겨야 한다. 종전(DAR-560 이전)엔 onRetry 가
 *   없어 company/[corpCode].tsx 가 RQ v5 pause 상태에서 재시도 동선 없는 데드엔드로 낙하했다.
 *
 * 이 스크립트가 검증하는 것 (순수 소스 바인딩 — RN 런타임/네이티브 불요):
 *   (A) SkeletonCard.tsx: 공유 워치독 훅(useSkeletonWatchdog)과 폴백(SkeletonWatchdogFallback) 존재.
 *   (B) DetailSkeleton.tsx: onRetry 가 필수 prop(옵셔널 `?` 아님) + 워치독 배선.
 *   (C) 앱 전역의 모든 `<DetailSkeleton` 콜사이트가 onRetry prop을 전달한다(회귀 가드 — 신규
 *       콜사이트 추가 시 tsc 없이도 이 스캐너로 즉시 잡힌다).
 *   (D) company/[corpCode].tsx: 근본원인 화면 — isPaused 구독으로 무기한 pause 데드엔드 해소 +
 *       '미존재' 문구가 서버 404 조건부(무조건 노출 금지) + isError 폴백(ApiErrorState) 유지.
 *
 * 실행: npx tsx scripts/check-skeleton-error-fallback.ts  (실패 시 exit 1)
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

// check-design-rules.ts 의 walk 패턴 재사용 — app/·components/ 하위 .tsx 전체 재귀 수집.
function walkTsx(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    const st = statSync(p);
    if (st.isDirectory()) {
      if (entry === 'node_modules' || entry === '__tests__') continue;
      walkTsx(p, out);
    } else if (/\.tsx$/.test(entry)) {
      out.push(p);
    }
  }
  return out;
}

let failed = 0;
function check(label: string, ok: boolean, detail = ''): void {
  if (!ok) failed += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'} | ${label}${detail ? ' | ' + detail : ''}`);
}

const read = (p: string) => readFileSync(join(root, p), 'utf8');

// ── (A) 공유 워치독 훅/폴백 컴포넌트 존재 ────────────────────────────────────
const SKELETON_CARD = read('components/common/SkeletonCard.tsx');
check(
  'SkeletonCard: useSkeletonWatchdog export',
  /export function useSkeletonWatchdog\(/.test(SKELETON_CARD),
);
check(
  'SkeletonCard: SkeletonWatchdogFallback export',
  /export function SkeletonWatchdogFallback\(/.test(SKELETON_CARD),
);
check(
  'SkeletonList: onRetry 옵셔널 prop + 워치독 배선',
  /onRetry\?:\s*\(\)\s*=>\s*void/.test(SKELETON_CARD) &&
    /useSkeletonWatchdog\(onRetry\)/.test(SKELETON_CARD),
);

// ── (B) DetailSkeleton: onRetry 필수 + 워치독 배선 ──────────────────────────
const DETAIL_SKEL = read('components/common/DetailSkeleton.tsx');
check(
  'DetailSkeleton: onRetry 필수 prop(옵셔널 아님)',
  /onRetry:\s*\(\)\s*=>\s*void/.test(DETAIL_SKEL) && !/onRetry\?:/.test(DETAIL_SKEL),
);
check(
  'DetailSkeleton: 워치독 훅 사용 + 만료 시 폴백 렌더',
  /useSkeletonWatchdog\(onRetry\)/.test(DETAIL_SKEL) &&
    /<SkeletonWatchdogFallback onRetry=\{onRetry\}\s*\/>/.test(DETAIL_SKEL),
);

// ── (C) 전역 콜사이트 회귀 가드: 모든 <DetailSkeleton 이 onRetry 를 전달 ──────
const candidateFiles = [...walkTsx(join(root, 'app')), ...walkTsx(join(root, 'components'))]
  .map((p) => relative(root, p))
  .filter((f) => f !== 'components/common/DetailSkeleton.tsx');

let callSiteCount = 0;
for (const file of candidateFiles) {
  const src = read(file);
  const matches = src.match(/<DetailSkeleton\b[\s\S]*?\/>/g);
  if (!matches) continue;
  for (const tag of matches) {
    callSiteCount += 1;
    check(`${file}: <DetailSkeleton> onRetry 전달`, /onRetry=/.test(tag));
  }
}
check('회귀 가드: DetailSkeleton 콜사이트 최소 1건 스캔됨', callSiteCount > 0, `${callSiteCount}건`);

// ── (D) 근본원인 화면 — company/[corpCode].tsx ──────────────────────────────
const COMPANY_DETAIL = read('app/company/[corpCode].tsx');
check(
  'company/[corpCode]: useCompanyDetail 에서 isPaused 구독',
  /isPaused:\s*isCompanyPaused/.test(COMPANY_DETAIL),
);
check(
  'company/[corpCode]: isPaused 데드엔드 분기 + 재시도 동선',
  /isCompanyPaused && !company/.test(COMPANY_DETAIL) &&
    /네트워크 대기 중/.test(COMPANY_DETAIL),
);
check(
  "company/[corpCode]: '미존재' 문구는 404 조건부(무조건 노출 금지)",
  /isConfirmedNotFound/.test(COMPANY_DETAIL) &&
    /isConfirmedNotFound \? \(/.test(COMPANY_DETAIL),
);
check('company/[corpCode]: ApiErrorState(에러 동선) 유지', /<ApiErrorState/.test(COMPANY_DETAIL));
check(
  'company/[corpCode]: 로딩/에러/pause 헤더 placeholder 타이틀 공유',
  /COMPANY_DETAIL_PLACEHOLDER_TITLE = '종목 상세'/.test(COMPANY_DETAIL),
);

console.log(`\n스캔: app/·components/ 하위 ${candidateFiles.length}개 파일, DetailSkeleton 콜사이트 ${callSiteCount}건`);
console.log(failed === 0 ? '\nALL PASS' : `\n${failed} FAILED`);
process.exit(failed === 0 ? 0 : 1);
