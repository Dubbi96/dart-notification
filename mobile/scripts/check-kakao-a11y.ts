/**
 * DAR-223 결정론적 검증: 카카오 로그인 버튼 접근성 라벨/역할/상태.
 *
 * 근거: app/auth/sign-in.tsx 의 카카오 로그인 TouchableOpacity 안에는 <Image>
 * 하나만 있고 텍스트가 없어, 스크린리더(VoiceOver/TalkBack)에서 앱의 유일한
 * 로그인 진입점이 무명으로 읽혔다.
 *
 * 해결: TouchableOpacity 에 accessibilityRole="button" +
 * accessibilityLabel="카카오로 로그인" + accessibilityState={{ disabled: isLoading }}.
 *  - VoiceOver/TalkBack: "카카오로 로그인, 버튼" 으로 낭독
 *  - 로딩 중(isLoading)에는 disabled 상태로 전달
 *
 * 이 검증은 소스의 카카오 버튼 여는 태그를 추출해 세 접근성 prop 이 정확한
 * 값으로 존재하는지 단정한다(회귀 시 prop 제거를 잡는다).
 *
 * 실행: npx tsx scripts/check-kakao-a11y.ts  (실패 시 exit 1)
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(here, '..', 'app', 'auth', 'sign-in.tsx'), 'utf8');

// 카카오 버튼: onPress={handleKakaoLogin} 를 가진 TouchableOpacity 의 여는 태그 추출.
const start = src.indexOf('onPress={handleKakaoLogin}');
const tagEnd = src.indexOf('>', start);
const openTag = start >= 0 && tagEnd >= 0 ? src.slice(src.lastIndexOf('<TouchableOpacity', start), tagEnd) : '';

let failed = 0;
function check(label: string, ok: boolean): void {
  if (!ok) failed += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'} | ${label}`);
}

check('카카오 버튼 TouchableOpacity 발견', openTag.length > 0);
check('accessibilityRole="button"', /accessibilityRole=("|')button\1/.test(openTag));
check('accessibilityLabel="카카오로 로그인"', /accessibilityLabel=("|')카카오로 로그인\1/.test(openTag));
check(
  'accessibilityState disabled=isLoading',
  /accessibilityState=\{\{\s*disabled:\s*isLoading\s*\}\}/.test(openTag),
);

if (failed > 0) {
  console.error(`\n${failed} check(s) FAILED`);
  process.exit(1);
}
console.log('\nAll checks passed.');
