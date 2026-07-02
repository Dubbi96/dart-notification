// DAR-265 결정론 검증: app/disclosures/index.tsx 헤더 a11y/터치영역.
// 1) 뒤로가기·검색초기화 아이콘버튼이 accessibilityRole='button'+accessibilityLabel 노출.
// 2) 검색초기화 유효 터치 = 아이콘 + hitSlop 세로/가로 합 >= minTouchTarget(44pt).
// (앵커 갱신 2026-07-02: L-5a A-1 로 손수제작 헤더가 공용 ScreenHeader 로 이관 —
//  뒤로가기 a11y/아이콘/44pt 는 ScreenHeader 컴포넌트 소스에서 전이적으로 단정한다.
//  검색초기화는 setSearchQuery('') + Feather x-circle(size=sizing.icon.md) + hitSlop 14 로 재바인딩.)
import { readFileSync } from 'fs';
import { join } from 'path';

const root = join(__dirname, '..');
const src = readFileSync(join(root, 'app/disclosures/index.tsx'), 'utf8');
const headerSrc = readFileSync(join(root, 'components/common/ScreenHeader.tsx'), 'utf8');
// theme/spacing.ts 의 sizing.minTouchTarget 을 소스에서 직접 읽음(RN 런타임 import 회피).
const spacingSrc = readFileSync(join(root, 'theme/spacing.ts'), 'utf8');
const minMatch = spacingSrc.match(/minTouchTarget:\s*(\d+)/);
if (!minMatch) throw new Error('minTouchTarget not found in theme/spacing.ts');
const sizing = { minTouchTarget: Number(minMatch[1]) };

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

// --- 뒤로가기 버튼: ScreenHeader(onBack) 전이 커버 ---
ok(
  'back: 화면이 ScreenHeader onBack={() => router.back()} 사용',
  /<ScreenHeader[\s\S]*?onBack=\{\(\)\s*=>\s*router\.back\(\)\}/.test(src),
);
// ScreenHeader 소스에서 onBack 버튼 블록을 특정해 a11y/아이콘을 단정(오부착 방지).
const hdrBtnStart = headerSrc.indexOf('onPress={onBack}');
const hdrBtn =
  hdrBtnStart >= 0
    ? headerSrc.slice(hdrBtnStart, headerSrc.indexOf('</TouchableOpacity>', hdrBtnStart))
    : '';
ok('back: ScreenHeader onBack 버튼 블록 존재', hdrBtn.length > 0);
ok('back: accessibilityRole=button', /accessibilityRole="button"/.test(hdrBtn));
ok('back: accessibilityLabel=뒤로 가기', /accessibilityLabel="뒤로 가기"/.test(hdrBtn));
ok('back: Feather chevron-left 아이콘 전용', /name="chevron-left"/.test(hdrBtn));
// ScreenHeader iconButton 은 SIDE 정사각(44) — 뒤로가기 터치영역 >= minTouchTarget.
const sideMatch = headerSrc.match(/const SIDE = (\d+);/);
ok('back: ScreenHeader SIDE 상수 파싱', !!sideMatch);
if (sideMatch) {
  ok(
    `back: 터치영역 SIDE(${sideMatch[1]}) >= ${sizing.minTouchTarget}pt`,
    Number(sideMatch[1]) >= sizing.minTouchTarget,
  );
}

// --- 검색초기화 버튼 ---
const clr = src.slice(src.indexOf("onPress={() => setSearchQuery('')}"));
const clrBlock = clr.slice(0, clr.indexOf('</TouchableOpacity>'));
ok('clear: accessibilityRole=button', /accessibilityRole="button"/.test(clrBlock));
ok('clear: accessibilityLabel=검색어 지우기', /accessibilityLabel="검색어 지우기"/.test(clrBlock));

// hitSlop 파싱 + 아이콘 크기로 유효 터치영역 산출
const hsMatch = clrBlock.match(/hitSlop=\{\{\s*top:\s*(\d+),\s*bottom:\s*(\d+),\s*left:\s*(\d+),\s*right:\s*(\d+)\s*\}\}/);
ok('clear: hitSlop 객체 4방향 지정', !!hsMatch);
// 아이콘 size 는 sizing.icon.md 토큰 — theme/spacing.ts 에서 실값을 해석해 산출한다.
const iconToken = clrBlock.match(/name="x-circle"\s+size=\{sizing\.icon\.md\}/);
ok('clear: x-circle 아이콘 size=sizing.icon.md 파싱', !!iconToken);
const iconMdMatch = spacingSrc.match(/icon:\s*\{[^}]*\bmd:\s*(\d+)/);
ok('clear: sizing.icon.md 토큰 실값 파싱', !!iconMdMatch);

if (hsMatch && iconToken && iconMdMatch) {
  const [, top, bottom, left, right] = hsMatch.map(Number);
  const iconSize = Number(iconMdMatch[1]);
  const effH = iconSize + top + bottom;
  const effW = iconSize + left + right;
  console.log(`  info  effective touch = ${effW}x${effH}pt (icon ${iconSize}, min ${sizing.minTouchTarget})`);
  ok(`clear: 유효 세로 >= ${sizing.minTouchTarget}pt`, effH >= sizing.minTouchTarget);
  ok(`clear: 유효 가로 >= ${sizing.minTouchTarget}pt`, effW >= sizing.minTouchTarget);
  // 회귀 대조: 기존 hitSlop={8} 였다면 18+8+8=34 < 44 (불충족) 임을 명시
  ok('regression: 기존 hitSlop=8(34pt)는 미달이었음', iconSize + 8 + 8 < sizing.minTouchTarget);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
