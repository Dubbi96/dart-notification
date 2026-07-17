/**
 * DAR-545 결정론적 검증: 브로커 앱 핸드오프 딥링크 v1('증권사 앱에서 열기')을 두 층으로 증명한다.
 *
 *   (A) 오픈 진리표: openBrokerApp 의 2경로 규칙을 주입 openURL 로 모델링해 고정.
 *       - 스킴 오픈 성공 → 'app'(스킴 URL 로 링크아웃)
 *       - 스킴 실패(미설치) → 'store'(플랫폼별 스토어 폴백)
 *   (B) 소스 바인딩: 실제 util/컴포넌트/화면이 SSOT 를 경유하고 수용기준(2경로·접근성 라벨·정직 고지·
 *       양 화면 배치)을 코드로 만족하는지 정적 확인. 모델이 소스와 어긋나면 (B) 에서 잡힌다.
 *
 * 실행: npx tsx scripts/check-broker-handoff.ts  (tsx 부재 시 tsc→node 로 실행)
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

let failures = 0;
let total = 0;
function assert(name: string, cond: boolean) {
  total++;
  if (cond) {
    console.log(`  ✓ ${name}`);
  } else {
    failures++;
    console.error(`  ✗ ${name}`);
  }
}

console.log('DAR-545 브로커 앱 핸드오프 — 오픈 진리표 + 소스 바인딩');

// ── (A) 오픈 진리표 ───────────────────────────────────────────
// util 과 동일한 2경로 규칙을 모델로 고정(어긋나면 (B) 소스 바인딩이 잡는다).
type Platform = 'ios' | 'android';
interface Broker {
  appScheme: string;
  iosStoreUrl: string;
  androidStoreUrl: string;
}
const model: Broker = {
  appScheme: 'testbroker://',
  iosStoreUrl: 'https://apps.apple.com/kr/app/id1',
  androidStoreUrl: 'https://play.google.com/store/apps/details?id=com.t',
};
function storeUrl(b: Broker, p: Platform): string {
  return p === 'ios' ? b.iosStoreUrl : b.androidStoreUrl;
}
async function open(
  b: Broker,
  openURL: (url: string) => Promise<unknown>,
  p: Platform,
): Promise<{ outcome: 'app' | 'store'; calls: string[] }> {
  const calls: string[] = [];
  const track = (url: string) => {
    calls.push(url);
    return openURL(url);
  };
  try {
    await track(b.appScheme);
    return { outcome: 'app', calls };
  } catch {
    await track(storeUrl(b, p));
    return { outcome: 'store', calls };
  }
}

const ok = () => Promise.resolve(true);
let fail1 = 0;
const failThenOk = (_url: string) => {
  // 첫 호출(스킴)만 실패, 이후(스토어) 성공.
  if (fail1++ === 0) return Promise.reject(new Error('no handler'));
  return Promise.resolve(true);
};

// 진리표는 async — 즉시 실행 후 종료코드 산정.
(async () => {
  const appPath = await open(model, ok, 'ios');
  assert("경로1: 스킴 오픈 성공 → 'app'", appPath.outcome === 'app');
  assert('경로1: 스킴 URL 로 1회만 openURL', appPath.calls.length === 1 && appPath.calls[0] === 'testbroker://');

  fail1 = 0;
  const iosStore = await open(model, failThenOk, 'ios');
  assert("경로2(iOS): 스킴 실패 → 'store'", iosStore.outcome === 'store');
  assert('경로2(iOS): 스킴→App Store 순 폴백', iosStore.calls[0] === 'testbroker://' && iosStore.calls[1] === model.iosStoreUrl);

  fail1 = 0;
  const aosStore = await open(model, failThenOk, 'android');
  assert("경로2(AOS): 스킴 실패 → 'store'", aosStore.outcome === 'store');
  assert('경로2(AOS): Play Store 로 폴백', aosStore.calls[1] === model.androidStoreUrl);

  // ── (B) 소스 바인딩 ──────────────────────────────────────────
  const root = join(__dirname, '..');
  const read = (...p: string[]) => readFileSync(join(root, ...p), 'utf8');

  // util SSOT
  const util = read('utils', 'brokerHandoff.ts');
  assert('util: BROKER_APPS 대표 2~3사(2~3개 항목)', (util.match(/id:\s*'/g) ?? []).length >= 2 && (util.match(/id:\s*'/g) ?? []).length <= 3);
  assert('util: 커스텀 스킴(scheme://) 정의', /appScheme:\s*'[a-zA-Z][\w+.-]*:\/\/'/.test(util));
  assert('util: App Store 폴백 URL', /iosStoreUrl:\s*'https:\/\/apps\.apple\.com\//.test(util));
  assert('util: Play Store 폴백 URL', /androidStoreUrl:\s*'https:\/\/play\.google\.com\//.test(util));
  assert('util: openBrokerApp 이 스킴 시도→실패 캐치 폴백(2경로)', /try\s*\{[\s\S]*openURL\(broker\.appScheme\)[\s\S]*return 'app'[\s\S]*catch[\s\S]*brokerStoreUrl\([\s\S]*return 'store'/.test(util));
  assert('util: 정직 고지 카피(추천 아님)', /BROKER_HANDOFF_DISCLOSURE[\s\S]*추천하지 않/.test(util));
  // canOpenURL '호출' 부재만 검사(설명 주석의 단어 언급은 허용) — iOS 화이트리스트 네이티브 변경 회피.
  assert('util: canOpenURL 호출 미사용(LSApplicationQueriesSchemes 네이티브 변경 회피)', !/canOpenURL\s*\(/.test(util));

  // 컴포넌트
  const comp = read('components', 'common', 'BrokerHandoffButton.tsx');
  assert('컴포넌트: SSOT util 경유(openBrokerApp/BROKER_APPS)', /from '@utils\/brokerHandoff'/.test(comp) && /openBrokerApp/.test(comp) && /BROKER_APPS/.test(comp));
  assert('컴포넌트: 트리거 버튼 접근성 라벨', /accessibilityRole="button"/.test(comp) && /BROKER_HANDOFF_TITLE/.test(comp));
  assert('컴포넌트: 브로커 행 접근성 라벨(폴백 고지 포함)', /accessibilityLabel=\{`\$\{broker\.name\}[^`]*앱스토어로 이동/.test(comp));
  assert('컴포넌트: 정직 고지 렌더', /BROKER_HANDOFF_DISCLOSURE/.test(comp));
  assert('컴포넌트: 터치영역 minHeight 44(minTouchTarget)', /minHeight:\s*sizing\.minTouchTarget/.test(comp));
  assert('컴포넌트: 커스텀 refreshControl 래퍼 미사용', !/refreshControl=/.test(comp));

  // 두 화면 배치(신호 상세·종목 상세)
  const signal = read('app', 'signals', '[id].tsx');
  assert('신호상세: BrokerHandoffButton import', /from '@components\/common\/BrokerHandoffButton'/.test(signal));
  assert('신호상세: BrokerHandoffButton 렌더', /<BrokerHandoffButton\b/.test(signal));

  const stock = read('app', 'stock', '[stockCode].tsx');
  assert('종목상세: BrokerHandoffButton import', /from '@components\/common\/BrokerHandoffButton'/.test(stock));
  assert('종목상세: BrokerHandoffButton 렌더', /<BrokerHandoffButton\b/.test(stock));

  // 테스트 동반
  const test = read('__tests__', 'utils', 'brokerHandoff.test.ts');
  assert('테스트: 2경로(app/store) 검증 존재', /toBe\('app'\)/.test(test) && /toBe\('store'\)/.test(test));

  // total 은 assert() 가 실측 누적(하드코딩 합산 오차 제거).
  const passed = total - failures;
  if (failures === 0) {
    console.log(`ALL PASS (${passed}/${total})`);
    process.exit(0);
  } else {
    console.error(`FAIL: ${failures}/${total} assertion(s)`);
    process.exit(1);
  }
})();
