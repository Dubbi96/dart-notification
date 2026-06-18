/**
 * DAR-323 결정론적 검증: 신호 '왜 BUY 아닌지' 억제 사유 배지.
 *
 * 증상(에뮬 QA): NEUTRAL/WATCH 신호 상세가 '판정'처럼 보여 '근거 부족(데이터 결핍)'과
 *   '정직하게 약함(데이터는 충분, 점수 낮음)'을 사용자가 구분하지 못한다.
 * 해결: 백엔드 buy-signal 이 suppressionReason enum 도출·영속·DTO 노출(A1 omittedBuckets 활용),
 *   모바일 신호 상세가 Score 근거 섹션 상단에 사유 배지를 렌더(BUY 이상·BLOCKED 는 미표시).
 *
 * 이 스크립트가 검증하는 것:
 *  (A) 백엔드 SuppressionReason union(5종) ↔ 모바일 타입/라벨맵 parity(누락·잉여 0).
 *  (B) 라벨 가독성: 데이터 결핍 4종은 '근거 부족' 접두, GENUINELY_NEUTRAL 은 '근거 부족' 아님.
 *  (C) raw enum 미노출: 모든 라벨에 언더스코어/영문 enum 토큰 미포함.
 *  (D) 폴백: 미매핑 사유도 raw 대신 안전 한국어 배지.
 *  (E) 도출 의미 모델(대조군): BUY 이상·BLOCKED → 사유 없음(배지 미표시),
 *      WATCH/NEUTRAL/AVOID → omittedBuckets 우선순위 대표 1개, omit 없으면 GENUINELY_NEUTRAL.
 *  (F) 소스 바인딩: 상세 화면이 signal.suppressionReason 가드 + getSuppressionReasonBadge 사용,
 *      BUY 이상 미표시는 백엔드 null 계약에 위임(프론트 등급 분기 강제 없음).
 *  (G) 백엔드 영속·DTO 바인딩: signal-generation 의 create/update payload·signals DTO 에 필드 존재.
 *
 * 실행: npx tsx scripts/check-suppression-reason-badge.ts  (실패 시 exit 1)
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  getSuppressionReasonBadge,
} from '../utils/suppressionReasonLabel.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = join(root, '..');

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean, detail = '') {
  if (cond) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

// ── 백엔드 SuppressionReason union(SSOT) 추출 ──
const beSrc = readFileSync(
  join(
    repoRoot,
    'backend/src/engine3-quant-market/buy-signal/suppression-reason.ts',
  ),
  'utf8',
);
// export type SuppressionReason = | 'A' | 'B' ... ; 의 'XXX' 리터럴만 추출
const unionBlock = beSrc.slice(
  beSrc.indexOf('export type SuppressionReason'),
  beSrc.indexOf(';', beSrc.indexOf('export type SuppressionReason')),
);
const BE_REASONS = Array.from(unionBlock.matchAll(/'([A-Z_]+)'/g)).map(
  (m) => m[1],
);

console.log('\n[A] 백엔드 union ↔ 모바일 라벨맵 parity');
const EXPECTED = [
  'EVENT_STUDY_DARK',
  'INDICATORS_MISSING',
  'UNMODELED_EVENT',
  'NO_POLARITY',
  'GENUINELY_NEUTRAL',
];
check(
  `백엔드 union 5종 추출 (${BE_REASONS.join(',')})`,
  BE_REASONS.length === 5 && EXPECTED.every((r) => BE_REASONS.includes(r)),
  `got ${BE_REASONS.length}`,
);

const labelSrc = readFileSync(
  join(root, 'utils/suppressionReasonLabel.ts'),
  'utf8',
);
for (const r of BE_REASONS) {
  check(
    `라벨맵에 ${r} 키 존재`,
    new RegExp(`\\b${r}\\s*:`).test(labelSrc),
  );
}
// 모바일 타입 union 도 동일한지
const typeSrc = readFileSync(join(root, 'types/signal.types.ts'), 'utf8');
for (const r of BE_REASONS) {
  check(`모바일 타입 union 에 ${r} 포함`, typeSrc.includes(`'${r}'`));
}

console.log('\n[B] 라벨 가독성: 근거 부족 vs 정직하게 약함 구분');
const DATA_DARK = [
  'EVENT_STUDY_DARK',
  'INDICATORS_MISSING',
  'UNMODELED_EVENT',
  'NO_POLARITY',
];
for (const r of DATA_DARK) {
  const { label } = getSuppressionReasonBadge(r);
  check(`${r} 라벨에 '근거 부족' 접두`, label.startsWith('근거 부족'), label);
}
const neutral = getSuppressionReasonBadge('GENUINELY_NEUTRAL');
check(
  `GENUINELY_NEUTRAL 은 '근거 부족' 아님(정직한 약세)`,
  !neutral.label.includes('근거 부족'),
  neutral.label,
);
check(
  `GENUINELY_NEUTRAL 라벨이 '약함' 의미 포함`,
  neutral.label.includes('약함'),
  neutral.label,
);

console.log('\n[C] raw enum 미노출(라벨·아이콘 위생)');
for (const r of EXPECTED) {
  const { label, icon } = getSuppressionReasonBadge(r);
  check(`${r} 라벨에 언더스코어/영문 enum 미포함`, !/[A-Z_]{4,}/.test(label), label);
  check(`${r} 아이콘 비어있지 않음`, typeof icon === 'string' && icon.length > 0);
}

console.log('\n[D] 미매핑 폴백(raw 미노출)');
const fb = getSuppressionReasonBadge('SOME_FUTURE_ENUM');
check('미매핑 → raw 미노출(언더스코어 없음)', !fb.label.includes('_'), fb.label);
check('미매핑 → 한국어 안전 라벨', /[가-힣]/.test(fb.label), fb.label);

console.log('\n[E] 도출 의미 모델(백엔드 deriveSuppressionReason 대조군)');
// 백엔드 도출 함수를 직접 import 하면 NestJS 의존이 끌려오므로, 의미를 순수 모델로 재현해
// 백엔드 소스의 분기 키워드와 대조(behavioral parity 가드).
type Grade =
  | 'STRONG_BUY_CANDIDATE'
  | 'BUY_CANDIDATE'
  | 'WATCH'
  | 'NEUTRAL'
  | 'AVOID'
  | 'BLOCKED';
function modelReason(grade: Grade, omitted: string[]): string | null {
  if (
    grade === 'STRONG_BUY_CANDIDATE' ||
    grade === 'BUY_CANDIDATE' ||
    grade === 'BLOCKED'
  ) {
    return null;
  }
  const o = new Set(omitted);
  const reasons: string[] = [];
  if (o.has('historicalEvent')) reasons.push('EVENT_STUDY_DARK');
  if (o.has('chart') || o.has('volumeLiquidity')) reasons.push('INDICATORS_MISSING');
  if (o.has('keyMetric')) reasons.push('UNMODELED_EVENT');
  if (o.has('personaFit')) reasons.push('NO_POLARITY');
  if (reasons.length === 0) reasons.push('GENUINELY_NEUTRAL');
  return reasons[0];
}
// 백엔드 소스에 동일 분기·우선순위 키워드가 존재하는지 바인딩
check('BE: BUY/STRONG_BUY/BLOCKED 조기 null 분기', /STRONG_BUY_CANDIDATE[\s\S]*BUY_CANDIDATE[\s\S]*BLOCKED[\s\S]*return\s*\{\s*reason:\s*null/.test(beSrc));
check('BE: historicalEvent→EVENT_STUDY_DARK', /historicalEvent'\)\)\s*reasons\.push\('EVENT_STUDY_DARK'\)/.test(beSrc));
check("BE: chart||volumeLiquidity→INDICATORS_MISSING", /chart'\)\s*\|\|\s*omitted\.has\('volumeLiquidity'\)/.test(beSrc));
check('BE: keyMetric→UNMODELED_EVENT', /keyMetric'\)\)\s*reasons\.push\('UNMODELED_EVENT'\)/.test(beSrc));
check('BE: personaFit→NO_POLARITY', /personaFit'\)\)\s*reasons\.push\('NO_POLARITY'\)/.test(beSrc));
check('BE: omit 없음→GENUINELY_NEUTRAL', /reasons\.length === 0\)\s*reasons\.push\('GENUINELY_NEUTRAL'\)/.test(beSrc));

// 모델 동작 단언(omit 케이스 → enum)
check('model: WATCH + historicalEvent → EVENT_STUDY_DARK', modelReason('WATCH', ['historicalEvent']) === 'EVENT_STUDY_DARK');
check('model: WATCH + chart → INDICATORS_MISSING', modelReason('WATCH', ['chart']) === 'INDICATORS_MISSING');
check('model: WATCH + keyMetric → UNMODELED_EVENT', modelReason('WATCH', ['keyMetric']) === 'UNMODELED_EVENT');
check('model: WATCH + personaFit → NO_POLARITY', modelReason('WATCH', ['personaFit']) === 'NO_POLARITY');
check('model: NEUTRAL + omit 없음 → GENUINELY_NEUTRAL', modelReason('NEUTRAL', []) === 'GENUINELY_NEUTRAL');
check('model: BUY_CANDIDATE → null(배지 미표시)', modelReason('BUY_CANDIDATE', ['historicalEvent']) === null);
check('model: STRONG_BUY → null', modelReason('STRONG_BUY_CANDIDATE', []) === null);
check('model: BLOCKED → null(blockedReason 전담)', modelReason('BLOCKED', ['chart', 'keyMetric']) === null);
check('model: 복수 omit → 우선순위 대표(historicalEvent 최상위)', modelReason('NEUTRAL', ['keyMetric', 'personaFit', 'historicalEvent']) === 'EVENT_STUDY_DARK');

console.log('\n[F] 모바일 상세 화면 소스 바인딩');
const screenSrc = readFileSync(join(root, 'app/signals/[id].tsx'), 'utf8');
check(
  'suppressionReason 가드 후 배지 렌더',
  /signal\.suppressionReason\s*\?[\s\S]*SuppressionReasonBadge/.test(screenSrc),
);
check(
  'getSuppressionReasonBadge 사용(라벨 직접 하드코딩 아님)',
  screenSrc.includes('getSuppressionReasonBadge'),
);
check(
  'BUY 이상 미표시를 등급 분기로 강제하지 않음(백엔드 null 계약 위임)',
  !/grade\s*[=!]==?\s*['"]BUY['"]/.test(screenSrc),
);
check(
  '배지 a11y 라벨 부여',
  /accessibilityLabel=\{`강한 신호가 아닌 사유/.test(screenSrc),
);

console.log('\n[G] 백엔드 영속·DTO 바인딩');
const genSrc = readFileSync(
  join(repoRoot, 'backend/src/engine3-quant-market/signal-generation/signal-generation.service.ts'),
  'utf8',
);
check(
  'create/update payload 에 suppressionReason 영속(2곳)',
  (genSrc.match(/suppressionReason:\s*r\.suppressionReason/g) ?? []).length === 2,
);
const dtoSrc = readFileSync(
  join(repoRoot, 'backend/src/engine3-quant-market/signals/signals.service.ts'),
  'utf8',
);
check(
  'signals DTO 에 suppressionReason 노출',
  /suppressionReason:\s*s\.suppressionReason/.test(dtoSrc),
);
const schemaSrc = readFileSync(join(repoRoot, 'backend/prisma/schema.prisma'), 'utf8');
check('Prisma TradingSignal 에 suppressionReason 컬럼', /suppressionReason\s+String\?/.test(schemaSrc));

console.log(`\n${'='.repeat(48)}`);
console.log(`결과: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
