/**
 * DAR-326 결정론적 검증: 신호 신선도 경고(유효기한·경과시간 기반 stale 배지).
 *
 * 증상(에뮬 QA + 코드): Buy/Exit Score 는 생성시점 스냅샷인데 경과/만료 단서가 없어
 *   종목가 급변(▼-6.40%) 후에도 'Buy Score 88' 이 그대로 유효해 보였다(구식 전제 행동 유발).
 *
 * 이 스크립트가 검증하는 것:
 *  (A) businessElapsedMs: 주말(토·일) 구간을 정확히 제외(금요일 평가→월요일 자동 '오래됨' 방지).
 *  (B) getSignalFreshness 분기:
 *      - 만료(now ≥ expiresAt) → 'expired' (createdAt 신선해도 만료 우선).
 *      - 오래됨(만료 없음/미래 + createdAt 평일경과 ≥ 24h) → 'stale'.
 *      - 신선(최근 평가) → 'fresh' + show:false(미표시).
 *      - createdAt 결측 → 판단 불가 → fresh/미표시(억지 경고 금지).
 *      - 미래 expiresAt → 만료 아님(경과로 판정).
 *  (C) 카피 정직성: 라벨이 한국어 + 행동유도이고 raw enum/공포조장 패턴 없음.
 *  (D) 소스 바인딩: 신호상세 + 3개 카드가 SignalFreshnessBadge 를 import·createdAt/expiresAt 전달,
 *      배지가 !show 일 때 null 반환(신선 신호 미표시).
 *
 * 실행: npx tsx scripts/check-signal-freshness.ts  (실패 시 exit 1)
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  getSignalFreshness,
  businessElapsedMs,
  STALE_BUSINESS_HOURS,
} from '../utils/signalFreshness.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

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

const HOUR = 60 * 60 * 1000;

// 로컬 tz 기준으로 특정 요일(getDay)을 만족하는 날짜를 찾는다(주말 판정은 로컬 요일 기준).
function dateOnWeekday(targetDow: number, hour: number): Date {
  // 2026-06-01 부터 14일 내 첫 매칭 요일.
  for (let d = 1; d <= 14; d++) {
    const cand = new Date(2026, 5, d, hour, 0, 0, 0);
    if (cand.getDay() === targetDow) return cand;
  }
  throw new Error('weekday not found');
}

// ── (A) businessElapsedMs — 주말 제외 ───────────────────────────────
console.log('\n[A] businessElapsedMs (평일 환산)');
{
  const wed = dateOnWeekday(3, 10).getTime(); // 수요일 10:00
  check('동일 시각 → 0', businessElapsedMs(wed, wed) === 0);
  check('역전(to<from) → 0', businessElapsedMs(wed + HOUR, wed) === 0);
  check(
    '평일 내 3시간 → 3h(주말 미포함)',
    Math.abs(businessElapsedMs(wed, wed + 3 * HOUR) - 3 * HOUR) < 1,
  );

  const fri = dateOnWeekday(5, 15).getTime(); // 금요일 15:00
  const monSameClock = fri + 3 * 24 * HOUR; // 월요일 15:00 (벽시계 72h)
  const biz = businessElapsedMs(fri, monSameClock);
  check(
    '금15:00→월15:00: 벽시계 72h → 평일 24h(주말 48h 제외)',
    Math.abs(biz - 24 * HOUR) < 1,
    `got ${(biz / HOUR).toFixed(2)}h`,
  );
  check('주말 제외분이 실제로 차감됨(<벽시계)', biz < 72 * HOUR);
}

// ── (B) getSignalFreshness 분기 ─────────────────────────────────────
console.log('\n[B] getSignalFreshness 분기');
{
  const now = new Date(2026, 5, 10, 12, 0, 0, 0).getTime(); // 수요일 정오 기준

  // 만료: now ≥ expiresAt (createdAt 이 방금이라도 만료 우선)
  const expired = getSignalFreshness(
    { createdAt: new Date(now - HOUR).toISOString(), expiresAt: new Date(now - HOUR).toISOString() },
    now,
  );
  check('만료: level=expired', expired.level === 'expired');
  check('만료: show=true', expired.show === true);
  check('만료: tone=alert', expired.tone === 'alert');
  check('만료: 만료 우선(신선 createdAt 무시)', expired.label.includes('만료'));

  // 오래됨: 만료 없음 + createdAt 평일경과 ≥ 24h. 화요일(전 평일) 정오 = 24h 평일경과.
  const tue = new Date(2026, 5, 9, 12, 0, 0, 0); // 수요일 전날(화요일)
  check('픽스처 화요일 확인', tue.getDay() === 2);
  const stale = getSignalFreshness({ createdAt: tue.toISOString() }, now);
  check('오래됨: level=stale', stale.level === 'stale', `got ${stale.level}`);
  check('오래됨: show=true', stale.show === true);
  check('오래됨: tone=warn', stale.tone === 'warn');
  check('오래됨: icon=clock', stale.icon === 'clock');

  // 신선: 최근(3시간 전) → 미표시
  const fresh = getSignalFreshness({ createdAt: new Date(now - 3 * HOUR).toISOString() }, now);
  check('신선: level=fresh', fresh.level === 'fresh');
  check('신선: show=false(미표시)', fresh.show === false);
  check('신선: label 빈문자열', fresh.label === '');

  // createdAt 결측 → 판단 불가 → 미표시
  const noCreated = getSignalFreshness({ createdAt: null, expiresAt: null }, now);
  check('createdAt 결측: show=false(억지 경고 금지)', noCreated.show === false);

  // 미래 expiresAt → 만료 아님(경과로 판정). 최근 createdAt → fresh.
  const futureExpiry = getSignalFreshness(
    {
      createdAt: new Date(now - 2 * HOUR).toISOString(),
      expiresAt: new Date(now + 24 * HOUR).toISOString(),
    },
    now,
  );
  check('미래 expiresAt: 만료 아님', futureExpiry.level !== 'expired');
  check('미래 expiresAt + 최근 createdAt: 신선(미표시)', futureExpiry.show === false);

  // 임계 경계: STALE_BUSINESS_HOURS 직전(평일 23h)은 신선, 직후는 오래됨
  const justUnder = getSignalFreshness(
    { createdAt: new Date(now - (STALE_BUSINESS_HOURS - 1) * HOUR).toISOString() },
    now,
  );
  check('임계 직전(23h, 평일): 신선', justUnder.level === 'fresh', `got ${justUnder.level}`);
}

// ── (C) 카피 정직성 ─────────────────────────────────────────────────
console.log('\n[C] 카피 정직성(공포조장·raw enum 차단)');
{
  const now = Date.now();
  const labels = [
    getSignalFreshness({ expiresAt: new Date(now - HOUR).toISOString() }, now).label,
    getSignalFreshness(
      { createdAt: new Date(2026, 5, 9, 12).toISOString() },
      new Date(2026, 5, 12, 12).getTime(),
    ).label,
  ];
  const enumPattern = /[A-Z]{2,}|_/; // 연속 대문자 or 언더스코어 = enum 누출
  const fearWords = ['위험', '폭락', '손실', '경고!', '주의!!'];
  for (const lbl of labels) {
    check(`라벨 비어있지 않음: "${lbl}"`, lbl.length > 0);
    check(`라벨 raw enum 미노출: "${lbl}"`, !enumPattern.test(lbl));
    check(`라벨 한글 포함: "${lbl}"`, /[가-힣]/.test(lbl));
    check(`라벨 공포조장 단어 없음: "${lbl}"`, !fearWords.some((w) => lbl.includes(w)));
  }
}

// ── (D) 소스 바인딩 ─────────────────────────────────────────────────
console.log('\n[D] 소스 바인딩(상세 + 3 카드 + 배지 미표시 폴백)');
{
  const sites = [
    'app/signals/[id].tsx',
    'components/signals/BuyScoreCard.tsx',
    'components/signals/CuratedSignalCard.tsx',
    'components/signals/SignalExploreCard.tsx',
  ];
  for (const rel of sites) {
    const src = readFileSync(join(root, rel), 'utf8');
    check(`${rel}: SignalFreshnessBadge import`, src.includes("SignalFreshnessBadge"));
    check(`${rel}: createdAt 전달`, /createdAt=\{signal\.createdAt\}/.test(src));
    check(`${rel}: expiresAt 전달`, /expiresAt=\{signal\.expiresAt\}/.test(src));
  }

  const badge = readFileSync(
    join(root, 'components/signals/SignalFreshnessBadge.tsx'),
    'utf8',
  );
  check('배지: !show 시 null 반환(신선 미표시)', /!freshness\.show\)\s*return null/.test(badge));
  check('배지: 판정 로직 SSOT(util) 사용', badge.includes('getSignalFreshness'));
  check('배지: 테마 토큰 색상만(error/warning)', badge.includes('colors.error') && badge.includes('colors.warning'));
  check('배지: Feather clock/alert 아이콘 경유', badge.includes('Feather'));
}

console.log(`\n${fail === 0 ? '✅ PASS' : '❌ FAIL'} — ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
