/**
 * DAR-277 결정론적 검증: 콘텐츠 화면 2곳의 초기 로딩을 중앙 ActivityIndicator →
 *   DAR-147 스켈레톤(DetailSkeleton·SkeletonList)으로 정렬.
 *
 * 종전:
 *   - app/disclosure/[id].tsx isLoading 분기가 loadingContainer + 중앙 ActivityIndicator.
 *   - app/(tabs)/notifications/index.tsx 초기 로딩(isLoading)이 loadingContainer + 중앙 ActivityIndicator.
 * 둘 다 DAR-147이 상세/리스트 로딩에서 대체하기로 한 패턴이다. 다른 화면
 * (home·signals·search·portfolio·disclosures·SignalExplorer)은 이미 스켈레톤 적용.
 *
 * 해결:
 *   (1) disclosure/[id].tsx isLoading 분기 → <DetailSkeleton/> (헤더 유지).
 *   (2) notifications/index.tsx 초기 로딩 → <SkeletonList variant="disclosure"/> (헤더 유지).
 *   에러/빈상태 분기(ApiErrorState·EmptyState)는 불변.
 *
 * 이 스크립트가 검증하는 것 (순수 소스 바인딩 — RN 런타임/네이티브 불요):
 *   (A) 두 파일에 중앙 스피너 패턴(loadingContainer + ActivityIndicator) 잔존 0.
 *   (B) disclosure: DetailSkeleton import + isLoading 분기에서 렌더.
 *   (C) notifications: SkeletonList import + isLoading 분기에서 variant="disclosure" 렌더.
 *   (D) 회귀 가드: 에러/빈상태 동선(ApiErrorState·EmptyState) 불변.
 *   (E) 회귀 가드: notifications 페이지네이션 푸터의 ActivityIndicator(footerLoading)는 유지.
 *
 * 실행: npx tsx scripts/check-loading-skeleton.ts  (실패 시 exit 1)
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

let failed = 0;
function check(label: string, ok: boolean, detail = ''): void {
  if (!ok) failed += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'} | ${label}${detail ? ' | ' + detail : ''}`);
}

const DISCLOSURE = readFileSync(join(root, 'app/disclosure/[id].tsx'), 'utf8');
const NOTIFICATIONS = readFileSync(join(root, 'app/(tabs)/notifications/index.tsx'), 'utf8');

// ── (A) 중앙 스피너 패턴 제거 ────────────────────────────────────────────────
// loadingContainer 스타일과 그 위의 ActivityIndicator 조합이 두 파일에서 사라졌어야 한다.
check('disclosure: loadingContainer 스타일 제거', !/loadingContainer/.test(DISCLOSURE));
check('disclosure: ActivityIndicator import 제거(상세는 더 이상 미사용)', !/ActivityIndicator/.test(DISCLOSURE));
check('notifications: loadingContainer 스타일 제거', !/loadingContainer/.test(NOTIFICATIONS));

// ── (B) disclosure 상세 — DetailSkeleton ────────────────────────────────────
check(
  'disclosure: DetailSkeleton import',
  /import\s*\{\s*DetailSkeleton\s*\}\s*from\s*'@components\/common\/DetailSkeleton'/.test(DISCLOSURE),
);
check(
  'disclosure: isLoading 분기에서 <DetailSkeleton cards={...}/> 렌더',
  /\{isLoading \? \([\s\S]*?<DetailSkeleton[\s\S]*?cards=\{/.test(DISCLOSURE),
);

// ── (C) notifications 리스트 — SkeletonList ─────────────────────────────────
check(
  'notifications: SkeletonList import',
  /import\s*\{\s*SkeletonList\s*\}\s*from\s*'@components\/common\/SkeletonCard'/.test(NOTIFICATIONS),
);
check(
  'notifications: isLoading 분기에서 <SkeletonList variant="disclosure"/> 렌더',
  /if \(isLoading\) \{[\s\S]*?<SkeletonList variant="disclosure"\s*\/>[\s\S]*?\}/.test(NOTIFICATIONS),
);

// ── (D) 회귀 가드: 에러/빈상태 동선 불변 ─────────────────────────────────────
check('disclosure: ApiErrorState(에러 동선) 유지', /<ApiErrorState/.test(DISCLOSURE));
check('disclosure: EmptyState(빈상태 동선) 유지', /<EmptyState/.test(DISCLOSURE));
check('notifications: ApiErrorState(에러 동선) 유지', /<ApiErrorState/.test(NOTIFICATIONS));
check('notifications: EmptyState(빈상태 동선) 유지', /<EmptyState/.test(NOTIFICATIONS));

// ── (E) 회귀 가드: 페이지네이션 푸터 스피너는 유지 ───────────────────────────
// 무한스크롤 다음 페이지 로딩 인디케이터(footerLoading)는 인라인 적합 패턴이라 보존.
check(
  'notifications: footerLoading 페이지네이션 ActivityIndicator 유지',
  /footerLoading[\s\S]*?<ActivityIndicator size="small"/.test(NOTIFICATIONS) ||
    /isFetchingNextPage \? \([\s\S]*?<ActivityIndicator/.test(NOTIFICATIONS),
);
check(
  'notifications: ActivityIndicator import 유지(푸터에서 사용)',
  /ActivityIndicator/.test(NOTIFICATIONS),
);

// ── 음성 대조: 정본 스켈레톤 컴포넌트가 progressbar 접근성을 갖는지 ───────────
// DetailSkeleton/SkeletonList 둘 다 accessibilityRole="progressbar"로 로딩을 알린다(§2-3).
const DETAIL_SKEL = readFileSync(join(root, 'components/common/DetailSkeleton.tsx'), 'utf8');
const SKEL_CARD = readFileSync(join(root, 'components/common/SkeletonCard.tsx'), 'utf8');
check('DetailSkeleton: progressbar 접근성', /accessibilityRole="progressbar"/.test(DETAIL_SKEL));
check('SkeletonList: progressbar 접근성', /accessibilityRole="progressbar"/.test(SKEL_CARD));

console.log(failed === 0 ? '\nALL PASS' : `\n${failed} FAILED`);
process.exit(failed === 0 ? 0 : 1);
