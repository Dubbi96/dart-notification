/**
 * DAR-224 결정론적 검증: 전역 ErrorBoundary 폴백의 순수 로직 + 레이아웃 배선.
 * 실행: npx tsx scripts/check-error-boundary.ts  (실패 시 exit 1)
 *
 * 버그(수정 전): app/_layout.tsx·app/(tabs)/_layout.tsx 어디에도 ErrorBoundary
 *  export 가 없어, 렌더타임 JS 에러 시 프로덕션 백지/크래시.
 * 수정 후: 루트+탭 레이아웃이 `export { ErrorFallback as ErrorBoundary }` 로
 *  Expo Router 폴백을 배선하고, 폴백은 테마토큰 UI + retry 복구를 제공.
 *
 * 본 체크는 RN 비의존 영역만 검증한다:
 *  (1) 테마 선택 헬퍼 진리표(provider 부재 시 시스템 스킴 정규화)
 *  (2) 폴백 카피가 한국어 비공백
 *  (3) 두 레이아웃 소스가 ErrorBoundary 를 실제로 export 하는지(정적)
 */

import { readFileSync } from 'fs';
import { join } from 'path';

import { resolveFallbackScheme, ERROR_FALLBACK_COPY } from '../utils/errorBoundary';

let failures = 0;
function assert(name: string, cond: boolean, detail?: string) {
  const tag = cond ? 'PASS' : 'FAIL';
  if (!cond) failures += 1;
  console.log(`[${tag}] ${name}${detail ? ` — ${detail}` : ''}`);
}

// (1) 테마 선택 진리표 — 'dark' 만 dark, 그 외(null/undefined/'light')는 light 폴백.
const schemeCases: Array<[Parameters<typeof resolveFallbackScheme>[0], 'light' | 'dark']> = [
  ['dark', 'dark'],
  ['light', 'light'],
  ['unspecified', 'light'],
  [null, 'light'],
  [undefined, 'light'],
];
for (const [input, expected] of schemeCases) {
  const got = resolveFallbackScheme(input);
  assert(`resolveFallbackScheme(${String(input)}) === ${expected}`, got === expected, `got ${got}`);
}

// (2) 폴백 카피 — 비공백 한국어(한글 포함).
const hangul = /[가-힣]/;
for (const [key, value] of Object.entries(ERROR_FALLBACK_COPY)) {
  assert(`copy.${key} 비공백 한국어`, value.trim().length > 0 && hangul.test(value), `"${value}"`);
}
// retry 카피는 폴백 버튼 라벨 = 접근성 라벨 단일 출처.
assert('copy.retry === "다시 시도"', ERROR_FALLBACK_COPY.retry === '다시 시도');

// (3) 레이아웃 배선 — 두 레이아웃이 ErrorBoundary 를 export 하는지 정적 확인.
const root = readFileSync(join(__dirname, '..', 'app', '_layout.tsx'), 'utf8');
const tabs = readFileSync(join(__dirname, '..', 'app', '(tabs)', '_layout.tsx'), 'utf8');
const exportRe = /export\s*\{[^}]*\bErrorFallback as ErrorBoundary\b[^}]*\}/;
assert('app/_layout.tsx 가 ErrorBoundary export', exportRe.test(root));
assert('app/(tabs)/_layout.tsx 가 ErrorBoundary export', exportRe.test(tabs));

// 폴백 컴포넌트가 retry 를 onPress 로 배선(복구 동선)하는지 정적 확인.
const fallback = readFileSync(
  join(__dirname, '..', 'components', 'common', 'ErrorFallback.tsx'),
  'utf8',
);
assert('ErrorFallback 이 onPress={retry} 복구 동선 보유', /onPress=\{retry\}/.test(fallback));
assert(
  'ErrorFallback 이 RN Pressable 사용(Paper Provider 비의존)',
  /from 'react-native'/.test(fallback) && /Pressable/.test(fallback) && !/from 'react-native-paper'/.test(fallback),
);

console.log(`\n${failures === 0 ? 'ALL PASS' : `${failures} FAIL`}`);
process.exit(failures === 0 ? 0 : 1);
