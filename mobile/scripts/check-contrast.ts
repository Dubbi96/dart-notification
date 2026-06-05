// scripts/check-contrast.ts — 다크모드 '읽어야 하는 텍스트' WCAG AA 대비 점검 (DAR-31 §2 P0-A)
// 런타임 비용 0. 빌드/CI 또는 수동 실행: `node scripts/check-contrast.ts`
// 기준: WCAG AA normal text 4.5:1. 위반 1건 이상 시 비-0 종료.
//
// 점검 대상 = 점수 라벨·근거·면책·EmptyState 메인+보조 문구·ticker·종목코드 등
// '읽어야 하는' 전경 토큰 × 본문 배경(background/surface).
// textTertiary는 순수 장식·비활성 전용(§2 수정규칙)이므로 본문 대비 대상에서 제외한다.

import { darkColors } from '../theme/colors.ts';

function channelToLinear(c: number): number {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
}

function relativeLuminance(hex: string): number {
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return 0.2126 * channelToLinear(r) + 0.7152 * channelToLinear(g) + 0.0722 * channelToLinear(b);
}

function contrastRatio(fg: string, bg: string): number {
  const l1 = relativeLuminance(fg);
  const l2 = relativeLuminance(bg);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

const AA_NORMAL = 4.5;

// '읽어야 하는 텍스트' 전경 토큰 (textTertiary는 장식 전용이라 제외)
const READABLE_FG: Array<{ name: string; hex: string }> = [
  { name: 'text', hex: darkColors.text },
  { name: 'textSecondary', hex: darkColors.textSecondary },
  { name: 'primary', hex: darkColors.primary },
  { name: 'primaryDark', hex: darkColors.primaryDark },
];

// 본문 텍스트가 실제로 얹히는 배경 토큰
const TEXT_BG: Array<{ name: string; hex: string }> = [
  { name: 'background', hex: darkColors.background },
  { name: 'surface', hex: darkColors.surface },
];

let violations = 0;
console.log('다크모드 대비 점검 (WCAG AA 4.5:1) — 읽어야 하는 텍스트\n');
for (const bg of TEXT_BG) {
  for (const fg of READABLE_FG) {
    const ratio = contrastRatio(fg.hex, bg.hex);
    const pass = ratio >= AA_NORMAL;
    if (!pass) violations += 1;
    console.log(
      `  ${pass ? 'PASS' : 'FAIL'}  ${fg.name}(${fg.hex}) on ${bg.name}(${bg.hex}) = ${ratio.toFixed(2)}:1`,
    );
  }
}

console.log(`\n위반 ${violations}건`);
if (violations > 0) {
  process.exit(1);
}
