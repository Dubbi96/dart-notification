/**
 * DAR-467 결정론적 검증: 기업 상세 탭 콘텐츠 로딩을 스켈레톤으로 통일(E17).
 *
 * 종전:
 *   - FundamentalsTab.tsx isLoading → 중앙 ActivityIndicator(LoadingState).
 *   - DecisionHubTab.tsx isLoading → 중앙 ActivityIndicator(LoadingState).
 *   - EventStudyObservationsDrilldown.tsx 펼침 직후 query.isLoading → 중앙 ActivityIndicator.
 * 같은 기업 상세에서 초기엔 DetailSkeleton(company/[corpCode].tsx), 탭 전환 시엔 중앙
 * 스피너가 섞여 로딩 인상 불일치·레이아웃 점프가 발생했다.
 *
 * 해결(이 이슈가 명시한 3개 컴포넌트 파일의 로딩 분기만 — company/[corpCode].tsx 본문
 * 구조는 분봉 이슈(DAR-452)와의 충돌을 피하기 위해 건드리지 않는다):
 *   (1) FundamentalsTab: isLoading → <DetailSkeleton cards={...}/> (3개 SectionCard 골격).
 *   (2) DecisionHubTab: isLoading → <DetailSkeleton cards={...}/> (판단 캔버스 누적 골격, gauge 포함).
 *   (3) EventStudyObservationsDrilldown: query.isLoading → <ObservationsSkeleton/> (obsRow 골격).
 *   에러/빈상태 분기(ErrorState·EmptyState)와 페이지네이션 푸터 스피너는 불변.
 *
 * 이 스크립트가 검증하는 것(순수 소스 바인딩 — RN 런타임/네이티브 불요):
 *   (A) 두 탭에서 LoadingState(중앙 스피너) 잔존 0.
 *   (B) 두 탭: DetailSkeleton import + isLoading 분기에서 cards={...} 렌더.
 *   (C) Drilldown: ObservationsSkeleton 정의 + query.isLoading 분기에서 렌더 + 펄스/SkeletonBar 재사용.
 *   (D) 회귀: 에러/빈상태 동선(ErrorState·EmptyState) 불변.
 *   (E) 회귀: Drilldown 페이지네이션 푸터의 ActivityIndicator는 유지.
 *   (F) 음성 대조: 정본 스켈레톤(DetailSkeleton·SkeletonCard)이 progressbar 접근성을 갖는다(§2-3).
 *
 * 실행: npx tsx scripts/check-tab-loading-skeleton.ts  (실패 시 exit 1)
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

const FUNDAMENTALS = readFileSync(join(root, 'components/company/FundamentalsTab.tsx'), 'utf8');
const DECISION = readFileSync(join(root, 'components/company/DecisionHubTab.tsx'), 'utf8');
const DRILLDOWN = readFileSync(
  join(root, 'components/company/EventStudyObservationsDrilldown.tsx'),
  'utf8',
);

// ── (A) 중앙 스피너(LoadingState) 제거 ──────────────────────────────────────
check('FundamentalsTab: LoadingState(중앙 스피너) 잔존 0', !/LoadingState/.test(FUNDAMENTALS));
check('DecisionHubTab: LoadingState(중앙 스피너) 잔존 0', !/LoadingState/.test(DECISION));

// ── (B) 두 탭 — DetailSkeleton ───────────────────────────────────────────────
check(
  'FundamentalsTab: DetailSkeleton import',
  /import\s*\{\s*DetailSkeleton\s*\}\s*from\s*'@components\/common\/DetailSkeleton'/.test(FUNDAMENTALS),
);
check(
  'FundamentalsTab: isLoading 분기에서 <DetailSkeleton cards={...}/> 렌더',
  /if \(isLoading\)[\s\S]*?<DetailSkeleton[\s\S]*?cards=\{/.test(FUNDAMENTALS),
);
check(
  'DecisionHubTab: DetailSkeleton import',
  /import\s*\{\s*DetailSkeleton\s*\}\s*from\s*'@components\/common\/DetailSkeleton'/.test(DECISION),
);
check(
  'DecisionHubTab: isLoading 분기에서 <DetailSkeleton cards={...}/> 렌더',
  /if \(isLoading\)[\s\S]*?<DetailSkeleton[\s\S]*?cards=\{/.test(DECISION),
);
check(
  'DecisionHubTab: 골격에 gauge 자리(BuyScore 게이지 흉내) 포함',
  /gauge:\s*true/.test(DECISION),
);

// ── (C) Drilldown — ObservationsSkeleton ─────────────────────────────────────
check(
  'Drilldown: SkeletonBar/useSkeletonPulse import(공통 펄스 재사용)',
  /import\s*\{\s*SkeletonBar,\s*useSkeletonPulse\s*\}\s*from\s*'@components\/common\/SkeletonCard'/.test(
    DRILLDOWN,
  ),
);
check(
  'Drilldown: ObservationsSkeleton 정의(useSkeletonPulse + SkeletonBar)',
  /function ObservationsSkeleton\(\)[\s\S]*?useSkeletonPulse\(\)[\s\S]*?<SkeletonBar/.test(DRILLDOWN),
);
check(
  'Drilldown: query.isLoading 분기에서 <ObservationsSkeleton/> 렌더',
  /query\.isLoading \? \(\s*<ObservationsSkeleton \/>/.test(DRILLDOWN),
);
check(
  'Drilldown: 스켈레톤 progressbar 접근성',
  /function ObservationsSkeleton\(\)[\s\S]*?accessibilityRole="progressbar"/.test(DRILLDOWN),
);
check(
  'Drilldown: 로딩 분기에 중앙 ActivityIndicator(styles.center) 패턴 잔존 0',
  !/query\.isLoading \? \(\s*<View style=\{styles\.center\}>\s*<ActivityIndicator/.test(DRILLDOWN),
);

// ── (D) 회귀 가드: 에러/빈상태 동선 불변 ─────────────────────────────────────
check('FundamentalsTab: ErrorState(에러 동선) 유지', /<ErrorState/.test(FUNDAMENTALS));
check('FundamentalsTab: EmptyState(빈상태 동선) 유지', /<EmptyState/.test(FUNDAMENTALS));
check('DecisionHubTab: ErrorState(에러 동선) 유지', /<ErrorState/.test(DECISION));
check('DecisionHubTab: EmptyState(빈상태 동선) 유지', /<EmptyState/.test(DECISION));

// ── (E) 회귀 가드: Drilldown 페이지네이션 푸터 스피너는 유지 ──────────────────
// 무한스크롤 '더 보기' 인디케이터(isFetchingNextPage)는 인라인 적합 패턴이라 보존.
check(
  'Drilldown: 페이지네이션 푸터 ActivityIndicator 유지',
  /isFetchingNextPage \? \(\s*<ActivityIndicator size="small"/.test(DRILLDOWN),
);
check('Drilldown: ActivityIndicator import 유지(푸터에서 사용)', /ActivityIndicator/.test(DRILLDOWN));

// ── (F) 음성 대조: 정본 스켈레톤 컴포넌트의 progressbar 접근성 ────────────────
const DETAIL_SKEL = readFileSync(join(root, 'components/common/DetailSkeleton.tsx'), 'utf8');
const SKEL_CARD = readFileSync(join(root, 'components/common/SkeletonCard.tsx'), 'utf8');
check('DetailSkeleton: progressbar 접근성', /accessibilityRole="progressbar"/.test(DETAIL_SKEL));
check('SkeletonCard(useSkeletonPulse export): 펄스 훅 노출', /export function useSkeletonPulse/.test(SKEL_CARD));

console.log(failed === 0 ? '\nALL PASS' : `\n${failed} FAILED`);
process.exit(failed === 0 ? 0 : 1);
