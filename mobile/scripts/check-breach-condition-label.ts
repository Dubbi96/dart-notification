/**
 * DAR-314 결정론적 검증: Thesis '훼손 조건' enum 한국어 라벨 맵 누락 → raw enum 노출 차단.
 *
 * 증상(에뮬 QA): 포트폴리오 → 포지션 상세 → Thesis 의 '훼손 조건' 항목이
 *   'PRICE_BELOW', 'AMENDMENT_NEGATIVE' 처럼 영문 enum 원문을 그대로 노출.
 * 원인: 백엔드 position-thesis.service 가 invalidConditions[].type(enum)을 그대로
 *   label 로 내려보내고, mobile thesis.tsx 가 매핑 없이 item.label 을 렌더했다.
 *
 * 이 스크립트가 검증하는 것:
 *  (A) 백엔드 InvalidConditionType union 전 값이 BREACH_CONDITION_LABEL 키에 존재(parity).
 *  (B) 대표 enum(PRICE_BELOW·AMENDMENT_NEGATIVE) 한국어 라벨 노출.
 *  (C) 방어적 폴백: 미매핑 임의 값도 raw 미노출(안전 한국어 기본 반환).
 *  (D) 모든 라벨이 영문 enum 패턴(연속 대문자·언더스코어)을 포함하지 않음.
 *  (E) 소스 바인딩: thesis.tsx 가 헬퍼를 import 하고 raw item.label 을 직접 렌더하지 않음.
 *
 * 실행: npx tsx scripts/check-breach-condition-label.ts  (실패 시 exit 1)
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  BREACH_CONDITION_LABEL,
  BREACH_CONDITION_FALLBACK,
  getBreachConditionLabel,
} from '../utils/breachConditionLabel.ts';

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

// ── 백엔드 InvalidConditionType union 전 값 추출(SSOT) ──
const typesPath = join(
  repoRoot,
  'backend',
  'src',
  'engine4-portfolio-exit',
  'domain',
  'invalid-condition.types.ts',
);
const typesSrc = readFileSync(typesPath, 'utf8');
const unionMatch = typesSrc.match(
  /export type InvalidConditionType =([\s\S]*?);/,
);
if (!unionMatch) {
  console.error('FATAL: invalid-condition.types.ts 에서 InvalidConditionType union 을 찾지 못함');
  process.exit(1);
}
// 작은따옴표로 감싼 enum 식별자만 수집
const enumValues = Array.from(
  unionMatch[1].matchAll(/'([A-Z][A-Z0-9_]*)'/g),
).map((m) => m[1]);

console.log(`\n[A] InvalidConditionType parity (백엔드 ${enumValues.length}종 vs 맵)`);
check('union 값을 정상 파싱했다(>= 8종)', enumValues.length >= 8, `got ${enumValues.length}`);
for (const v of enumValues) {
  check(
    `BREACH_CONDITION_LABEL 에 ${v} 존재`,
    Object.prototype.hasOwnProperty.call(BREACH_CONDITION_LABEL, v),
    'raw enum 노출 위험',
  );
}

console.log('\n[B] 대표 enum 한국어 라벨(이슈 증거)');
check(
  "getBreachConditionLabel('PRICE_BELOW') 가 raw 아님",
  getBreachConditionLabel('PRICE_BELOW') === BREACH_CONDITION_LABEL.PRICE_BELOW &&
    !/PRICE_BELOW/.test(getBreachConditionLabel('PRICE_BELOW')),
  `got "${getBreachConditionLabel('PRICE_BELOW')}"`,
);
check(
  "getBreachConditionLabel('AMENDMENT_NEGATIVE') 가 raw 아님",
  getBreachConditionLabel('AMENDMENT_NEGATIVE') ===
    BREACH_CONDITION_LABEL.AMENDMENT_NEGATIVE &&
    !/AMENDMENT_NEGATIVE/.test(getBreachConditionLabel('AMENDMENT_NEGATIVE')),
  `got "${getBreachConditionLabel('AMENDMENT_NEGATIVE')}"`,
);

console.log('\n[C] 방어적 폴백 — 미매핑 임의 값도 raw 미노출');
const fake = 'FUTURE_NEW_BREACH_X';
check(
  `getBreachConditionLabel("${fake}") 가 raw 미노출(한국어 기본)`,
  getBreachConditionLabel(fake) === BREACH_CONDITION_FALLBACK &&
    !getBreachConditionLabel(fake).includes(fake),
  `got "${getBreachConditionLabel(fake)}"`,
);

console.log('\n[D] 모든 라벨이 영문 enum 패턴 미포함');
for (const [key, label] of Object.entries(BREACH_CONDITION_LABEL)) {
  check(
    `${key} 라벨에 연속 대문자/언더스코어 enum 패턴 없음`,
    !/[A-Z]{2,}|_/.test(label),
    `got "${label}"`,
  );
}
check(
  '폴백 라벨에도 enum 패턴 없음',
  !/[A-Z]{2,}|_/.test(BREACH_CONDITION_FALLBACK),
  `got "${BREACH_CONDITION_FALLBACK}"`,
);

console.log('\n[E] 소스 바인딩 — thesis.tsx 가 헬퍼 경유');
const thesisPath = join(
  root,
  'app',
  'portfolio',
  '[portfolioId]',
  'position',
  '[positionId]',
  'thesis.tsx',
);
const thesisSrc = readFileSync(thesisPath, 'utf8');
check(
  "getBreachConditionLabel 를 import 한다",
  /import \{[^}]*getBreachConditionLabel[^}]*\} from '@utils\/breachConditionLabel'/.test(
    thesisSrc,
  ),
);
check(
  '훼손 조건 표시에 헬퍼를 적용한다(displayLabel)',
  /getBreachConditionLabel\(item\.label\)/.test(thesisSrc),
);
// 렌더(JSX Text)에서 raw item.label 을 직접 출력하지 않음 — displayLabel 경유
check(
  'JSX 에서 raw {item.label} 직접 렌더 없음',
  !/\{item\.label\}/.test(thesisSrc),
  'displayLabel 경유 필요',
);

console.log(`\n결과: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
