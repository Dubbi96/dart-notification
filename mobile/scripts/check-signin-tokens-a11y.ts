/**
 * DAR-464 결정론적 검증: 로그인(sign-in) 토큰화 + 터치영역 + a11y + 콜드스타트 플래시.
 *
 * 근거(UI/UX 전수 감사 2026-06-27):
 *  - A-SIGNIN-1: auth/sign-in.tsx 의 부제 색이 `rgba(255,255,255,0.5)` 하드코딩이었다
 *    (토큰 colors.onColorFaint 가 정확히 존재). → onColorFaint 토큰 사용.
 *  - A-SIGNIN-2: 로고 fontSize:60 하드코딩, palette.white 인라인, LogoCards 300×150 고정.
 *    → 타이포 토큰(amount) 기반 디스플레이 크기 + colors.onColor + 반응형 폭.
 *  - A-TOUCH-1: 보조(둘러보기) 버튼 실효 ≈36pt(<44). → minHeight = sizing.minTouchTarget(44).
 *  - A-A11Y-1: guestButton 에 accessibilityRole/Label 없음. → role="button" + 라벨.
 *  - A-IDX-1: app/index.tsx 콜드스타트 로딩이 배경 토큰 없는 View + 색 없는 ActivityIndicator
 *    → 다크모드 흰 플래시. → backgroundColor: colors.background + ActivityIndicator color=colors.primary.
 *
 * 이 검증은 두 소스를 정규식으로 단정해 회귀(토큰 제거·하드코딩 재유입)를 잡는다.
 *
 * 실행: npx tsx scripts/check-signin-tokens-a11y.ts  (실패 시 exit 1)
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const read = (...parts: string[]) => readFileSync(join(here, '..', ...parts), 'utf8');

const signIn = read('app', 'auth', 'sign-in.tsx');
const index = read('app', 'index.tsx');

let failed = 0;
function check(label: string, ok: boolean): void {
  if (!ok) failed += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'} | ${label}`);
}

console.log('— sign-in.tsx: 색상 토큰화 —');
// A-SIGNIN-1: 흰색 알파 하드코딩 제거 + onColorFaint 토큰 사용.
check(
  'A-SIGNIN-1: rgba(255,255,255,...) 하드코딩 제거',
  !/rgba\(\s*255\s*,\s*255\s*,\s*255/.test(signIn),
);
check('A-SIGNIN-1: colors.onColorFaint 토큰 사용', /colors\.onColorFaint/.test(signIn));
// A-SIGNIN-2: 로고 흰색을 palette.white 인라인 대신 onColor 토큰으로.
check('A-SIGNIN-2: palette.white 인라인 제거', !/palette\.white/.test(signIn));
check('A-SIGNIN-2: colors.onColor 토큰 사용', /colors\.onColor\b/.test(signIn));

console.log('\n— sign-in.tsx: 로고 타이포/반응형 —');
// A-SIGNIN-2: fontSize:60 매직넘버 제거 + 타이포 토큰(amount) 기반 디스플레이 크기.
check('A-SIGNIN-2: fontSize:60 하드코딩 제거', !/fontSize:\s*60\b/.test(signIn));
check(
  'A-SIGNIN-2: 로고 크기를 typo.amount 토큰에서 파생',
  /typo\.amount\.fontSize/.test(signIn) && /logoFontSize/.test(signIn),
);
// A-SIGNIN-2: LogoCards 고정 300×150 제거 + 반응형 폭(useWindowDimensions) 사용.
check('A-SIGNIN-2: LogoCards width={300} 고정 제거', !/width=\{300\}/.test(signIn));
check('A-SIGNIN-2: LogoCards height={150} 고정 제거', !/height=\{150\}/.test(signIn));
check('A-SIGNIN-2: useWindowDimensions 반응형 폭 사용', /useWindowDimensions\(\)/.test(signIn));
check(
  'A-SIGNIN-2: LogoCards 에 반응형 width/height 주입',
  /width=\{logoCardsWidth\}/.test(signIn) && /height=\{logoCardsHeight\}/.test(signIn),
);

console.log('\n— sign-in.tsx: 둘러보기 버튼 터치영역 + a11y —');
// guestButton TouchableOpacity 여는 태그 추출(onPress={goGuest}).
const gStart = signIn.indexOf('onPress={goGuest}');
const gOpen =
  gStart >= 0
    ? signIn.slice(signIn.lastIndexOf('<TouchableOpacity', gStart), signIn.indexOf('>', gStart))
    : '';
check('guestButton TouchableOpacity 발견', gOpen.length > 0);
check('A-A11Y-1: guestButton accessibilityRole="button"', /accessibilityRole=("|')button\1/.test(gOpen));
check(
  'A-A11Y-1: guestButton accessibilityLabel="로그인 없이 둘러보기"',
  /accessibilityLabel=("|')로그인 없이 둘러보기\1/.test(gOpen),
);
// A-TOUCH-1: guestButton 스타일 minHeight = sizing.minTouchTarget.
const gStyleMatch = signIn.match(/guestButton:\s*\{[^}]*\}/s);
const gStyle = gStyleMatch ? gStyleMatch[0] : '';
check('A-TOUCH-1: guestButton minHeight: sizing.minTouchTarget', /minHeight:\s*sizing\.minTouchTarget/.test(gStyle));
check('A-TOUCH-1: sizing 토큰 import', /import\s*\{[^}]*\bsizing\b[^}]*\}\s*from\s*'@theme\/spacing'/.test(signIn));

console.log('\n— app/index.tsx: 콜드스타트 로딩 토큰 —');
// A-IDX-1: 로딩 View 배경 토큰 + ActivityIndicator 색 토큰.
check('A-IDX-1: useTheme 사용', /useTheme\(\)/.test(index));
check('A-IDX-1: 로딩 View backgroundColor: colors.background', /backgroundColor:\s*colors\.background/.test(index));
check('A-IDX-1: ActivityIndicator color={colors.primary}', /<ActivityIndicator[^>]*color=\{colors\.primary\}/s.test(index));

if (failed > 0) {
  console.error(`\n${failed} check(s) FAILED`);
  process.exit(1);
}
console.log('\nAll checks passed.');
