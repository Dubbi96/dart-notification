/**
 * DAR-470 결정론적 검증: UX 1차 상호평가 합의 폴리시(설정 아이콘 Feather 통일 +
 * 정렬 방향 표기 + 매직넘버 토큰화).
 *
 *  1) 설정 화면 아이콘 Feather 일괄 전환(app/(tabs)/settings/index.tsx) — Ionicons 혼입 제거.
 *  2) 정렬 칩 방향 인디케이터(components/portfolio/PositionSearchBar.tsx) — 세 정렬 모두
 *     내림차순임을 ▼ 글리프 + a11y('내림차순')로 명시해 예측가능성 강화.
 *  3) 소형 지오메트리 매직넘버 토큰화:
 *     - ScoreBreakdownSection.tsx 막대 height/borderRadius → theme progressBar 토큰, pct 폭 → 명명 상수.
 *     - MarketIndexBadge.tsx 스켈레톤 폭 → 명명 상수, 열 행 간격(marginTop:2) → COLUMN_ROW_GAP 단일화.
 *
 * 순수 모듈(theme/spacing.ts progressBar)은 직접 임포트해 토큰 값을 증명하고,
 * TSX 변경은 소스 바인딩(정적 패턴)으로 불변식을 고정한다.
 * 실행: npx tsx scripts/check-dar470-ux-polish.ts  (실패 시 exit 1)
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { progressBar } from '../theme/spacing';

const __dirname = dirname(fileURLToPath(import.meta.url));

let failures = 0;
let total = 0;
function check(name: string, ok: boolean, detail = ''): void {
  total++;
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'} | ${name}${detail ? `\n   ${detail}` : ''}`);
}

function read(...parts: string[]): string {
  return readFileSync(join(__dirname, '..', ...parts), 'utf8');
}

// ──────────────────────────────────────────────────────────────────────────
// 1) 설정 화면 아이콘 Feather 통일
// ──────────────────────────────────────────────────────────────────────────
const settingsSrc = read('app', '(tabs)', 'settings', 'index.tsx');

check('1a 설정 src에 Ionicons 잔존 없음(혼입 제거)', !/Ionicons/.test(settingsSrc));
check("1b Feather import 존재", /import \{ Feather \} from '@expo\/vector-icons'/.test(settingsSrc));
check('1c MenuItem icon 타입이 Feather.glyphMap', /icon: keyof typeof Feather\.glyphMap/.test(settingsSrc));
check('1d MenuItem 아이콘은 <Feather name={icon} .../>', /<Feather name=\{icon\}/.test(settingsSrc));
check('1e cycle 순환 아이콘 Feather refresh-cw', /<Feather name="refresh-cw"/.test(settingsSrc));
check('1f chevron Feather chevron-right(구 chevron-forward 제거)', /name="chevron-right"/.test(settingsSrc) && !/chevron-forward/.test(settingsSrc));
check('1g 프로모 아이콘 arrow-right-circle(구 arrow-forward-circle 제거)', /name="arrow-right-circle"/.test(settingsSrc) && !/arrow-forward-circle/.test(settingsSrc));

// 행 메뉴 글리프 1:1 매핑(Ionicons -outline → Feather)
const expectedGlyphs = [
  'user', 'star', 'bell', 'bookmark', 'moon', 'type',
  'activity', 'bar-chart-2', 'file-text', 'shield', 'info', 'log-out', 'log-in',
];
for (const g of expectedGlyphs) {
  check(`1h 행 글리프 icon="${g}" 존재`, new RegExp(`icon="${g}"`).test(settingsSrc));
}
check('1i Ionicons -outline 글리프 전부 제거', !/-outline"/.test(settingsSrc));
check('1j avatar name="person" 제거(→user)', !/name="person"/.test(settingsSrc));

// valueChip maxWidth 토큰화
check('1k VALUE_CHIP_MAX_WIDTH 상수 정의(=160)', /const VALUE_CHIP_MAX_WIDTH = 160;/.test(settingsSrc));
check('1l valueChip maxWidth 토큰 사용', /maxWidth: VALUE_CHIP_MAX_WIDTH/.test(settingsSrc));
check('1m valueChip 원시 maxWidth:160 잔존 없음', !/maxWidth: 160/.test(settingsSrc));

// ──────────────────────────────────────────────────────────────────────────
// 2) 정렬 칩 방향 인디케이터
// ──────────────────────────────────────────────────────────────────────────
const searchBarSrc = read('components', 'portfolio', 'PositionSearchBar.tsx');

check("2a DESCENDING_INDICATOR = '▼' 정의", /const DESCENDING_INDICATOR = '▼';/.test(searchBarSrc));
check('2b 칩 라벨에 방향 인디케이터 병기', /\$\{opt\.label\} \$\{DESCENDING_INDICATOR\}/.test(searchBarSrc));
check("2c a11y 라벨에 '내림차순' 명시", /내림차순 정렬/.test(searchBarSrc));
check('2d 세 정렬 옵션(손익/시급도/비중) 보존', /'손익순'/.test(searchBarSrc) && /'시급도순'/.test(searchBarSrc) && /'비중순'/.test(searchBarSrc));

// ──────────────────────────────────────────────────────────────────────────
// 3) 매직넘버 토큰화 — theme progressBar(순수 모듈) + 소스 바인딩
// ──────────────────────────────────────────────────────────────────────────
check('3a progressBar.height === 6', progressBar.height === 6, `got=${progressBar.height}`);
check('3b progressBar.radius === 3(두께/2 알약형)', progressBar.radius === 3, `got=${progressBar.radius}`);

const scoreSrc = read('components', 'signals', 'ScoreBreakdownSection.tsx');
check('3c progressBar 토큰 import', /import \{ spacing, radius, progressBar \} from '@theme\/spacing'/.test(scoreSrc));
check('3d bar height 토큰화', /height: progressBar\.height/.test(scoreSrc));
check('3e bar borderRadius 토큰화', /borderRadius: progressBar\.radius/.test(scoreSrc));
check('3f bar 원시 height:6/borderRadius:3 잔존 없음', !/height: 6,/.test(scoreSrc) && !/borderRadius: 3,/.test(scoreSrc));
check('3g PCT_COLUMN_WIDTH 상수(=56)', /const PCT_COLUMN_WIDTH = 56;/.test(scoreSrc));
check('3h pct width 토큰 사용', /width: PCT_COLUMN_WIDTH/.test(scoreSrc));
check('3i pct 원시 width:56 잔존 없음', !/width: 56,/.test(scoreSrc));

const badgeSrc = read('components', 'home', 'MarketIndexBadge.tsx');
check('3j SKELETON_WIDTH 명명 상수 정의', /const SKELETON_WIDTH = \{ title: 80, market: 44, value: 64, change: 48, basis: 56 \} as const;/.test(badgeSrc));
check('3k COLUMN_ROW_GAP 상수(=2)', /const COLUMN_ROW_GAP = 2;/.test(badgeSrc));
for (const key of ['title', 'market', 'value', 'change', 'basis']) {
  check(`3l 스켈레톤 width SKELETON_WIDTH.${key} 사용`, new RegExp(`width=\\{SKELETON_WIDTH\\.${key}\\}`).test(badgeSrc));
}
check('3m 스켈레톤 원시 폭 리터럴(width={80/44/64/48/56}) 잔존 없음', !/width=\{(80|44|64|48|56)\}/.test(badgeSrc));
check('3n marginTop 모두 COLUMN_ROW_GAP', !/marginTop: 2,/.test(badgeSrc) && /marginTop: COLUMN_ROW_GAP/.test(badgeSrc));

console.log(`\n결과: ${total - failures}/${total} PASS`);
if (failures > 0) {
  console.error('FAILURES present');
  process.exit(1);
}
console.log('All cases passed');
