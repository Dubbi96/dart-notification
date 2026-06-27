/**
 * DAR-363 결정론적 검증: 실시간 차트(app/stock/[stockCode]) 진입점을
 * 포지션 상세·신호목록 행·홈 신호 프리뷰에 추가한 변경을 두 층으로 증명한다.
 *
 *   (A) 가드 진리표: isChartableTicker 규칙(6자리 숫자만 차트 가능)을 모델로 고정.
 *       - 6자리 종목코드(ticker)만 진입점 노출 → /stock 화면이 시세를 받을 수 있는 코드.
 *       - corpCode(8자리)·빈값·undefined·비숫자·5/7자리는 미노출(graceful)·navigate no-op.
 *   (B) 소스 바인딩: 실제 util/화면이 SSOT util(isChartableTicker/navigateToStockChart)을
 *       경유하고, 세 진입점이 /stock 라우트와 6자리 가드·접근성 라벨을 갖는지 정적 확인.
 *
 * 실행: npx tsx scripts/check-stock-chart-entrypoints.ts
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

let failures = 0;
function assert(name: string, cond: boolean) {
  if (cond) {
    console.log(`  ✓ ${name}`);
  } else {
    failures++;
    console.error(`  ✗ ${name}`);
  }
}

console.log('DAR-363 실시간 차트 진입점 — 가드 진리표 + 소스 바인딩');

// ── (A) 가드 진리표 ───────────────────────────────────────────
// SSOT util 과 동일한 규칙(6자리 숫자만). 모델이 소스와 어긋나면 (B) 에서 잡힌다.
const isChartable = (t?: string | null): boolean => typeof t === 'string' && /^\d{6}$/.test(t);
// navigateToStockChart: 차트 가능 시에만 push, 아니면 no-op. push 인자를 기록해 검증.
function navigate(t?: string | null): string | null {
  if (!isChartable(t)) return null;
  return `/stock/${t}`;
}

assert('6자리 종목코드 → 차트 가능', isChartable('005930'));
assert('6자리 종목코드 라우트 = /stock/005930', navigate('005930') === '/stock/005930');
assert('8자리 corpCode → 차트 불가(미노출)', !isChartable('00126380'));
assert('corpCode 전달 시 navigate no-op(null)', navigate('00126380') === null);
assert('undefined ticker → 차트 불가', !isChartable(undefined));
assert('null ticker → 차트 불가', !isChartable(null));
assert('빈 문자열 → 차트 불가', !isChartable(''));
assert('5자리 → 차트 불가', !isChartable('00593'));
assert('7자리 → 차트 불가', !isChartable('0059301'));
assert('비숫자 포함 → 차트 불가', !isChartable('00593A'));
assert('공백 포함 → 차트 불가', !isChartable('005 30'));
assert('차트 불가 ticker navigate 전부 no-op', ['', '12345', 'abcdef', undefined].every((t) => navigate(t) === null));

// ── (B) 소스 바인딩 ──────────────────────────────────────────
const root = join(__dirname, '..');
const read = (...p: string[]) => readFileSync(join(root, ...p), 'utf8');

// util SSOT
const util = read('utils', 'stockChartLink.ts');
assert('util: isChartableTicker 가 6자리 숫자 정규식 사용', /\/\^\\d\{6\}\$\//.test(util));
assert('util: navigateToStockChart 가 /stock/ 라우트로 push', /router\.push\(`\/stock\/\$\{ticker\}`\)/.test(util));
assert('util: navigate 가 비차트 ticker 면 early-return(no-op)', /if\s*\(!isChartableTicker\(ticker\)\)\s*return;/.test(util));

// (1) 포지션 상세
const pos = read('app', 'portfolio', '[portfolioId]', 'position', '[positionId]', 'index.tsx');
assert('포지션상세: SSOT util import', /from '@utils\/stockChartLink'/.test(pos));
assert('포지션상세: isChartableTicker(position.ticker) 가드로 진입점 노출', /isChartableTicker\(position\.ticker\)/.test(pos));
assert('포지션상세: handleViewChart 가 navigateToStockChart 호출', /navigateToStockChart\(positionQuery\.data\?\.ticker\)/.test(pos));
assert('포지션상세: 실시간 차트 보기 라벨', /실시간 차트 보기/.test(pos));
assert('포지션상세: ★정직 라벨(환경시계 괴리)', /환경시계와 괴리|환경시계와 다를 수 있음/.test(pos));
assert('포지션상세: 차트 진입 접근성 라벨', /실시간 차트 보기 —/.test(pos));
assert('포지션상세: 터치영역 minHeight 44', /minHeight:\s*44/.test(pos));

// (2) 신호목록 행(buy explore feed 카드)
const explore = read('components', 'signals', 'SignalExploreCard.tsx');
assert('신호행: SSOT util import', /from '@utils\/stockChartLink'/.test(explore));
assert('신호행: isChartableTicker(signal.ticker) 가드', /isChartableTicker\(signal\.ticker\)/.test(explore));
assert('신호행: handleChartPress 가 navigateToStockChart 호출', /navigateToStockChart\(signal\.ticker\)/.test(explore));
assert('신호행: 차트 퀵진입 버튼 접근성 라벨', /실시간 차트 보기`/.test(explore));
assert('신호행: no-hide-descendants 카드에 chart 보조 a11y 액션', /name:\s*'chart'/.test(explore));
assert('신호행: hitSlop 으로 터치영역 확보', /hitSlop=\{\{[^}]*top:\s*spacing\.md/.test(explore));

// (3) 홈 신호 프리뷰 카드
const home = read('components', 'home', 'HomeSignalPreview.tsx');
assert('홈프리뷰: SSOT util import', /from '@utils\/stockChartLink'/.test(home));
assert('홈프리뷰: isChartableTicker(signal.ticker) 가드', /isChartableTicker\(signal\.ticker\)/.test(home));
assert('홈프리뷰: handleChartPress 가 navigateToStockChart 호출', /navigateToStockChart\(signal\.ticker\)/.test(home));
assert('홈프리뷰: chart 보조 a11y 액션(no-hide-descendants 보완)', /name:\s*'chart'/.test(home));
assert('홈프리뷰: 차트 버튼 접근성 라벨', /실시간 차트 보기`/.test(home));

// (4) /stock 화면 존재(라우트 타깃 실재) + ★정직 라벨 유지
//     DAR-458 E7/E2: 화면 상단 중복 고지 배너 제거 → 정직 framing은 QuoteHeader(실시간/종가 배지) 단독.
const stock = read('app', 'stock', '[stockCode].tsx');
assert('/stock 화면 실재(useLocalSearchParams stockCode)', /useLocalSearchParams<\{\s*stockCode/.test(stock));
assert('/stock 화면 ★정직 framing 유지(QuoteHeader 배지·중복 배너 제거)', /<QuoteHeader\b/.test(stock) && !/실시간 시장가 —/.test(stock));

const total = 12 + 3 + 7 + 6 + 5 + 2;
const passed = total - failures;
if (failures === 0) {
  console.log(`ALL PASS (${passed}/${total})`);
  process.exit(0);
} else {
  console.error(`FAIL: ${failures}/${total} assertion(s)`);
  process.exit(1);
}
