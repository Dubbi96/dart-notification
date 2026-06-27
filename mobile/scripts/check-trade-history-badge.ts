// DAR-461 결정론 검증: app/portfolio/trade-history.tsx 뱃지 대비 + DataLimitBadge 일원화.
//
// C3(탭 긴급 건수 뱃지): 흰 텍스트(colors.surface)를 warning(노랑) 배경 위에 쓰면 대비
//   ~1.7:1로 긴급 보정 건수가 사실상 안 보였다. 정본 onColor 패턴(PortfolioRiskBadge 경보)
//   대로 솔리드 error 배경 + colors.onColor(흰) 텍스트로 전환해 대비를 끌어올린다.
// C11(중복 컴포넌트): 동일 이름 DataLimitBadge 2종(로컬 함수 vs @components/common)을
//   일원화 — 로컬은 노출 판정만 하는 PrecisionDataLimitBadge 래퍼로 바꾸고, 시각 표현은
//   공통 components/common/DataLimitBadge 로 렌더(이름 충돌 제거 + 마크업 단일화).
//
// 실행: npx tsx scripts/check-trade-history-badge.ts  (실패 시 exit 1)
import { readFileSync } from 'fs';
import { join } from 'path';

const root = join(__dirname, '..');
const src = readFileSync(join(root, 'app/portfolio/trade-history.tsx'), 'utf8');

let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean): void {
  if (cond) {
    pass++;
    console.log(`  ok  ${name}`);
  } else {
    fail++;
    console.error(`FAIL  ${name}`);
  }
}

// --- C3: 탭 긴급 건수 뱃지 블록(styles.tabBadge 사용처) ---
const badgeIdx = src.indexOf('styles.tabBadge');
ok('C3: tabBadge 사용처 존재', badgeIdx >= 0);
// 뱃지 View 개시 ~ 닫힘까지(다음 `</View>`)를 뱃지 블록으로 본다.
const badgeBlock = badgeIdx >= 0 ? src.slice(badgeIdx, src.indexOf('</View>', badgeIdx)) : '';
ok('C3: 뱃지 배경 = colors.error (warning 아님)', /backgroundColor:\s*colors\.error/.test(badgeBlock));
ok('C3: 뱃지 배경에 colors.warning 미사용', !/backgroundColor:\s*colors\.warning/.test(badgeBlock));
ok('C3: 뱃지 텍스트 = colors.onColor', /color:\s*colors\.onColor/.test(badgeBlock));
ok('C3: 뱃지 텍스트에 colors.surface 미사용(흰글자/노랑배경 1.7:1 제거)', !/color:\s*colors\.surface\b/.test(badgeBlock));

// --- C3: 대비 산식(WCAG) 회귀 봉인 — onColor(흰) on error ≥ 현행 surface on warning ---
function lin(c: number): number {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
}
function L(hex: string): number {
  const h = hex.replace('#', '');
  return (
    0.2126 * lin(parseInt(h.slice(0, 2), 16)) +
    0.7152 * lin(parseInt(h.slice(2, 4), 16)) +
    0.0722 * lin(parseInt(h.slice(4, 6), 16))
  );
}
function cr(a: string, b: string): number {
  const x = L(a);
  const y = L(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}
// light: error=red500 #EF4444 / warning=yellow500 #EAB308, dark: error=red400 #F87171 / warning=yellow400 #FACC15
const before = Math.min(cr('#FFFFFF', '#EAB308'), cr('#FFFFFF', '#FACC15')); // surface on warning
const after = Math.min(cr('#FFFFFF', '#EF4444'), cr('#FFFFFF', '#F87171')); // onColor on error
ok(`C3: 대비 개선(before ${before.toFixed(2)}:1 → after ${after.toFixed(2)}:1)`, after > before);

// --- C11: 동일 이름 중복 컴포넌트 제거 + 공통 일원화 ---
ok('C11: 로컬 function DataLimitBadge() 정의 제거', !/function\s+DataLimitBadge\s*\(/.test(src));
ok('C11: PrecisionDataLimitBadge 래퍼 정의 존재', /function\s+PrecisionDataLimitBadge\s*\(/.test(src));
ok(
  'C11: 공통 components/common/DataLimitBadge import',
  /import\s*\{\s*DataLimitBadge\s*\}\s*from\s*'@components\/common\/DataLimitBadge'/.test(src),
);
ok('C11: 정밀도 탭은 PrecisionDataLimitBadge 렌더', /<PrecisionDataLimitBadge\s*\/>/.test(src));
// 래퍼 본문이 공통 DataLimitBadge 를 렌더(시각 표현 일원화)
const wrapIdx = src.indexOf('function PrecisionDataLimitBadge');
const wrapBlock = wrapIdx >= 0 ? src.slice(wrapIdx, src.indexOf('\n}', wrapIdx)) : '';
ok('C11: 래퍼가 공통 <DataLimitBadge> 렌더', /<DataLimitBadge\b/.test(wrapBlock));

// --- 정리: 사용처 사라진 dataLimitBadge 로컬 스타일 제거(no-unused-styles) ---
ok('정리: 로컬 dataLimitBadge 스타일 제거', !/\bdataLimitBadge:\s*\{/.test(src));

console.log(`\n${pass}/${pass + fail} checks passed`);
if (fail > 0) process.exit(1);
