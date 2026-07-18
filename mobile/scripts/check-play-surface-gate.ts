/**
 * DAR-558 결정론 검증: 첫 Play 빌드 표면 게이팅 확장 — Pro·ops·매도 세그먼트.
 *
 * DAR-549(check-trading-gate.ts)가 트레이딩 4표면만 커버해 Pro 업셀·ops(AI 비용/수집현황)·
 * 매도 세그먼트가 첫 Play 빌드에 그대로 노출됐다(cc-apk-feedback-triage-2026-07-18.md §1-1·§1-3).
 * 이 스크립트는 신규 플래그(EXPO_PUBLIC_SHOW_PRO_UPSELL·EXPO_PUBLIC_SHOW_OPS)의 순수 로직
 * 진리표 + eas.json 배선 + 실제 소스가 각 표면을 플래그로 게이팅하는지(정적 소스 단언)를
 * check-trading-gate.ts와 동일한 구조로 증명한다.
 *
 * 실행(런너 부재 → 트랜스파일 후 node): mobile/ 에서
 *   npx tsc scripts/check-play-surface-gate.ts --ignoreConfig --ignoreDeprecations "6.0" \
 *     --module commonjs --target es2021 --esModuleInterop --skipLibCheck --types node \
 *   && node scripts/check-play-surface-gate.js; rm -f scripts/check-play-surface-gate.js \
 *      utils/proVisibility.js utils/opsVisibility.js
 */
import { readFileSync } from 'fs';
import { join } from 'path';

import { resolveShowProUpsell } from '../utils/proVisibility';
import { resolveShowOps } from '../utils/opsVisibility';

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

console.log('— A) proVisibility 순수 로직: 오직 "false" 만 Pro 업셀 표면을 숨긴다 —');
check('A1 EXPO_PUBLIC_SHOW_PRO_UPSELL="false" → 숨김', resolveShowProUpsell('false') === false);
check('A2 미설정(undefined) → 노출(기본 안전값)', resolveShowProUpsell(undefined) === true);
check('A3 오타 "False" → 노출 유지', resolveShowProUpsell('False') === true);

console.log('— B) opsVisibility 순수 로직: 오직 "false" 만 ops 표면을 숨긴다 —');
check('B1 EXPO_PUBLIC_SHOW_OPS="false" → 숨김', resolveShowOps('false') === false);
check('B2 미설정(undefined) → 노출(기본 안전값)', resolveShowOps(undefined) === true);
check('B3 오타 "False" → 노출 유지', resolveShowOps('False') === true);

console.log('— C) eas.json: play/play-apk 신규 플래그 2종 + 기존 채널 무변경(회귀 가드) —');
const eas = JSON.parse(read('eas.json')) as {
  build: Record<string, { channel?: string; env?: Record<string, string>; android?: { buildType?: string } }>;
};
for (const profile of ['play', 'play-apk'] as const) {
  const env = eas.build[profile]?.env;
  check(`C1 ${profile}.env.EXPO_PUBLIC_SHOW_PRO_UPSELL === "false"`, env?.EXPO_PUBLIC_SHOW_PRO_UPSELL === 'false');
  check(`C2 ${profile}.env.EXPO_PUBLIC_SHOW_OPS === "false"`, env?.EXPO_PUBLIC_SHOW_OPS === 'false');
}
for (const ch of ['oci', 'preview', 'production'] as const) {
  const env = eas.build[ch]?.env;
  check(`C3 ${ch} 채널은 SHOW_PRO_UPSELL=false 미설정(기본 true 보존)`, env?.EXPO_PUBLIC_SHOW_PRO_UPSELL !== 'false');
  check(`C4 ${ch} 채널은 SHOW_OPS=false 미설정(기본 true 보존)`, env?.EXPO_PUBLIC_SHOW_OPS !== 'false');
}

console.log('— D) 설정 화면 소스 게이팅 단언 —');
const settings = read('app/(tabs)/settings/index.tsx');
check("D1 설정 화면이 SHOW_PRO_UPSELL 임포트", /from '@utils\/proVisibility'/.test(settings));
check("D2 설정 화면이 SHOW_OPS 임포트", /from '@utils\/opsVisibility'/.test(settings));
check('D3 Pro 배너가 SHOW_PRO_UPSELL 로 게이팅', /\{SHOW_PRO_UPSELL\s*&&/.test(settings));
check('D4 ops MenuItem(수집현황·AI비용)이 SHOW_OPS 로 게이팅', /\{SHOW_OPS\s*&&/.test(settings));
check('D5 배너 부제가 실구현(200종목)과 일치', settings.includes('30 → 200종목'));
check('D6 배너 부제가 과장 카피("무제한") 재도입 안 함', !settings.includes('무제한 관심기업'));

console.log('— E) 라우트 가드 소스 단언(가드 HOC + 화면 래핑) —');
const proGuard = read('components/common/withProGuard.tsx');
check(
  'E1 Pro 가드가 !SHOW_PRO_UPSELL 시 설정 탭으로 Redirect',
  /!SHOW_PRO_UPSELL/.test(proGuard) && /Redirect[^]*\/\(tabs\)\/settings/.test(proGuard),
);
const opsGuard = read('components/common/withOpsGuard.tsx');
check(
  'E2 ops 가드가 !SHOW_OPS 시 설정 탭으로 Redirect',
  /!SHOW_OPS/.test(opsGuard) && /Redirect[^]*\/\(tabs\)\/settings/.test(opsGuard),
);

const guardedRoutes: Array<[rel: string, importName: string, wrapName: string]> = [
  ['app/settings-detail/pro.tsx', 'withProGuard', 'withProGuard'],
  ['app/settings-detail/ai-cost.tsx', 'withOpsGuard', 'withOpsGuard'],
  ['app/settings-detail/collection-status.tsx', 'withOpsGuard', 'withOpsGuard'],
];
for (const [rel, importName, wrapName] of guardedRoutes) {
  const src = read(rel);
  const wrapped =
    src.includes(`import { ${importName} } from '@components/common/${importName}'`) &&
    new RegExp(`export default ${wrapName}\\(`).test(src) &&
    !/export default function/.test(src);
  check(`E3 ${rel} 진입 가드 래핑`, wrapped);
}

console.log('— F) 신호 탭 매도 세그먼트 게이팅(D4) —');
const signals = read('app/(tabs)/signals/index.tsx');
check("F1 신호 탭이 SHOW_TRADING 임포트", /from '@utils\/tradingVisibility'/.test(signals));
check(
  'F2 매수/매도 토글이 SHOW_TRADING 으로 게이팅(false 시 매수 단독 렌더)',
  /isAuthenticated\s*&&\s*SHOW_TRADING\s*&&\s*feedToggle/.test(signals),
);

console.log('— G) Pro 카피 정직화(D2): 실구현 불일치·미구현 혜택 삭제 —');
const pro = read('app/settings-detail/pro.tsx');
check('G1 BENEFITS 가 실구현 한도(200종목)와 일치', pro.includes('200종목'));
check(
  'G2 미구현 3혜택(고급 필터·우선 알림·심화 분석) 삭제',
  !pro.includes('고급 필터') && !pro.includes('우선 알림') && !pro.includes('심화 분석'),
);
check('G3 과장 카피("무제한 관심기업") 삭제', !pro.includes('무제한 관심기업'));

console.log(`\n${pass} passed, ${fail} failed  (총 ${pass + fail})`);
if (fail > 0) {
  console.error('FAILURES present');
  process.exit(1);
}
console.log('ALL PASS');
