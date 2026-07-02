/**
 * DAR-472 결정론적 검증: UX 2차 상호평가 합의 nit 묶음(비차단·일관성/정확성).
 *
 * 개별 PR 가드(check-search-convention·check-track-record-discoverability·
 * check-candle-chart-interaction·check-strategy-comparison-density·check-style-card-disclosure·
 * check-company-chart-collapsible)에서 추출 후 불변식을 각자 재바인딩했고, 이 스크립트는
 * DAR-472 가 새로 도입한 cross-cutting 불변식만 한곳에서 검증한다(소스 바인딩·결정론):
 *
 *   1) a11y 라벨 정확화: PositionSearchBar '시급도순'은 순수 내림차순이 아니라 상태 우선순위 →
 *      옵션별 a11ySortDirection 분기(시급도 ≠ '내림차순 정렬').
 *   2) 아이콘 사이즈 토큰 패밀리: sizing.icon = {sm:16, md:18, lg:26} (값 보존, 시각 회귀 0).
 *   3) 공용 추출 산출물 존재: useManualRefresh·useCandleScrub 훅, InlineDisclosure 공용 컴포넌트,
 *      SEARCH_DEBOUNCE_MS 공통 상수.
 *   4) 인라인 renderItem useCallback 분리: intro(renderSlide)·onboarding(renderCompany).
 *   5) 터치영역/폰트: '크게 보기' 44pt(verticalHitSlopForHeight) · event-stats 라벨 축소(adjustsFontSizeToFit).
 *
 * 실행: npx tsx scripts/check-dar472-ux-nits.ts  (실패 시 exit 1)
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p: string) => readFileSync(join(root, p), 'utf8');

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean, detail = ''): void {
  if (cond) {
    pass += 1;
    console.log(`  ✓ ${name}`);
  } else {
    fail += 1;
    console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

// ── 1) PositionSearchBar a11y 라벨 정확화 ────────────────────────────────────
console.log('\n[1] PositionSearchBar — 시급도순 a11y 라벨 실제 정렬기준 반영');
const searchBar = read('components/portfolio/PositionSearchBar.tsx');
check('옵션별 a11ySortDirection 분기 도입', /a11ySortDirection:/.test(searchBar));
check('라벨이 a11ySortDirection 사용', /accessibilityLabel=\{`\$\{opt\.label\}, \$\{opt\.a11ySortDirection\}`\}/.test(searchBar));
check("시급도순 = '시급한 종목 먼저'(순수 내림차순 아님)", /key: 'urgency', label: '시급도순', a11ySortDirection: '시급한 종목 먼저'/.test(searchBar));
check("손익/비중순 = '내림차순 정렬' 유지", /key: 'pnl', label: '손익순', a11ySortDirection: '내림차순 정렬'/.test(searchBar) && /key: 'weight', label: '비중순', a11ySortDirection: '내림차순 정렬'/.test(searchBar));

// ── 2) sizing.icon 토큰 패밀리(값 보존) ──────────────────────────────────────
console.log('\n[2] sizing.icon{sm,md,lg} = {16,18,26}(값 보존)');
const spacingSrc = read('theme/spacing.ts');
check('sizing.icon 패밀리 정의', /icon:\s*\{\s*sm:\s*16,\s*md:\s*18,\s*lg:\s*26\s*\}/.test(spacingSrc));
check('company BACK_ICON_SIZE = sizing.icon.lg', /const BACK_ICON_SIZE = sizing\.icon\.lg/.test(read('app/company/[corpCode].tsx')));
check('company CHART_CHEVRON_SIZE = sizing.icon.md', /const CHART_CHEVRON_SIZE = sizing\.icon\.md/.test(read('app/company/[corpCode].tsx')));
check('disclosure 헤더 back = sizing.icon.lg', /name="chevron-back" size=\{sizing\.icon\.lg\}/.test(read('app/disclosure/[id].tsx')));
check('trade-history chevron = sizing.icon 토큰', /size=\{sizing\.icon\.(sm|md)\}/.test(read('app/portfolio/trade-history.tsx')));

// ── 3) 공용 추출 산출물 존재 ─────────────────────────────────────────────────
console.log('\n[3] 공용 추출 산출물(훅/컴포넌트/상수)');
const manualRefresh = read('hooks/useManualRefresh.ts');
check('useManualRefresh 훅 존재 + refetch 기반', /export function useManualRefresh/.test(manualRefresh) && /await refetch\(\)/.test(manualRefresh));
const candleScrub = read('hooks/useCandleScrub.ts');
check('useCandleScrub 훅 존재 + activeIndex/handleScrub/handleA11yAction 반환', /export function useCandleScrub/.test(candleScrub) && /return \{ activeIndex, handleScrub, handleA11yAction \}/.test(candleScrub));
const inlineDisc = read('components/common/InlineDisclosure.tsx');
check('InlineDisclosure 공용 컴포넌트 존재(accent/defaultExpanded 지원)', /export function InlineDisclosure/.test(inlineDisc) && /accent\b/.test(inlineDisc) && /defaultExpanded\b/.test(inlineDisc));
check('SEARCH_DEBOUNCE_MS 공통 상수(useDebounce)', /export const SEARCH_DEBOUNCE_MS = 300;/.test(read('hooks/useDebounce.ts')));

// ── 4) renderItem useCallback 분리 ──────────────────────────────────────────
console.log('\n[4] 고빈도 renderItem useCallback 분리');
const intro = read('app/intro/index.tsx');
check('intro renderSlide = useCallback + renderItem 배선', /const renderSlide = useCallback/.test(intro) && /renderItem=\{renderSlide\}/.test(intro));
check('intro 인라인 renderItem 화살표 제거', !/renderItem=\{\(\{ item \}\) =>/.test(intro));
const onboarding = read('app/onboarding/index.tsx');
check('onboarding renderCompany = useCallback + renderItem 배선', /const renderCompany = useCallback/.test(onboarding) && /renderItem=\{renderCompany\}/.test(onboarding));
check('onboarding toggleCompany 안정 참조(useCallback)', /const toggleCompany = useCallback\(/.test(onboarding));

// ── 5) 터치영역/폰트 ────────────────────────────────────────────────────────
console.log('\n[5] 터치영역(44pt) · 라벨 축소');
const company = read('app/company/[corpCode].tsx');
check('"크게 보기" 링크 verticalHitSlopForHeight(44pt 보정)', /hitSlop=\{verticalHitSlopForHeight\(CHART_LINK_VISUAL_HEIGHT\)\}/.test(company) && /const CHART_LINK_VISUAL_HEIGHT = 16/.test(company));
const eventStats = read('app/event-stats/index.tsx');
// MetricCell 라벨 Text(typo.small textTertiary)에 adjustsFontSizeToFit 적용 — 값과 동일 처리.
const labelBlock = eventStats.slice(eventStats.indexOf('function MetricCell'), eventStats.indexOf('function MetricCell') + 700);
check('event-stats MetricCell 라벨 축소(adjustsFontSizeToFit)', (labelBlock.match(/adjustsFontSizeToFit/g) ?? []).length >= 2);

console.log(`\n결과: ${pass} PASS · ${fail} FAIL`);
if (fail > 0) {
  console.error('FAILURES present');
  process.exit(1);
}
console.log('All checks passed');
