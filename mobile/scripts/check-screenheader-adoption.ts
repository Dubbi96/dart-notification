// DAR-455 결정론 검증: 공통 ScreenHeader 채택 + 부수정리(D4·D5·D11·D13·D14).
//
// 통일 목적의 components/common/ScreenHeader 가 있는데 4개 상세화면이 자체 헤더를
// 중복 구현(백버튼 아이콘·폭·정렬 혼재)하던 문제를 단일 패턴으로 통일했음을 소스에서 입증한다.
//   D4  profile·saved-disclosures·collection-status·pro → ScreenHeader(onBack) 교체, 인라인 헤더 제거.
//   D5  saved-disclosures FlatList pull-to-refresh 배선(RN 코어 RefreshControl, refreshing/onRefresh=refetch).
//   D11 saved-disclosures 저장 해제 버튼 터치영역 ≥44pt(sizing.minTouchTarget).
//   D13 profile 아바타 알파 결합(primary+'25') 제거 → 테마 토큰 colors.primaryBorder.
//   D14 collection-status "백필 종목" 미설명 용어 → 평이어 라벨 + 1줄 설명.
//
// 실행: npx tsx scripts/check-screenheader-adoption.ts  (실패 시 exit 1)
import { readFileSync } from 'fs';
import { join } from 'path';

const root = join(__dirname, '..');
const read = (rel: string) => readFileSync(join(root, rel), 'utf8');

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

const SCREENS = [
  'app/settings-detail/profile.tsx',
  'app/settings-detail/saved-disclosures.tsx',
  'app/settings-detail/collection-status.tsx',
  'app/settings-detail/pro.tsx',
];

// ── D4: 4개 화면 모두 공통 ScreenHeader(onBack) 사용 + 자체 인라인 헤더 제거 ──────────
for (const rel of SCREENS) {
  const src = read(rel);
  ok(`[D4] ScreenHeader import: ${rel}`, /from '@components\/common\/ScreenHeader'/.test(src));
  ok(`[D4] <ScreenHeader ... onBack> 사용: ${rel}`, /<ScreenHeader[\s\S]*?onBack=/.test(src));
  // 인라인 백버튼 아이콘(Ionicons chevron-back / Feather chevron-left) 잔존 0 → 아이콘 혼재 제거.
  ok(`[D4] 인라인 chevron-back 백버튼 제거: ${rel}`, !/name="chevron-back"/.test(src));
  ok(`[D4] 인라인 chevron-left 백버튼 제거: ${rel}`, !/name="chevron-left"/.test(src));
  // 자체 헤더 styles.header(borderBottomWidth 헤더바) 잔존 0.
  ok(`[D4] 자체 헤더 스타일(styles.header) 제거: ${rel}`, !/\bheader:\s*\{/.test(src));
}

// ── D5: saved-disclosures pull-to-refresh 배선(RN 코어 RefreshControl, 커스텀 래퍼 금지) ──
{
  const rel = 'app/settings-detail/saved-disclosures.tsx';
  const src = read(rel);
  ok(`[D5] RefreshControl import(react-native 코어)`, /import\s*\{[\s\S]*RefreshControl[\s\S]*\}\s*from\s*'react-native'/.test(src));
  ok(`[D5] FlatList refreshControl prop 배선`, /refreshControl=\{/.test(src));
  ok(`[D5] refreshing 바인딩`, /refreshing=\{isRefetching\}/.test(src));
  ok(`[D5] onRefresh=refetch 배선`, /onRefresh=\{refetch\}/.test(src));
  // 크로스플랫폼 가드: 커스텀 RefreshControl 래퍼 금지.
  ok(`[D5] 커스텀 AppRefreshControl 래퍼 미사용`, !/AppRefreshControl/.test(src));
}

// ── D11: 저장 해제 버튼 ≥44pt(sizing.minTouchTarget) ────────────────────────────────
{
  const rel = 'app/settings-detail/saved-disclosures.tsx';
  const src = read(rel);
  ok(`[D11] sizing import`, /import\s*\{[\s\S]*sizing[\s\S]*\}\s*from\s*'@theme\/spacing'/.test(src));
  // removeButton 스타일 블록에 minWidth/minHeight = sizing.minTouchTarget.
  const block = src.match(/removeButton:\s*\{[\s\S]*?\}/);
  ok(`[D11] removeButton 스타일 존재`, block !== null);
  ok(`[D11] removeButton minWidth=sizing.minTouchTarget`, !!block && /minWidth:\s*sizing\.minTouchTarget/.test(block[0]));
  ok(`[D11] removeButton minHeight=sizing.minTouchTarget`, !!block && /minHeight:\s*sizing\.minTouchTarget/.test(block[0]));
  // 저장 해제 버튼이 removeButton 스타일을 실제 사용.
  const bmStart = src.indexOf('onPress={() => handleRemove');
  const bmBlock = src.slice(src.lastIndexOf('<TouchableOpacity', bmStart), src.indexOf('</TouchableOpacity>', bmStart));
  ok(`[D11] 저장 해제 버튼이 removeButton 스타일 적용`, /style=\{styles\.removeButton\}/.test(bmBlock));
  // hitSlop=8(≈36pt)로 회귀 금지.
  ok(`[D11] hitSlop=8 잔존 0(36pt 회귀 차단)`, !/hitSlop=\{8\}/.test(bmBlock));
}

// ── D13: profile 아바타 알파 토큰화(primary+'25' 제거 → colors.primaryBorder) ─────────
{
  const rel = 'app/settings-detail/profile.tsx';
  const src = read(rel);
  ok(`[D13] 인라인 알파 결합(primary + '25') 제거`, !/primary\s*\+\s*['"]25['"]/.test(src));
  ok(`[D13] 아바타 borderColor=colors.primaryBorder`, /borderColor:\s*colors\.primaryBorder/.test(src));
  // 토큰이 라이트/다크 양 팔레트에 정의.
  const colorsSrc = read('theme/colors.ts');
  const occurrences = (colorsSrc.match(/primaryBorder:/g) || []).length;
  ok(`[D13] colors.ts primaryBorder 라이트+다크 정의(2곳)`, occurrences === 2);
}

// ── D14: "백필 종목" 미설명 용어 → 평이어 라벨 + 1줄 설명 ─────────────────────────────
{
  const rel = 'app/settings-detail/collection-status.tsx';
  const src = read(rel);
  ok(`[D14] metricLabel 미설명 "백필 종목" 단독 사용 제거`, !/metricLabel="백필 종목"/.test(src));
  ok(`[D14] 평이어 라벨 "지표 보유 종목" 사용`, /metricLabel="지표 보유 종목"/.test(src));
  // 1줄 설명에 용어 해설이 포함(지표 보유 종목 + 백필 맥락).
  ok(`[D14] 1줄 설명 제공(지표 보유 종목)`, /지표 보유 종목:/.test(src));
  ok(`[D14] 설명이 '백필' 도메인 맥락 전달`, /백필/.test(src));
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
