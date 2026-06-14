// scripts/check-no-hardcoded-hero-colors.ts — DAR-269
// 컬러 그라데이션 히어로 헤더(home/settings)·컬러 표면 스낵바 위의 흰색 전경 및
// 배지 색이 하드코딩(#hex / rgb(a)) 되어 있지 않고 theme 토큰을 경유하는지 검증한다.
// CLAUDE.md 규율: "하드코딩된 색상값(#xxx) 금지 → colors.ts 토큰 사용".
// 런타임 비용 0. 실행: `npx tsx scripts/check-no-hardcoded-hero-colors.ts`
// 위반 1건 이상 시 비-0 종료.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');

// 검사 대상 파일 (DAR-269 범위)
const TARGETS = [
  'app/(tabs)/home/index.tsx',
  'app/(tabs)/settings/index.tsx',
  'components/common/SnackbarProvider.tsx',
];

// 하드코딩 색상 패턴: #RGB/#RRGGBB/#RRGGBBAA, rgb()/rgba() 숫자 리터럴
const HEX = /#[0-9A-Fa-f]{3,8}\b/g;
const RGB = /rgba?\(\s*\d[\d.,\s]*\)/g;

// 토큰화가 실제로 일어났음을 양성 확인(소비처별 필수 토큰 참조).
const REQUIRED_TOKENS: Record<string, string[]> = {
  'app/(tabs)/home/index.tsx': [
    'colors.onColor',
    'colors.onColorMuted',
    'colors.hairlineOnColor',
    'colors.error',
    'palette.white',
  ],
  'app/(tabs)/settings/index.tsx': [
    'colors.avatarOnColor',
    'colors.onColorSubtle',
    'colors.onColorStrong',
  ],
  'components/common/SnackbarProvider.tsx': [
    'colors.snackbarBackground',
    'colors.snackbarText',
  ],
};

let failures = 0;
let checks = 0;

for (const rel of TARGETS) {
  const src = readFileSync(resolve(root, rel), 'utf8');

  // 1) 하드코딩 hex 0건
  checks++;
  const hex = src.match(HEX) ?? [];
  if (hex.length > 0) {
    failures++;
    console.error(`✗ ${rel}: 하드코딩 hex ${hex.length}건 → ${[...new Set(hex)].join(', ')}`);
  } else {
    console.log(`✓ ${rel}: 하드코딩 hex 0`);
  }

  // 2) 하드코딩 rgb/rgba 0건
  checks++;
  const rgb = src.match(RGB) ?? [];
  if (rgb.length > 0) {
    failures++;
    console.error(`✗ ${rel}: 하드코딩 rgb(a) ${rgb.length}건 → ${[...new Set(rgb)].join(', ')}`);
  } else {
    console.log(`✓ ${rel}: 하드코딩 rgb(a) 0`);
  }

  // 3) 필수 토큰 참조 존재(토큰화 양성 검증)
  for (const token of REQUIRED_TOKENS[rel]) {
    checks++;
    if (src.includes(token)) {
      console.log(`✓ ${rel}: ${token} 참조`);
    } else {
      failures++;
      console.error(`✗ ${rel}: ${token} 참조 누락`);
    }
  }
}

// 4) colors.ts 에 신규 토큰이 light/dark 양모드에 정의됐는지 확인
const colorsSrc = readFileSync(resolve(root, 'theme/colors.ts'), 'utf8');
const NEW_TOKENS = [
  'onColor',
  'onColorStrong',
  'onColorMuted',
  'onColorSubtle',
  'onColorFaint',
  'hairlineOnColor',
  'avatarOnColor',
  'snackbarBackground',
  'snackbarText',
];
const lightBlock = colorsSrc.slice(colorsSrc.indexOf('lightColors'), colorsSrc.indexOf('darkColors'));
const darkBlock = colorsSrc.slice(colorsSrc.indexOf('darkColors'));
for (const token of NEW_TOKENS) {
  checks++;
  const inLight = new RegExp(`\\b${token}:`).test(lightBlock);
  const inDark = new RegExp(`\\b${token}:`).test(darkBlock);
  if (inLight && inDark) {
    console.log(`✓ colors.ts: ${token} (light+dark)`);
  } else {
    failures++;
    console.error(`✗ colors.ts: ${token} 누락 (light=${inLight}, dark=${inDark})`);
  }
}

console.log(`\n${checks - failures}/${checks} checks passed`);
if (failures > 0) {
  console.error(`FAIL: ${failures} violation(s)`);
  process.exit(1);
}
console.log('PASS: 하드코딩 색상 0, 토큰 경유 확인');
