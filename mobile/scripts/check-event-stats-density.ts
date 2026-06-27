/**
 * DAR-466(E16) 결정론적 검증: 이벤트 통계 화면(app/event-stats/index.tsx)의 EventRow 수치 컬럼 과밀/절단.
 *
 * 근본 원인(UI 함정): EventRow 가 5개 수치 셀(D+1/D+5/D+20 초과수익·승률·표본)을 한 행에 flex:1 로 균등
 * 배치했다. 좁은 기기(320pt)에서 카드 안쪽 폭이 5등분되면 셀 폭이 '-100.0%'(7자) 글자 폭보다 작아져
 * 값이 가로로 절단된다.
 *
 * 수정: (1) 핵심 지표(초과수익 3종)를 1행, 보조 지표(승률·표본)를 2행으로 분리해 행당 컬럼을 5→3 으로 줄이고,
 *       (2) 셀 값 Text 에 numberOfLines={1} + adjustsFontSizeToFit(minimumFontScale=0.85)을 적용해
 *       폭을 초과해도 줄바꿈·절단 대신 축소되도록 한다.
 *
 * 이 스크립트는 (A) 셀 폭 모델로 "수정 전 5컬럼은 좁은 기기에서 절단 / 수정 후 3컬럼은 미절단"을 증명하고,
 * (B) 소스 파일에 2행 분리·축소 바인딩이 실제로 적용됐는지 정규식으로 확인한다(RN 헤드리스 렌더 불가 대체입증).
 */

import { readFileSync } from 'fs';
import { join } from 'path';

// ── 토큰 동기화(theme/spacing.ts · theme/typography.ts 정본 값) ───────────────
const SPACING = { xs: 4, sm: 8, md: 12, base: 16, lg: 20 } as const;
const BODY_MEDIUM_FONT = 16; // typography.ts BASE_SIZES.bodyMedium
const CHAR_WIDTH_FACTOR = 0.6; // 한 글자 평균 advance ≈ 0.6·fontSize(라틴/숫자 보수적 추정)
const MIN_FONT_SCALE = 0.85; // adjustsFontSizeToFit minimumFontScale

// 절단 위험이 가장 큰 값 문자열(부호+세 자리+소수+퍼센트).
const WORST_VALUE = '-100.0%'; // 7자

let failures = 0;

// ── (A) 셀 폭 모델 ───────────────────────────────────────────────────────
// 카드 안쪽 metrics 폭 = 화면폭 − listContent 좌우(lg) − Card 좌우(base).
function metricsWidth(deviceWidth: number): number {
  return deviceWidth - 2 * SPACING.lg - 2 * SPACING.base;
}
// 행당 cells 개 균등 배치 시 셀 1개 폭(셀 사이 gap 적용).
function cellWidth(deviceWidth: number, cellsPerRow: number, gap: number): number {
  return (metricsWidth(deviceWidth) - gap * (cellsPerRow - 1)) / cellsPerRow;
}
// 값 문자열 렌더 폭. adjustsFontSizeToFit 적용 시 minimumFontScale 까지 축소되어 필요 폭이 줄어든다.
function requiredWidth(value: string, shrink: boolean): number {
  const scale = shrink ? MIN_FONT_SCALE : 1;
  return value.length * BODY_MEDIUM_FONT * CHAR_WIDTH_FACTOR * scale;
}
function isTruncated(cell: number, value: string, shrink: boolean): boolean {
  return requiredWidth(value, shrink) > cell + 1e-9;
}

// 좁은~넓은 기기 스펙트럼(작은 안드로이드/SE → 표준).
const DEVICES = [320, 360, 390];

console.log('── (A) 셀 폭 모델: 5컬럼(수정 전) vs 3컬럼(수정 후) ──');
for (const w of DEVICES) {
  // 수정 전: 5컬럼 1행(space-between·flex:1, 셀 사이 gap 0), 축소 없음.
  const beforeCell = cellWidth(w, 5, 0);
  const beforeTrunc = isTruncated(beforeCell, WORST_VALUE, false);
  // 수정 후: 3컬럼 1행(gap=sm), 축소(adjustsFontSizeToFit) 적용.
  const afterCell = cellWidth(w, 3, SPACING.sm);
  const afterTrunc = isTruncated(afterCell, WORST_VALUE, true);
  // 보조행(승률·표본) 2컬럼은 더 넓으므로 미절단이 자명하지만 함께 검증.
  const after2Cell = cellWidth(w, 2, SPACING.sm);
  const after2Trunc = isTruncated(after2Cell, WORST_VALUE, true);

  const ok = !afterTrunc && !after2Trunc;
  // 좁은 기기(320)에서는 수정 전 절단이 실재해야 테스트가 유의미하다.
  const reproOk = w > 320 ? true : beforeTrunc;

  if (!ok || !reproOk) failures++;
  console.log(
    `${ok && reproOk ? 'PASS' : 'FAIL'} | ${w}pt: ` +
      `before 5컬럼 ${beforeCell.toFixed(1)}pt ${beforeTrunc ? '절단✗' : 'ok'} / ` +
      `after 3컬럼 ${afterCell.toFixed(1)}pt ${afterTrunc ? '절단✗' : '미절단✓'} / ` +
      `보조 2컬럼 ${after2Cell.toFixed(1)}pt ${after2Trunc ? '절단✗' : '미절단✓'}` +
      (w === 320 ? ` (수정 전 절단 재현 ${beforeTrunc ? '✓' : '✗'})` : ''),
  );
}

// 축소 메커니즘 단독 검증: numberOfLines={1}+adjustsFontSizeToFit 는 폭 초과 시 줄바꿈/절단 대신 축소.
{
  const tightCell = requiredWidth(WORST_VALUE, false) - 4; // 일부러 4pt 부족한 셀
  const withoutShrink = isTruncated(tightCell, WORST_VALUE, false); // 축소 없으면 절단
  const withShrink = isTruncated(tightCell, WORST_VALUE, true); // 축소하면 들어감
  const ok = withoutShrink && !withShrink;
  if (!ok) failures++;
  console.log(
    `${ok ? 'PASS' : 'FAIL'} | 축소 메커니즘: 부족폭 셀에서 ` +
      `축소無 ${withoutShrink ? '절단✗' : 'ok'} / 축소有 ${withShrink ? '절단✗' : '미절단✓'}`,
  );
}

// ── (B) 소스 바인딩 검증 ─────────────────────────────────────────────────
console.log('\n── (B) 소스 바인딩 ──');
const root = join(__dirname, '..');
const src = readFileSync(join(root, 'app/event-stats/index.tsx'), 'utf8');

const metricsRowOpenCount = (src.match(/<View style=\{styles\.metricsRow\}>/g) ?? []).length;
const metricCellCount = (src.match(/<MetricCell\b/g) ?? []).length;

interface Binding {
  name: string;
  ok: boolean;
}
const bindings: Binding[] = [
  {
    // metrics 컨테이너는 더 이상 단일 가로 행이 아니다(세로 컨테이너 = gap만, flexDirection:'row' 제거).
    name: "metrics 컨테이너 가로행 해제(flexDirection:'row' 제거)",
    ok: /metrics:\s*\{[^}]*gap:\s*spacing\.md[^}]*\}/.test(src) && !/metrics:\s*\{[^}]*flexDirection:\s*'row'/.test(src),
  },
  {
    name: "metricsRow 스타일 신설(flexDirection:'row')",
    ok: /metricsRow:\s*\{[^}]*flexDirection:\s*'row'/.test(src),
  },
  {
    name: '수치 셀을 2행으로 분리(metricsRow 2개)',
    ok: metricsRowOpenCount === 2,
  },
  {
    name: '전체 수치 셀 5개 보존(MetricCell 5개)',
    ok: metricCellCount === 5,
  },
  {
    name: 'MetricCell 값 Text 한 줄 고정(numberOfLines={1})',
    ok: /numberOfLines=\{1\}/.test(src),
  },
  {
    name: 'MetricCell 값 Text 폭 초과 시 축소(adjustsFontSizeToFit + minimumFontScale)',
    ok: /adjustsFontSizeToFit/.test(src) && /minimumFontScale=\{0\.85\}/.test(src),
  },
  {
    name: 'metricCell flex 자식 축소 허용(minWidth:0)',
    ok: /metricCell:\s*\{[^}]*minWidth:\s*0/.test(src),
  },
];

for (const b of bindings) {
  if (!b.ok) failures++;
  console.log(`${b.ok ? 'PASS' : 'FAIL'} | ${b.name}`);
}

const total = DEVICES.length + 1 + bindings.length;
console.log(`\n결과: ${total - failures}/${total} PASS`);
if (failures > 0) {
  console.error('FAILURES present');
  process.exit(1);
}
console.log('All checks passed');
