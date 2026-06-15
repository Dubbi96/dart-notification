// DAR-303 결정론 검증: Bottom GNB 일관성 — 모든 화면이 둘 중 하나로 분류됨을 보증.
//   (A) [탭 소속] app/(tabs)/* → <Tabs> 셸이 하단 GNB 유지(별도 < 버튼 불필요).
//   (B) [상세·뷰어] (tabs) 밖으로 push 되는 라우트 → GNB 없음 + 반드시 좌상단 뒤로가기
//       (router.back 동선 + accessibilityRole='button' + accessibilityLabel '뒤로 가기'|'닫기').
//       DAR-294/295 헤더 패턴. 공통 ScreenHeader 사용 화면은 컴포넌트가 a11y 를 제공.
// 이로써 "어떤 화면에서도 1탭으로 메뉴 복귀 가능" 불변식을 소스에서 입증한다.
import { readFileSync } from 'fs';
import { join } from 'path';

const root = join(__dirname, '..');

let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean) {
  if (cond) {
    pass++;
    console.log(`  ok  ${name}`);
  } else {
    fail++;
    console.error(`FAIL  ${name}`);
  }
}
const read = (rel: string) => readFileSync(join(root, rel), 'utf8');

// ── (A) 탭 소속 화면: (tabs) 셸이 GNB 유지 ────────────────────────────────
const TAB_SCREENS = [
  'app/(tabs)/home/index.tsx',
  'app/(tabs)/notifications/index.tsx',
  'app/(tabs)/signals/index.tsx',
  'app/(tabs)/portfolio/index.tsx',
  'app/(tabs)/settings/index.tsx',
];
const tabLayout = read('app/(tabs)/_layout.tsx');
ok('(tabs)/_layout: <Tabs> 셸로 하단 GNB(tabBarStyle) 제공', /<Tabs\b/.test(tabLayout) && /tabBarStyle:/.test(tabLayout));
for (const rel of TAB_SCREENS) {
  // 존재 + (tabs) 경로 소속 = GNB 자동 유지. 실수로 (tabs) 밖으로 옮겨지면 이 목록이 깨진다.
  ok(`탭 화면 존재·(tabs) 소속: ${rel}`, /\(tabs\)\//.test(rel) && read(rel).length > 0);
}

// ── 공통 ScreenHeader: onBack 시 좌상단 뒤로가기 a11y 제공(전이적 커버) ──────
const screenHeader = read('components/common/ScreenHeader.tsx');
ok('ScreenHeader: onBack 분기 뒤로가기 accessibilityRole="button"', /accessibilityRole="button"/.test(screenHeader));
ok('ScreenHeader: onBack 분기 accessibilityLabel="뒤로 가기"', /accessibilityLabel="뒤로 가기"/.test(screenHeader));

// ── (B) 상세·뷰어 화면: GNB 없음 + 좌상단 뒤로가기 필수 ──────────────────────
// 각 화면은 router.back 동선 + (ScreenHeader onBack | 인라인 뒤로가기/닫기 a11y) 중 하나로 복귀 보장.
const DETAIL_SCREENS = [
  'app/company/[corpCode].tsx',
  'app/disclosure/[id].tsx',
  'app/disclosure/viewer.tsx',
  'app/disclosures/index.tsx',
  'app/event-stats/index.tsx',
  'app/philosophy/[id].tsx',
  'app/philosophy/checklist.tsx',
  'app/philosophy/index.tsx',
  'app/portfolio/[portfolioId]/position/[positionId]/index.tsx',
  'app/portfolio/[portfolioId]/position/[positionId]/thesis.tsx',
  'app/portfolio/trade-history.tsx',
  'app/search/index.tsx',
  'app/settings-detail/ai-cost.tsx',
  'app/settings-detail/collection-status.tsx',
  'app/settings-detail/notification-settings.tsx',
  'app/settings-detail/pro.tsx',
  'app/settings-detail/profile.tsx',
  'app/settings-detail/saved-disclosures.tsx',
  'app/settings-detail/watchlist.tsx',
  'app/signals/[id].tsx',
  'app/legal/terms.tsx',
  'app/legal/privacy.tsx',
];

for (const rel of DETAIL_SCREENS) {
  const src = read(rel);
  // 1) router.back 복귀 동선 존재.
  const hasBackNav = /router\.back\(\)|navigation\.goBack\(\)/.test(src);
  // 2) 좌상단 뒤로가기 a11y: 공통 ScreenHeader(onBack) 또는 인라인 button+뒤로가기/닫기 라벨.
  const usesScreenHeader = /from '@components\/common\/ScreenHeader'/.test(src) && /<ScreenHeader[\s\S]*?onBack=/.test(src);
  const inlineA11y =
    /accessibilityRole="button"/.test(src) &&
    /accessibilityLabel="(뒤로 가기|닫기)"/.test(src);
  ok(`상세 화면 복귀 동선(router.back): ${rel}`, hasBackNav);
  ok(`상세 화면 좌상단 뒤로가기 a11y(ScreenHeader|인라인): ${rel}`, usesScreenHeader || inlineA11y);
}

// ── 회귀/대조: DAR-303 에서 보강한 5개 인라인 헤더가 '뒤로 가기' 라벨을 실제 획득 ────
const FIXED = [
  'app/legal/terms.tsx',
  'app/legal/privacy.tsx',
  'app/settings-detail/ai-cost.tsx',
  'app/settings-detail/profile.tsx',
  'app/settings-detail/saved-disclosures.tsx',
];
for (const rel of FIXED) {
  const src = read(rel);
  ok(`보강 확인 '뒤로 가기' 라벨: ${rel}`, /accessibilityLabel="뒤로 가기"/.test(src));
  // 라벨이 좌상단 뒤로가기 TouchableOpacity(=router.back) 블록에 부여됐는지(과확산/오부착 방지).
  const block = src.match(/<TouchableOpacity[\s\S]*?router\.back\(\)[\s\S]*?accessibilityLabel="뒤로 가기"[\s\S]*?>/);
  ok(`보강 라벨이 router.back 버튼에 부착: ${rel}`, block !== null);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
