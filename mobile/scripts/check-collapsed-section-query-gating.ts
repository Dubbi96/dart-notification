/**
 * DAR-471 결정론 체크 — 접이식 섹션의 지연 로딩(접힘 상태 쿼리 게이팅).
 *
 * UX 2차 상호평가 합의: DAR-452/453/454가 섹션을 기본 접힘으로 만들었으나 접힘 상태에서도
 * 해당 React Query가 즉시 발화/폴링하여 지연 로딩 의도를 절반만 달성. 펼칠 때만(enabled) fetch.
 *
 * 판정 축(소스 바인딩 + TDZ 순서 + 동작 모델):
 *   [A] disclosure  — useDisclosureAnalysis(rcpNo, { enabled: expanded }) / 훅 enabled 게이트 / 기존 동작 보존
 *   [B] company     — useMinuteCandles(stockCode, { pollWhileMarketOpen: true, enabled: isChartExpanded })
 *   [C] ai-cost     — 4개 훅(daily/monthly/limitStatus/crossEngine) enabled: advancedOpen
 *   [D] TDZ 순서    — 게이트 상태(expanded/isChartExpanded/advancedOpen)는 게이트되는 훅 호출보다 먼저 선언
 *   [E] 동작 모델   — resolveEnabled(base, opt): 접힘(false) → 미발화, 미지정 → 기존 동작 보존
 *
 * 실행: npx -y tsx@4 scripts/check-collapsed-section-query-gating.ts
 */
import { readFileSync } from 'fs';
import { join } from 'path';

const ROOT = join(__dirname, '..');
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8');

let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean) {
  if (cond) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    console.log(`  ✗ ${name}`);
  }
}

// --- [A] 공시 상세 'AI 심층 분석' 카드 ---
console.log('[A] disclosure — useDisclosureAnalysis enabled: expanded');
{
  const hook = read('hooks/useDisclosures.ts');
  const comp = read('components/disclosure/DisclosureAiAnalysisSection.tsx');
  ok('DisclosureAnalysisOptions 인터페이스 정의', /interface DisclosureAnalysisOptions\s*\{\s*enabled\?: boolean;\s*\}/.test(hook));
  ok(
    '훅 시그니처에 options 추가',
    /export function useDisclosureAnalysis\(rcpNo: string, options\?: DisclosureAnalysisOptions\)/.test(hook),
  );
  ok(
    '훅 enabled 게이트(rcpNo && options.enabled ?? true)',
    /enabled:\s*!!rcpNo\s*&&\s*\(options\?\.enabled\s*\?\?\s*true\)/.test(hook),
  );
  ok(
    '컴포넌트가 { enabled: expanded } 전달',
    /useDisclosureAnalysis\(rcpNo,\s*\{\s*enabled:\s*expanded,?\s*\}\)/.test(comp),
  );
}

// --- [B] 기업 상세 분봉 차트 ---
console.log('[B] company — useMinuteCandles enabled: isChartExpanded');
{
  const hook = read('hooks/useMinuteCandles.ts');
  const page = read('app/company/[corpCode].tsx');
  ok(
    '훅이 options.enabled 게이트 지원',
    /enabled:\s*valid\s*&&\s*\(options\?\.enabled\s*\?\?\s*true\)/.test(hook),
  );
  ok(
    '페이지가 pollWhileMarketOpen + enabled: isChartExpanded 전달',
    /useMinuteCandles\(company\?\.stockCode,\s*\{\s*pollWhileMarketOpen:\s*true,\s*enabled:\s*isChartExpanded,?\s*\}\)/.test(
      page,
    ),
  );
  // 접힘 시 enabled:false → refetchInterval(폴링)도 함께 멈춤(React Query: disabled 쿼리는 자동 refetch 안 함).
  ok(
    '폴링은 pollWhileMarketOpen 게이트에만 결합(enabled와 독립 코드 경로)',
    /refetchInterval:\s*pollWhileMarketOpen/.test(hook),
  );
}

// --- [C] AI 비용 화면 고급/거버넌스 블록 ---
console.log('[C] ai-cost — 4 hooks enabled: advancedOpen');
{
  const hook = read('hooks/useAiCost.ts');
  const page = read('app/settings-detail/ai-cost.tsx');
  ok('AiCostQueryOptions 인터페이스 정의', /interface AiCostQueryOptions\s*\{\s*enabled\?: boolean;\s*\}/.test(hook));
  // 4개 거버넌스 훅 모두 enabled 게이트(요약용 metrics/health 2훅은 비대상 → 정확히 4회).
  const gateCount = (hook.match(/enabled:\s*options\?\.enabled\s*\?\?\s*true/g) ?? []).length;
  ok('거버넌스 4훅에 enabled 게이트 정확히 4회', gateCount === 4);
  for (const sig of [
    'export function useAiCostDaily(date?: string, options?: AiCostQueryOptions)',
    'export function useAiCostMonthly(year?: number, month?: number, options?: AiCostQueryOptions)',
    'export function useAiCostLimitStatus(options?: AiCostQueryOptions)',
    'export function useAiCostCrossEngine(from?: string, to?: string, options?: AiCostQueryOptions)',
  ]) {
    ok(`훅 시그니처: ${sig.replace('export function ', '').split('(')[0]}`, hook.includes(sig));
  }
  ok('useAiCostDaily 호출 게이팅', /useAiCostDaily\(undefined,\s*\{\s*enabled:\s*advancedOpen,?\s*\}\)/.test(page));
  ok(
    'useAiCostMonthly 호출 게이팅',
    /useAiCostMonthly\(undefined,\s*undefined,\s*\{\s*enabled:\s*advancedOpen,?\s*\}\)/.test(page),
  );
  ok('useAiCostLimitStatus 호출 게이팅', /useAiCostLimitStatus\(\{\s*enabled:\s*advancedOpen,?\s*\}\)/.test(page));
  ok(
    'useAiCostCrossEngine 호출 게이팅',
    /useAiCostCrossEngine\(undefined,\s*undefined,\s*\{\s*enabled:\s*advancedOpen,?\s*\}\)/.test(page),
  );
  // metrics/health(요약 항상표시)는 비게이팅 — 펼침 전에도 요약 게이지 1차 소스 보존(회귀 없음).
  ok('useAiCostMetrics 비게이팅(요약 상시)', /useAiCostMetrics\(\)/.test(page));
  ok('useAiCostHealth 비게이팅(요약 게이지 1차 소스)', /useAiCostHealth\(\)/.test(page));
}

// --- [D] TDZ 순서 — 게이트 상태는 게이트되는 훅 호출보다 먼저 선언 ---
console.log('[D] TDZ — 게이트 상태가 훅 호출보다 먼저 선언');
{
  const comp = read('components/disclosure/DisclosureAiAnalysisSection.tsx');
  ok(
    'disclosure: expanded 선언 < useDisclosureAnalysis 호출',
    comp.indexOf('const [expanded, setExpanded]') < comp.indexOf('useDisclosureAnalysis(rcpNo'),
  );
  const page = read('app/company/[corpCode].tsx');
  ok(
    'company: isChartExpanded 선언 < useMinuteCandles 호출',
    page.indexOf('const [isChartExpanded, setIsChartExpanded]') <
      page.indexOf('useMinuteCandles(company?.stockCode'),
  );
  const aiCost = read('app/settings-detail/ai-cost.tsx');
  ok(
    'ai-cost: advancedOpen 선언 < useAiCostDaily 호출',
    aiCost.indexOf('const [advancedOpen, setAdvancedOpen]') < aiCost.indexOf('useAiCostDaily('),
  );
}

// --- [E] 동작 모델 — enabled 해상도(접힘 → 미발화, 미지정 → 기존 동작) ---
console.log('[E] 동작 모델 — resolveEnabled(base, opt)');
{
  // 훅 내부 enabled 식과 동형: base && (opt ?? true). React Query는 enabled=false면 자동 발화/폴링 0.
  const resolveEnabled = (base: boolean, opt: boolean | undefined) => base && (opt ?? true);
  ok('접힘(opt=false) → 미발화', resolveEnabled(true, false) === false);
  ok('펼침(opt=true) → 발화', resolveEnabled(true, true) === true);
  ok('미지정(opt=undefined) → 기존 동작 보존(발화)', resolveEnabled(true, undefined) === true);
  ok('base false(코드 없음 등)면 opt 무관 미발화', resolveEnabled(false, true) === false);
}

console.log(`\n결과: ${pass} pass / ${fail} fail`);
process.exit(fail === 0 ? 0 : 1);
