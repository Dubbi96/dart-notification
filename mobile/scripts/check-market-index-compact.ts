/**
 * DAR-300 결정론적 검증: 홈 '시장 한눈에'(MarketIndexBadge) 카드 컴팩트화.
 *
 * 버그: KOSPI/KOSDAQ 배지 카드가 인접 홈 카드 대비 세로로 과대(빈 등락 '—'이
 * 정상 등락값과 같은 높이를 예약 + 큰 시스템 폰트 시 OS 배율이 RN 타이포 배율
 * 위에 이중으로 곱해져 카드가 더 부풀어 화면 위계가 울퉁불퉁).
 *
 * 해결(단일 파일 components/home/MarketIndexBadge.tsx):
 *  1) 카드 세로 패딩 base(16)→md(12), 제목-지수 간격 sm(8)→xs(4) 축소.
 *  2) 등락 결측(pct===null) → 아이콘 미렌더 + 옅은 textTertiary + 좌측정렬 컴팩트.
 *  3) 고정·압축 배지 규칙(§9/DAR-174)에 따라 텍스트 maxFontSizeMultiplier 상한.
 *  4) 지수값·라벨·divider·접근성 라벨은 기존 유지(가독성/회귀 0).
 *
 * RN 컴포넌트는 tsx 직접 렌더가 불가(@theme/expo 체인)하므로,
 *  - 결측/정상 분기의 표기 로직은 순수 함수로 재현(모델 검증),
 *  - 시각·스타일 바인딩은 소스 정규식 검증(소스 바인딩)으로 입증한다.
 *
 * 실행: npx tsx scripts/check-market-index-compact.ts  (실패 시 exit 1)
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dir = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(__dir, '../components/home/MarketIndexBadge.tsx'), 'utf8');

let failed = 0;
function check(label: string, got: unknown, want: unknown): void {
  const ok = got === want;
  if (!ok) failed += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : `  (got=${JSON.stringify(got)} want=${JSON.stringify(want)})`}`);
}

// ── 모델: 결측/정상 등락 표기 분기(소스 MarketIndexColumn 로직과 동치) ──────────
function model(pct: number | null) {
  const isMissing = pct === null;
  const renderIcon = !isMissing; // 결측 시 아이콘 미렌더(컴팩트)
  const sign = pct !== null && pct > 0 ? '+' : '';
  const pctText = isMissing ? '—' : `${sign}${pct.toFixed(2)}%`;
  const colorToken = isMissing ? 'textTertiary' : 'pnlColor'; // 옅은 표기
  const weight = isMissing ? '400' : '600';
  return { renderIcon, pctText, colorToken, weight };
}

// 정상 상승: 아이콘 렌더 + 부호 + 표준 색/굵기
check('model: +상승 아이콘 렌더', model(1.23).renderIcon, true);
check('model: +상승 부호 텍스트', model(1.23).pctText, '+1.23%');
check('model: +상승 색=pnlColor', model(1.23).colorToken, 'pnlColor');
check('model: +상승 굵기 600', model(1.23).weight, '600');
// 정상 하락: 음수는 부호 없이 toFixed 가 '-' 포함
check('model: -하락 부호 텍스트', model(-0.5).pctText, '-0.50%');
check('model: -하락 아이콘 렌더', model(-0.5).renderIcon, true);
// 보합
check('model: 0 보합 텍스트', model(0).pctText, '0.00%');
// 결측: 컴팩트 — 아이콘 미렌더 + '—' + 옅은 색 + 가는 굵기
check('model: 결측 아이콘 미렌더', model(null).renderIcon, false);
check('model: 결측 텍스트 —', model(null).pctText, '—');
check('model: 결측 색=textTertiary', model(null).colorToken, 'textTertiary');
check('model: 결측 굵기 400', model(null).weight, '400');

// ── 소스 바인딩: 컴팩트 스타일/접근성/회귀 ────────────────────────────────────
// 1) 세로 패딩 축소: padding:base 통짜 제거, paddingVertical:md + paddingHorizontal:base
check('src: padding 통짜 제거', /\bpadding:\s*spacing\.base/.test(src), false);
check('src: paddingVertical md', /paddingVertical:\s*spacing\.md/.test(src), true);
check('src: paddingHorizontal base', /paddingHorizontal:\s*spacing\.base/.test(src), true);
// 2) 제목-지수 간격 축소(titleRow marginBottom xs)
check('src: titleRow marginBottom xs', /titleRow:[\s\S]*?marginBottom:\s*spacing\.xs/.test(src), true);
// 3) 결측 컴팩트: 아이콘 조건부 렌더 + 결측 전용 스타일
check('src: 아이콘 조건부 렌더(!isMissing)', /\{!isMissing\s*&&\s*<Feather/.test(src), true);
check('src: changeTextMissing 스타일 정의', /changeTextMissing:\s*\{/.test(src), true);
check('src: 결측 textTertiary 색', /textTertiary/.test(src), true);
// 4) 큰 폰트 이중배율 상한(고정 배지)
check('src: MAX_CHIP_FONT_SCALE import', /import\s*\{[^}]*MAX_CHIP_FONT_SCALE[^}]*\}\s*from\s*'@theme'/.test(src), true);
check('src: maxFontSizeMultiplier 적용', (src.match(/maxFontSizeMultiplier=\{MAX_CHIP_FONT_SCALE\}/g) || []).length >= 4, true);
// 5) 회귀: 지수값/라벨/divider/접근성 라벨 보존
check('src: 지수값 formatIndex 보존', /formatIndex\(quote\.closeIndex\)/.test(src), true);
check('src: market 라벨 보존', /\{quote\.market\}/.test(src), true);
check('src: divider 스타일 보존', /divider:\s*\{[\s\S]*?hairlineWidth/.test(src), true);
check('src: 접근성 라벨 보존', /accessibilityLabel=\{`\$\{quote\.market\}/.test(src), true);
check('src: 데이터 없음 가드 보존', /if\s*\(!data\s*\|\|\s*data\.length\s*===\s*0\)\s*return null/.test(src), true);

console.log(failed === 0 ? '\nALL PASS' : `\n${failed} FAILED`);
process.exit(failed === 0 ? 0 : 1);
