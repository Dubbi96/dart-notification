// DAR-265 결정론 검증: app/disclosures/index.tsx 손수제작 헤더 a11y/터치영역.
// 1) 뒤로가기·검색초기화 아이콘버튼이 accessibilityRole='button'+accessibilityLabel 노출.
// 2) 검색초기화 유효 터치 = 아이콘(18) + hitSlop 세로/가로 합 >= minTouchTarget(44pt).
import { readFileSync } from 'fs';
import { join } from 'path';

const root = join(__dirname, '..');
const src = readFileSync(join(root, 'app/disclosures/index.tsx'), 'utf8');
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

// --- 뒤로가기 버튼 ---
const back = src.slice(src.indexOf('onPress={() => router.back()}'));
const backBlock = back.slice(0, back.indexOf('</TouchableOpacity>'));
ok('back: accessibilityRole=button', /accessibilityRole="button"/.test(backBlock));
ok('back: accessibilityLabel=뒤로 가기', /accessibilityLabel="뒤로 가기"/.test(backBlock));
ok('back: chevron-back 아이콘 전용', /name="chevron-back"/.test(backBlock));

// --- 검색초기화 버튼 ---
const clr = src.slice(src.indexOf("onPress={() => handleSearchChange('')}"));
const clrBlock = clr.slice(0, clr.indexOf('</TouchableOpacity>'));
ok('clear: accessibilityRole=button', /accessibilityRole="button"/.test(clrBlock));
ok('clear: accessibilityLabel=검색어 지우기', /accessibilityLabel="검색어 지우기"/.test(clrBlock));

// hitSlop 파싱 + 아이콘 크기로 유효 터치영역 산출
const hsMatch = clrBlock.match(/hitSlop=\{\{\s*top:\s*(\d+),\s*bottom:\s*(\d+),\s*left:\s*(\d+),\s*right:\s*(\d+)\s*\}\}/);
ok('clear: hitSlop 객체 4방향 지정', !!hsMatch);
const iconMatch = clrBlock.match(/name="close-circle"\s+size=\{(\d+)\}/);
ok('clear: close-circle 아이콘 size 파싱', !!iconMatch);

if (hsMatch && iconMatch) {
  const [, top, bottom, left, right] = hsMatch.map(Number);
  const iconSize = Number(iconMatch[1]);
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
