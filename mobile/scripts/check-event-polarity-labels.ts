/**
 * DAR-306 결정론적 검증: 이벤트유형·극성 한국어 라벨 맵 누락 → raw enum 노출 차단.
 *
 * 증상(에뮬 QA): 기업상세 '판단' 탭에서 이벤트 분류가 'MAJOR_HOLDER_5PCT',
 *   극성이 '— UNKNOWN' 처럼 영문 enum 원문이 그대로 노출(상용앱 품질 저하).
 * 원인: utils/disclosureType.ts EVENT_TYPE_LABEL 에 백엔드 EventType enum 중
 *   INSIDER_BUY·INSIDER_SELL·MAJOR_HOLDER_5PCT 3종 누락, POLARITY_LABEL 에
 *   UNKNOWN 누락. 헬퍼가 미매핑 시 raw 폴백(`?? eventType`)이라 그대로 샜다.
 *
 * 이 스크립트가 검증하는 것:
 *  (A) 백엔드 prisma `enum EventType` 전 값이 EVENT_TYPE_LABEL 키에 존재(parity).
 *  (B) 누락 3종(INSIDER_BUY/INSIDER_SELL/MAJOR_HOLDER_5PCT) 한국어 라벨 노출.
 *  (C) 극성 UNKNOWN 라벨('미분류 (참고)') 노출.
 *  (D) 방어적 폴백: 미매핑 임의 값도 raw 미노출(안전 한국어 기본 반환).
 *  (E) 회귀: 정상 매핑 값은 기존 라벨 그대로.
 *
 * 실행: npx tsx scripts/check-event-polarity-labels.ts  (실패 시 exit 1)
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  EVENT_TYPE_LABEL,
  POLARITY_LABEL,
  getEventTypeLabel,
  getPolarityLabel,
} from '../utils/disclosureType.ts';

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

// ── 백엔드 EventType enum 전 값 추출(SSOT = prisma schema) ──
const schemaPath = join(repoRoot, 'backend', 'prisma', 'schema.prisma');
const schema = readFileSync(schemaPath, 'utf8');
const enumBlockMatch = schema.match(/enum EventType \{([\s\S]*?)\n\}/);
if (!enumBlockMatch) {
  console.error('FATAL: prisma schema 에서 enum EventType 블록을 찾지 못함');
  process.exit(1);
}
const enumBlock = enumBlockMatch[1];
// 주석(//...) 제거 후 식별자만 수집
const enumValues = enumBlock
  .split('\n')
  .map((l) => l.replace(/\/\/.*$/, '').trim())
  .filter((l) => /^[A-Z][A-Z0-9_]*$/.test(l));

console.log(`\n[A] EventType enum parity (백엔드 ${enumValues.length}종 vs 맵)`);
check('enum 값을 정상 파싱했다(>= 20종)', enumValues.length >= 20, `got ${enumValues.length}`);
for (const v of enumValues) {
  check(
    `EVENT_TYPE_LABEL 에 ${v} 존재`,
    Object.prototype.hasOwnProperty.call(EVENT_TYPE_LABEL, v),
    'raw enum 노출 위험',
  );
}

console.log('\n[B] 이번에 추가된 지분변동 3종 한국어 라벨');
check("INSIDER_BUY = '내부자 매수'", EVENT_TYPE_LABEL.INSIDER_BUY === '내부자 매수');
check("INSIDER_SELL = '내부자 매도'", EVENT_TYPE_LABEL.INSIDER_SELL === '내부자 매도');
check("MAJOR_HOLDER_5PCT = '5% 대량보유'", EVENT_TYPE_LABEL.MAJOR_HOLDER_5PCT === '5% 대량보유');
// 헬퍼 경유 시에도 raw 가 아니라 한국어
check(
  'getEventTypeLabel("MAJOR_HOLDER_5PCT") 가 raw 아님',
  getEventTypeLabel('MAJOR_HOLDER_5PCT') === '5% 대량보유' &&
    !/[A-Z_]{3,}/.test(getEventTypeLabel('MAJOR_HOLDER_5PCT')),
);

console.log('\n[C] 극성 UNKNOWN 라벨');
check("POLARITY_LABEL.UNKNOWN = '미분류 (참고)'", POLARITY_LABEL.UNKNOWN === '미분류 (참고)');
check(
  'getPolarityLabel("UNKNOWN") 가 raw 아님',
  getPolarityLabel('UNKNOWN') === '미분류 (참고)' &&
    !/UNKNOWN/.test(getPolarityLabel('UNKNOWN')),
);

console.log('\n[D] 방어적 폴백 — 미매핑 임의 값도 raw 미노출');
const fakeEvent = 'FUTURE_NEW_EVENT_X';
const fakePolarity = 'FUTURE_NEW_POLARITY_X';
check(
  `getEventTypeLabel("${fakeEvent}") 가 raw 미노출(한국어 기본)`,
  getEventTypeLabel(fakeEvent) === EVENT_TYPE_LABEL.OTHER &&
    !getEventTypeLabel(fakeEvent).includes(fakeEvent),
  `got "${getEventTypeLabel(fakeEvent)}"`,
);
check(
  `getPolarityLabel("${fakePolarity}") 가 raw 미노출(한국어 기본)`,
  getPolarityLabel(fakePolarity) === POLARITY_LABEL.UNKNOWN &&
    !getPolarityLabel(fakePolarity).includes(fakePolarity),
  `got "${getPolarityLabel(fakePolarity)}"`,
);

console.log('\n[E] 회귀 — 기존 매핑 값 라벨 불변');
check("getEventTypeLabel('SUPPLY_CONTRACT') = '대규모 공급계약'", getEventTypeLabel('SUPPLY_CONTRACT') === '대규모 공급계약');
check("getEventTypeLabel('OTHER') = '기타'", getEventTypeLabel('OTHER') === '기타');
check("getPolarityLabel('POSITIVE') = '호재 성격 (참고)'", getPolarityLabel('POSITIVE') === '호재 성격 (참고)');
check("getPolarityLabel('NEGATIVE') = '악재 성격 (참고)'", getPolarityLabel('NEGATIVE') === '악재 성격 (참고)');

console.log(`\n결과: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
