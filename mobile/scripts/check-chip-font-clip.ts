/**
 * DAR-298 결정론적 검증: 알림 세그먼트 칩·포지션 상태칩에서 한글 받침이 세로로 잘리던 버그.
 *
 * 근본 원인(RN 함정): 타이포 토큰은 명시 lineHeight 를 가진다. RN Text 는 allowFontScaling(기본 true)
 * 에서 fontSize 에 OS 글꼴 배율 S 를 곱하지만, 명시 lineHeight 는 그 배율을 따라 늘지 않는다.
 * 따라서 큰 시스템 폰트(S=1.3~1.5)에서 글리프 높이가 고정 line box(=lineHeight)를 초과해
 * 한글 받침(하단 자음)이 잘린다('전체→저쳐' 등).
 *
 * 수정(DAR-174 정본): 칩 텍스트에 maxFontSizeMultiplier={MAX_CHIP_FONT_SCALE=1.3} 를 적용해
 * 적용 배율을 1.3 으로 캡 → 캡된 fontSize 가 line box 안에 들어와 받침 공간이 확보된다.
 * 평시(S=1.0)에는 캡이 무효(min(1.0,1.3)=1.0)라 시각 불변.
 * 추가로 고정 height 컨테이너(PositionCard statusChip)는 minHeight 로 전환해 늘어나도록 했다.
 *
 * 이 스크립트는 (A) 클리핑 메커니즘 모델로 "수정 전 클립 / 수정 후 미클립 / 평시 동일"을 증명하고,
 * (B) 두 소스 파일에 캡·minHeight 바인딩이 실제로 적용됐는지 정규식으로 확인한다(RN 헤드리스 렌더 불가 대체입증).
 */

import { readFileSync } from 'fs';
import { join } from 'path';

const MAX_CHIP_FONT_SCALE = 1.3; // theme/typography.ts:53 정본 값과 동기화

// ── (A) 클리핑 메커니즘 모델 ─────────────────────────────────────────────
// 명시 lineHeight 는 스케일을 따르지 않으므로 line box 는 고정. fontSize 만 적용배율로 커진다.
// 한글 글리프(받침 포함)는 대략 em(=fontSize) 안에 들어차므로, fontSize > lineBox 면 받침이 잘린다.
function effectiveScale(requestedScale: number, cap: number | null): number {
  return cap == null ? requestedScale : Math.min(requestedScale, cap);
}

function isClipped(baseFontSize: number, lineBox: number, requestedScale: number, cap: number | null): boolean {
  const renderedFont = baseFontSize * effectiveScale(requestedScale, cap);
  // 글리프(받침 포함) 높이 ≈ fontSize. line box 를 초과하면 하단 받침이 잘린다.
  return renderedFont > lineBox + 1e-9;
}

interface ChipText {
  name: string;
  baseFontSize: number; // 타이포 토큰 fontSize
  lineBox: number; // 타이포 토큰 lineHeight (명시 → 스케일 안 따름)
}

// 실제 토큰 값(theme/typography.ts BASE_SIZES / BASE_HEIGHTS).
const CHIP_TEXTS: ChipText[] = [
  { name: '알림 세그먼트 칩 라벨(captionMedium)', baseFontSize: 14, lineBox: 20 },
  { name: '세그먼트 카운트 배지(small)', baseFontSize: 12, lineBox: 16 },
  { name: '포지션 상태칩 라벨(small)', baseFontSize: 12, lineBox: 16 },
];

const BIG_SCALES = [1.3, 1.4, 1.5]; // DoD: 큰 폰트 1.3~1.5x
let failures = 0;

console.log('── (A) 클리핑 메커니즘 모델 ──');
for (const t of CHIP_TEXTS) {
  // 평시(1.0): 캡 유무와 무관하게 클립 없음 + 동일해야 한다(시각 불변).
  const normalNoCap = isClipped(t.baseFontSize, t.lineBox, 1.0, null);
  const normalCap = isClipped(t.baseFontSize, t.lineBox, 1.0, MAX_CHIP_FONT_SCALE);
  const normalOk = !normalNoCap && !normalCap && normalNoCap === normalCap;

  // 큰 폰트: 수정 전(캡 없음)은 DoD 최악 배율(1.5)에서 클립 재현 / 수정 후(캡)는 1.3~1.5 전 구간 미클립.
  const reproOk = isClipped(t.baseFontSize, t.lineBox, 1.5, null); // 버그가 실재해야 의미 있는 테스트
  let fixOk = true;
  const detail: string[] = [];
  for (const s of BIG_SCALES) {
    const before = isClipped(t.baseFontSize, t.lineBox, s, null);
    const after = isClipped(t.baseFontSize, t.lineBox, s, MAX_CHIP_FONT_SCALE);
    if (after) fixOk = false; // 수정 후엔 절대 클립 없어야 함
    detail.push(`S=${s}: before ${before ? '클립✗' : 'ok'} / after ${after ? '클립✗' : 'ok✓'}`);
  }

  const ok = normalOk && reproOk && fixOk;
  if (!ok) failures++;
  console.log(
    `${ok ? 'PASS' : 'FAIL'} | ${t.name} (fs=${t.baseFontSize}, lineBox=${t.lineBox})\n` +
      `   평시 1.0: ${normalOk ? '미클립·캡무효 동일 ✓' : '✗'}\n` +
      `   ${detail.join(' | ')}`,
  );
}

// statusChip 컨테이너: 고정 height(클립) → minHeight(성장). 캡된 큰 글꼴에서도 칩이 늘어남을 모델.
console.log('\n── (A2) 상태칩 컨테이너 height→minHeight ──');
function containerClips(mode: 'fixed' | 'min', containerH: number, contentH: number): boolean {
  // fixed: 내용이 커도 컨테이너가 안 늘어 잘림. min: 내용이 크면 늘어남(미클립).
  return mode === 'fixed' ? contentH > containerH + 1e-9 : false;
}
{
  const containerH = 24;
  // 큰 폰트로 칩 내용(텍스트+패딩)이 컨테이너를 초과하는 상황. 고정 height 면 잘리고 minHeight 면 늘어난다.
  const oversizedContentH = 30;
  const beforeFixed = containerClips('fixed', containerH, oversizedContentH); // 수정 전 height:24
  const afterMin = containerClips('min', containerH, oversizedContentH); // 수정 후 minHeight:24
  const normalContentH = 20; // 평시: 컨테이너 안에 들어옴 → 두 모드 레이아웃 동일
  const normalSame =
    containerClips('fixed', containerH, normalContentH) === containerClips('min', containerH, normalContentH);
  const ok = beforeFixed && !afterMin && normalSame;
  if (!ok) failures++;
  console.log(
    `${ok ? 'PASS' : 'FAIL'} | statusChip: before(height:24) ${beforeFixed ? '초과시 클립✗' : 'ok'} / ` +
      `after(minHeight:24) ${afterMin ? '클립✗' : '성장·미클립✓'} / 평시 동일 ${normalSame ? '✓' : '✗'}`,
  );
}

// ── (B) 소스 바인딩 검증 ──────────────────────────────────────────────
console.log('\n── (B) 소스 바인딩 ──');
const root = join(__dirname, '..');
const notifSrc = readFileSync(join(root, 'app/(tabs)/notifications/index.tsx'), 'utf8');
const posSrc = readFileSync(join(root, 'components/portfolio/PositionCard.tsx'), 'utf8');

const capProp = /maxFontSizeMultiplier=\{MAX_CHIP_FONT_SCALE\}/g;

interface Binding {
  name: string;
  ok: boolean;
}
const bindings: Binding[] = [
  {
    name: 'notifications: MAX_CHIP_FONT_SCALE import',
    ok: /import\s*\{[^}]*\bMAX_CHIP_FONT_SCALE\b[^}]*\}\s*from\s*'@theme'/.test(notifSrc),
  },
  {
    // 세그먼트 라벨 + 카운트 배지 두 곳에 캡.
    name: 'notifications: 칩 텍스트 2곳 maxFontSizeMultiplier 캡',
    ok: (notifSrc.match(capProp) ?? []).length >= 2,
  },
  {
    name: 'PositionCard: MAX_CHIP_FONT_SCALE import',
    ok: /import\s*\{[^}]*\bMAX_CHIP_FONT_SCALE\b[^}]*\}\s*from\s*'@theme'/.test(posSrc),
  },
  {
    name: 'PositionCard: 상태 Chip maxFontSizeMultiplier 캡',
    ok: (posSrc.match(capProp) ?? []).length >= 1,
  },
  {
    name: 'PositionCard: statusChip minHeight 전환(고정 height 제거)',
    ok: /statusChip:\s*\{[^}]*minHeight:\s*24/.test(posSrc) && !/statusChip:\s*\{[^}]*\bheight:\s*24/.test(posSrc),
  },
];

for (const b of bindings) {
  if (!b.ok) failures++;
  console.log(`${b.ok ? 'PASS' : 'FAIL'} | ${b.name}`);
}

const total = CHIP_TEXTS.length + 1 + bindings.length;
console.log(`\n결과: ${total - failures}/${total} PASS`);
if (failures > 0) {
  console.error('FAILURES present');
  process.exit(1);
}
console.log('All checks passed');
