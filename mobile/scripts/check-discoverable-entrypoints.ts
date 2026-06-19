/**
 * DAR-372 결정론적 검증: 신규 가치 화면(분봉 차트·자동매매 상태)의 발견성 진입점이
 * 깊은 네비/푸터에만 묻히지 않고 홈/포트폴리오 등 주요 동선에서 1~2탭으로 노출되는지
 * 정적 소스 바인딩으로 증명한다(런타임 무관·결정론).
 *
 *  (A) 자동매매 상태(net-new): 포트폴리오 탭 헤더 상단에 항상 노출되는 진입 버튼.
 *      - 전용 컴포넌트(AutoTradingEntryButton): shield 아이콘 + '자동매매 상태' 라벨 +
 *        /portfolio/auto-trading 라우트 + 접근성 라벨 + 터치영역 44pt(빈 아이콘 금지).
 *      - 포트폴리오 탭이 이 컴포넌트를 import 하고 헤더(row)에서 렌더.
 *  (B) 분봉/현재가 차트(기존 DAR-363 유지 회귀): 홈 신호 프리뷰·신호목록 행이
 *      여전히 /stock 차트로 1탭 진입한다(주요 탭→차트 경로 ≥1 보존).
 *  (C) 회귀: 기존 푸터 링크(SimulationStatusSection)도 자동매매 상태로 도달 가능(중복 경로 보존).
 *
 * 실행: npx tsx scripts/check-discoverable-entrypoints.ts  (실패 시 exit 1)
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

console.log('DAR-372 발견성 진입점 — 자동매매 상태 헤더 노출 + 차트 경로 보존');

const root = join(__dirname, '..');
const read = (...p: string[]) => readFileSync(join(root, ...p), 'utf8');

// ── (A) 자동매매 상태 진입 컴포넌트 ─────────────────────────────
const entry = read('components', 'portfolio', 'AutoTradingEntryButton.tsx');
assert('컴포넌트: /portfolio/auto-trading 라우트 상수', /AUTO_TRADING_ROUTE = '\/portfolio\/auto-trading'/.test(entry));
assert('컴포넌트: router.push(AUTO_TRADING_ROUTE) 진입', /router\.push\(AUTO_TRADING_ROUTE\)/.test(entry));
assert('컴포넌트: shield 아이콘(빈 아이콘 금지)', /name="shield"/.test(entry));
assert("컴포넌트: '자동매매 상태' 라벨 표기", /자동매매 상태/.test(entry));
assert('컴포넌트: accessibilityRole="button"', /accessibilityRole="button"/.test(entry));
assert('컴포넌트: 의미있는 accessibilityLabel(킬스위치·준비중 고지)', /accessibilityLabel="자동매매 상태 —[^"]*준비중/.test(entry));
assert('컴포넌트: 터치영역 minHeight 44', /minHeight:\s*44/.test(entry));
assert('컴포넌트: 큰 글꼴 캡(maxFontSizeMultiplier)', /maxFontSizeMultiplier=\{MAX_CHIP_FONT_SCALE\}/.test(entry));

// ── (B) 포트폴리오 탭 헤더 배선 ─────────────────────────────────
const portfolio = read('app', '(tabs)', 'portfolio', 'index.tsx');
assert('포트폴리오: AutoTradingEntryButton import', /import \{ AutoTradingEntryButton \} from '@components\/portfolio\/AutoTradingEntryButton'/.test(portfolio));
assert('포트폴리오: 헤더에서 <AutoTradingEntryButton /> 렌더', /<AutoTradingEntryButton\s*\/>/.test(portfolio));
// 헤더가 row 레이아웃(제목 좌·진입 버튼 우)으로 정렬되는지(스타일).
assert('포트폴리오: 헤더 style 가 row 정렬', /header:\s*\{[\s\S]*?flexDirection:\s*'row'[\s\S]*?\}/.test(portfolio));
// 진입 버튼이 헤더(인증/게스트 분기 위)에 위치 → 게스트·인증 모두에 노출.
const headerIdx = portfolio.indexOf('<AutoTradingEntryButton');
const guestIdx = portfolio.indexOf('!isAuthenticated ?');
assert('포트폴리오: 진입 버튼이 인증 분기보다 앞(항상 노출)', headerIdx > 0 && guestIdx > 0 && headerIdx < guestIdx);

// ── (C) 차트 경로 보존(DAR-363 회귀) ───────────────────────────
const home = read('components', 'home', 'HomeSignalPreview.tsx');
assert('회귀: 홈 신호 프리뷰가 navigateToStockChart 로 차트 진입', /navigateToStockChart\(signal\.ticker\)/.test(home));
const exploreCard = read('components', 'signals', 'SignalExploreCard.tsx');
assert('회귀: 신호목록 행이 navigateToStockChart 로 차트 진입', /navigateToStockChart\(signal\.ticker\)/.test(exploreCard));
const stockScreen = read('app', 'stock', '[stockCode].tsx');
assert('회귀: /stock 차트 화면 실재(라우트 타깃)', /useLocalSearchParams<\{\s*stockCode/.test(stockScreen));

// ── (C) 기존 푸터 링크 보존(중복 경로) ─────────────────────────
const simSection = read('components', 'portfolio', 'SimulationStatusSection.tsx');
assert("회귀: 푸터 링크도 '/portfolio/auto-trading' 도달 보존", /router\.push\('\/portfolio\/auto-trading'\)/.test(simSection));

const total = 8 + 4 + 3 + 1;
const passed = total - failures;
if (failures === 0) {
  console.log(`ALL PASS (${passed}/${total})`);
  process.exit(0);
} else {
  console.error(`FAIL: ${failures}/${total} assertion(s)`);
  process.exit(1);
}
