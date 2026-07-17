/**
 * DAR-549 결정론 검증: 첫 게시(Play) 빌드 모의투자·자동매매 표면 전면 제외 게이팅.
 *
 * 오너 결정(2026-07-17): 처음 게시하는 앱 버전에서 모의투자·자동매매를 제외한다. 빌드타임 플래그
 * EXPO_PUBLIC_SHOW_TRADING(기본 true, play 프로파일만 false)로 UI만 게이팅한다 — 서버·M10 무접촉.
 *
 * 이 스크립트는 화면·설정과 공유하는 순수 로직(utils/tradingVisibility)의 진리표 + 실제 소스가
 * 각 표면을 플래그로 게이팅하는지(정적 소스 단언)를 함께 증명한다.
 *
 * 실행(런너 부재 → 트랜스파일 후 node): mobile/ 에서
 *   npx tsc scripts/check-trading-gate.ts --ignoreConfig --ignoreDeprecations "6.0" \
 *     --module commonjs --target es2021 --esModuleInterop --skipLibCheck --types node \
 *   && node scripts/check-trading-gate.js; rm -f scripts/check-trading-gate.js utils/tradingVisibility.js
 */
import { readFileSync } from 'fs';
import { join } from 'path';

import {
  resolveShowTrading,
  tradingSurfaceVisibility,
} from '../utils/tradingVisibility';

const MOBILE_ROOT = join(__dirname, '..');
const read = (rel: string) => readFileSync(join(MOBILE_ROOT, rel), 'utf8');

let pass = 0;
let fail = 0;
function check(name: string, ok: boolean, detail = '') {
  if (ok) {
    pass += 1;
    console.log(`  ✓ ${name}`);
  } else {
    fail += 1;
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

console.log('— A) 플래그 순수 로직: 오직 "false" 만 트레이딩 표면을 숨긴다 —');
check('A1 EXPO_PUBLIC_SHOW_TRADING="false" → 숨김(false)', resolveShowTrading('false') === false);
check('A2 미설정(undefined) → 노출(true, 기본 안전값)', resolveShowTrading(undefined) === true);
check('A3 "" → 노출(true)', resolveShowTrading('') === true);
check('A4 "true" → 노출(true)', resolveShowTrading('true') === true);
check('A5 오타 "False" → 노출 유지(우발적 숨김 방지)', resolveShowTrading('False') === true);
check('A6 "0" → 노출 유지', resolveShowTrading('0') === true);
const hidden = tradingSurfaceVisibility(false);
const shown = tradingSurfaceVisibility(true);
check('A7 show=false → 모든 트레이딩 표면 off', Object.values(hidden).every((v) => v === false));
check('A8 show=true → 모든 트레이딩 표면 on(oci 무변경)', Object.values(shown).every((v) => v === true));
check(
  'A9 게이팅 표면 매니페스트 4종(포폴탭·홈footer·라우트·신호진입점)',
  Object.keys(hidden).sort().join(',') ===
    ['homePerformanceFooter', 'portfolioTab', 'signalPaperTradeEntry', 'tradingRoutes'].join(','),
  Object.keys(hidden).join(','),
);

console.log('— B) eas.json: play 프로파일 신설 + 기존 채널 무변경(회귀 가드) —');
const eas = JSON.parse(read('eas.json')) as {
  build: Record<string, { channel?: string; env?: Record<string, string>; android?: { buildType?: string } }>;
};
const play = eas.build.play;
check('B1 play 프로파일 존재', !!play);
check('B2 play.channel === "play"', play?.channel === 'play', play?.channel);
check(
  'B3 play.env.EXPO_PUBLIC_SHOW_TRADING === "false"',
  play?.env?.EXPO_PUBLIC_SHOW_TRADING === 'false',
  play?.env?.EXPO_PUBLIC_SHOW_TRADING,
);
check('B4 play 는 첫 게시용 app-bundle', play?.android?.buildType === 'app-bundle', play?.android?.buildType);
for (const ch of ['oci', 'preview', 'production'] as const) {
  check(
    `B5 ${ch} 채널은 SHOW_TRADING=false 미설정(기본 true 보존)`,
    eas.build[ch]?.env?.EXPO_PUBLIC_SHOW_TRADING !== 'false',
  );
}

console.log('— C) 소스 게이팅 단언(실제 화면이 SHOW_TRADING 으로 가드) —');
const layout = read('app/(tabs)/_layout.tsx');
check("C1 탭 레이아웃이 SHOW_TRADING 임포트", /from '@utils\/tradingVisibility'/.test(layout));
check(
  'C2 포트폴리오 탭 href:null 게이팅(4탭 IA)',
  /href:\s*SHOW_TRADING\s*\?\s*undefined\s*:\s*null/.test(layout),
);

const home = read('app/(tabs)/home/index.tsx');
check('C3 홈이 SHOW_TRADING 임포트', /from '@utils\/tradingVisibility'/.test(home));
check(
  "C4 홈 '운용 성과' footer 가 isAuthenticated && SHOW_TRADING 로 게이팅",
  /isAuthenticated\s*&&\s*SHOW_TRADING\s*\?/.test(home),
);

const guard = read('components/common/withTradingGuard.tsx');
check('C5 라우트 가드가 !SHOW_TRADING 시 홈으로 Redirect', /!SHOW_TRADING/.test(guard) && /Redirect[^]*\/\(tabs\)\/home/.test(guard));

const tradingRoutes = [
  'app/(tabs)/portfolio/index.tsx',
  'app/portfolio/auto-trading.tsx',
  'app/portfolio/trade-history.tsx',
  'app/portfolio/backtest-track-record.tsx',
  'app/portfolio/strategy/[key].tsx',
  'app/portfolio/strategy/intraday-scalp.tsx',
];
for (const rel of tradingRoutes) {
  const src = read(rel);
  const wrapped =
    /import \{ withTradingGuard \} from '@components\/common\/withTradingGuard'/.test(src) &&
    /export default withTradingGuard\(/.test(src) &&
    !/export default function/.test(src);
  check(`C6 ${rel} 진입 가드 래핑`, wrapped);
}

console.log('— D) 신호 표면 불변식: 트레이딩 진입점 부재(신호 카드는 유지) —');
// 요구(4): 신호 카드는 유지하되 '모의매매' 연결 진입점 제거. 현재 신호 표면에는 트레이딩/포트폴리오
// 진입점이 없다 — 이 불변식을 가드로 고정해 이후 ungated 트레이딩 CTA 유입을 차단한다.
const signalSurfaces = ['app/(tabs)/signals/index.tsx', 'app/signals/[id].tsx'];
const tradingEntryRe = /\/portfolio|auto-trading|trade-history|모의매매|모의투자/;
for (const rel of signalSurfaces) {
  check(`D1 ${rel} 에 트레이딩/모의매매 진입점 없음`, !tradingEntryRe.test(read(rel)));
}

console.log(`\n${pass} passed, ${fail} failed  (총 ${pass + fail})`);
if (fail > 0) {
  console.error('FAILURES present');
  process.exit(1);
}
console.log('ALL PASS');
