/**
 * DAR-270 결정론적 검증: rcpDt(yyyyMMdd) → 'yyyy.MM.dd' 포맷의 정본(formatYmdDots) 단일화.
 *
 * 종전: 아래 7개 화면이 정본 utils/datetime.formatYmdDots 대신 date-fns
 *   format(parse(rcpDt, 'yyyyMMdd', new Date()), 'yyyy.MM.dd')
 * 로 동일 포맷을 재구현했다. 문제는 ①동일 로직 8중 정의(정본1+재구현7)
 * ②**잠재 크래시**: rcpDt 가 null·빈값·비8자리면 parse→Invalid Date,
 *   format(Invalid Date) 가 `RangeError: Invalid time value` 를 throw(런타임 크래시).
 * 정본 formatYmdDots 는 정규식 가드(/^\d{8}$/)로 '-' 안전폴백.
 *
 * 해결: 7곳을 formatYmdDots(rcpDt) 로 치환하고 불필요한 date-fns parse/format import 정리.
 * 포맷 결과 문자열은 동일(yyyy.MM.dd) 유지, 잘못된 입력만 '-' 로 안전화.
 *
 * 이 스크립트가 검증하는 것:
 *  (A) 7개 소스 파일에 date-fns yyyyMMdd 포맷 재구현 잔존 0 (grep 어서션)
 *  (B) 7개 소스 파일이 formatYmdDots 정본을 import/사용
 *  (C) 동작: 정상 rcpDt 는 옛 경로와 동일 문자열, 비정상 rcpDt 는
 *      옛 date-fns 경로가 RangeError throw(크래시) vs 정본 formatYmdDots '-' 안전반환
 *
 * 실행: npx tsx scripts/check-ymd-format-canonical.ts  (실패 시 exit 1)
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parse, format } from 'date-fns';

import { formatYmdDots } from '../utils/datetime.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

let failed = 0;
function check(label: string, ok: boolean, detail = ''): void {
  if (!ok) failed += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'} | ${label}${detail ? ' | ' + detail : ''}`);
}

// ── (A)+(B) 소스 grep 어서션 ──────────────────────────────────────────────
// 정본 우회로 알려진 7개 파일. 각 파일은 date-fns yyyyMMdd 재구현이 0이고
// formatYmdDots 를 import/사용해야 한다.
const TARGET_FILES = [
  'components/home/DisclosureFeedCard.tsx',
  'components/company/DecisionHubTab.tsx',
  'app/search/index.tsx',
  'app/settings-detail/saved-disclosures.tsx',
  'app/disclosure/[id].tsx',
  'app/disclosures/index.tsx',
  'app/company/[corpCode].tsx',
];

// date-fns 로 yyyyMMdd 를 파싱/포맷하는 재구현 흔적(어느 하나라도 잔존하면 회귀).
const FORBIDDEN = [/'yyyyMMdd'/, /"yyyyMMdd"/, /'yyyy\.MM\.dd'/, /"yyyy\.MM\.dd"/];

for (const rel of TARGET_FILES) {
  const src = readFileSync(join(root, rel), 'utf8');
  const hits = FORBIDDEN.filter((re) => re.test(src)).map((re) => re.source);
  check(`[A] date-fns yyyyMMdd 재구현 잔존 0 — ${rel}`, hits.length === 0, hits.join(', '));
  check(`[B] formatYmdDots 정본 사용 — ${rel}`, /formatYmdDots\s*\(/.test(src));
}

// ── (C) 동작 동등성 + 크래시 안전성 ───────────────────────────────────────
// 옛 경로(재구현). 비정상 입력에서 RangeError 를 던지는 바로 그 코드.
function legacyFormat(rcpDt: string): string {
  return format(parse(rcpDt, 'yyyyMMdd', new Date()), 'yyyy.MM.dd');
}

// 정상 입력: 정본과 옛 경로 출력 문자열이 바이트 동일해야(가시 변화 0).
for (const ymd of ['20240115', '19991231', '20000229']) {
  const legacy = legacyFormat(ymd);
  const canonical = formatYmdDots(ymd);
  check(`[C] 정상 rcpDt 출력 동일 — ${ymd}`, legacy === canonical, `legacy=${legacy} canonical=${canonical}`);
}

// 비정상 입력: 정본은 항상 '-' 안전반환. 옛 경로는 unsafe 였다 —
//  · 비8자리 문자열(''/'2024'/'abcdefgh'/'2024-01-15'): format(Invalid Date) 가
//    `RangeError: Invalid time value` throw(런타임 크래시).
//  · null/undefined: throw 대신 garbage 문자열('-' 아님) 반환(여전히 오표기).
// 두 실패 모드 모두 정본 '-' 폴백이 제거한다.
const BAD_INPUTS: (string | null | undefined)[] = [null, undefined, '', '2024', 'abcdefgh', '2024-01-15'];
for (const bad of BAD_INPUTS) {
  let legacyThrew = false;
  let legacyResult: string | null = null;
  try {
    // null/undefined 도 옛 코드 경로(parse(string)) 에 그대로 들어가던 값.
    legacyResult = legacyFormat(bad as string);
  } catch (e) {
    legacyThrew = e instanceof RangeError;
  }
  const legacyUnsafe = legacyThrew || legacyResult !== '-';
  const canonical = formatYmdDots(bad);
  check(
    `[C] 비정상 rcpDt 안전화(정본 '-' vs 옛 경로 unsafe) — ${JSON.stringify(bad)}`,
    legacyUnsafe && canonical === '-',
    `legacyThrew=${legacyThrew} legacyResult=${JSON.stringify(legacyResult)} canonical=${JSON.stringify(canonical)}`,
  );
}

if (failed > 0) {
  console.error(`\n${failed} check(s) FAILED`);
  process.exit(1);
}
console.log('\nAll checks passed.');
