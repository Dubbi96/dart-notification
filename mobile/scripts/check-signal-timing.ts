/**
 * DAR-369 결정론적 검증: 신호 카드 발생 시점 상시 표기 + 시점 의미 정직.
 *
 * 증상(이슈): 신선 신호엔 SignalFreshnessBadge 가 미표시라 '언제 발생했는지'가 안 보여
 *   판단이 어렵다. 발생 시점(절대일 + 상대)을 신선/만료 무관 항상 노출해야 한다.
 *
 * 이 스크립트가 검증하는 것:
 *  (A) getSignalTiming 분기:
 *      - 공시 접수일 우선: relatedDisclosureRcpNo 앞 8자리(YYYYMMDD) → source='disclosure'.
 *      - 폴백: rcpNo 없음/비실재일 → createdAt → source='signal'('신호' 라벨로 오인 방지).
 *      - 둘 다 없음 → show:false(억지 표기 금지).
 *      - 상대 표기: 오늘/어제/그제/N일 전(KST 달력일), 미래(클럭 스큐) → '오늘'.
 *      - 절대일: 같은 해 'M/D', 다른 해 'YYYY/M/D'.
 *      - KST 경계: UTC 자정 직후도 KST 날짜로 환산.
 *  (B) 카피 정직성: 라벨이 한국어, 공시/신호 출처 구분, raw enum 노출 없음.
 *  (C) 소스 바인딩(DAR-509): SignalExploreCard 가 발생일 표기를 공유 SignalDateBadge SSOT 로
 *      통일 — getSignalDateStatus import·SignalDateBadge 렌더·dateStatus.accessibleText 를
 *      카드 a11y 라벨에 합성(구 인라인 timing.label + SignalFreshnessBadge 대체).
 *
 * 실행: npx tsx scripts/check-signal-timing.ts  (실패 시 exit 1)
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { getSignalTiming } from '../utils/signalTiming.ts';

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

// 기준 now: 2026-06-19 05:00 UTC = 2026-06-19 14:00 KST (금요일).
const NOW = Date.UTC(2026, 5, 19, 5, 0, 0);

// ── (A) getSignalTiming ─────────────────────────────────────────────
console.log('\n[A] getSignalTiming 분기');
{
  // 공시 접수일 우선(rcpNo 앞 8자리). 20260618 = 어제.
  const t = getSignalTiming({ relatedDisclosureRcpNo: '20260618000123', createdAt: '2026-06-01T00:00:00Z' }, NOW);
  check('rcpNo 우선 → source=disclosure', t.source === 'disclosure', t.source);
  check('rcpNo 어제 → 상대 "어제"', t.relativeText === '어제', t.relativeText);
  check('rcpNo 같은 해 → 절대 "6/18"', t.dateText === '6/18', t.dateText);
  check('라벨 합성 "공시 6/18 · 어제"', t.label === '공시 6/18 · 어제', t.label);
  check('a11y "공시 접수 6월 18일, 어제"', t.accessibleText === '공시 접수 6월 18일, 어제', t.accessibleText);
  check('show=true', t.show === true);
}
{
  // 오늘 / 그제 / N일 전.
  const today = getSignalTiming({ relatedDisclosureRcpNo: '20260619000001' }, NOW);
  check('오늘 → "오늘"', today.relativeText === '오늘', today.relativeText);
  const dayBefore = getSignalTiming({ relatedDisclosureRcpNo: '20260617000001' }, NOW);
  check('이틀 전 → "그제"', dayBefore.relativeText === '그제', dayBefore.relativeText);
  const week = getSignalTiming({ relatedDisclosureRcpNo: '20260612000001' }, NOW);
  check('7일 전 → "7일 전"', week.relativeText === '7일 전', week.relativeText);
}
{
  // 다른 해 → 'YYYY/M/D'.
  const t = getSignalTiming({ relatedDisclosureRcpNo: '20251218000001' }, NOW);
  check('다른 해 → 절대 "2025/12/18"', t.dateText === '2025/12/18', t.dateText);
  check('다른 해 라벨에 연도 포함', t.label.includes('2025/12/18'), t.label);
}
{
  // 미래(클럭 스큐) → '오늘'(무의미 'N일 후' 금지).
  const t = getSignalTiming({ relatedDisclosureRcpNo: '20260620000001' }, NOW);
  check('미래 접수일 → "오늘"(스큐 정직화)', t.relativeText === '오늘', t.relativeText);
}
{
  // createdAt 폴백 — rcpNo 없음.
  const t = getSignalTiming({ createdAt: '2026-06-18T01:00:00Z' }, NOW);
  check('rcpNo 없음 → source=signal', t.source === 'signal', t.source);
  check('폴백 라벨 "신호" 접두', t.label.startsWith('신호 '), t.label);
  check('폴백 a11y "신호 생성" 접두', t.accessibleText.startsWith('신호 생성 '), t.accessibleText);
}
{
  // 비실재일 rcpNo(20260230) → createdAt 폴백.
  const t = getSignalTiming({ relatedDisclosureRcpNo: '20260230000001', createdAt: '2026-06-18T01:00:00Z' }, NOW);
  check('비실재일 rcpNo → createdAt 폴백(signal)', t.source === 'signal', t.source);
  // 비숫자/짧은 rcpNo → 폴백.
  const t2 = getSignalTiming({ relatedDisclosureRcpNo: 'abc', createdAt: '2026-06-18T01:00:00Z' }, NOW);
  check('비숫자 rcpNo → createdAt 폴백', t2.source === 'signal', t2.source);
}
{
  // 둘 다 없음 → show:false.
  const t = getSignalTiming({}, NOW);
  check('rcpNo·createdAt 모두 없음 → show:false', t.show === false && t.label === '', `${t.show}/${t.label}`);
  const t2 = getSignalTiming({ createdAt: 'not-a-date' }, NOW);
  check('createdAt 파싱불가 → show:false', t2.show === false, String(t2.show));
}
{
  // KST 경계: UTC 자정 직후(2026-06-19T00:30Z=KST 09:30)도 KST 6/19.
  const nowEarly = Date.UTC(2026, 5, 19, 0, 30, 0);
  const t = getSignalTiming({ relatedDisclosureRcpNo: '20260619000001' }, nowEarly);
  check('KST 경계: 같은 KST 날짜 → "오늘"', t.relativeText === '오늘', t.relativeText);
  // createdAt 이 UTC 로는 전날(2026-06-18T20:00Z)이지만 KST 로는 6/19 → '오늘'.
  const t2 = getSignalTiming({ createdAt: '2026-06-18T20:00:00Z' }, NOW);
  check('createdAt KST 환산(UTC 전날→KST 당일) "오늘"', t2.relativeText === '오늘', `${t2.relativeText} ${t2.dateText}`);
}

// ── (B) 카피 정직성 ──────────────────────────────────────────────────
console.log('\n[B] 카피 정직성');
{
  const samples = [
    getSignalTiming({ relatedDisclosureRcpNo: '20260618000001' }, NOW),
    getSignalTiming({ createdAt: '2026-06-12T01:00:00Z' }, NOW),
  ];
  for (const s of samples) {
    check(`라벨 한국어/raw enum 없음 (${s.label})`, /[가-힣]/.test(s.label) && !/disclosure|signal|undefined|NaN/.test(s.label), s.label);
  }
  const disc = getSignalTiming({ relatedDisclosureRcpNo: '20260618000001' }, NOW);
  const sig = getSignalTiming({ createdAt: '2026-06-18T01:00:00Z' }, NOW);
  check('출처 구분: 공시=공시 접두 / 신호=신호 접두', disc.label.startsWith('공시') && sig.label.startsWith('신호'), `${disc.label} | ${sig.label}`);
}

// ── (C) 소스 바인딩 (SignalExploreCard → SignalDateBadge, DAR-509) ────
console.log('\n[C] 소스 바인딩 — SignalExploreCard (SignalDateBadge 통일)');
{
  const card = readFileSync(join(root, 'components/signals/SignalExploreCard.tsx'), 'utf8');
  check('getSignalDateStatus import(SSOT)', card.includes("from '@utils/signalFreshness'") && card.includes('getSignalDateStatus'));
  check('SignalDateBadge import', card.includes("from '@components/signals/SignalDateBadge'") && card.includes('SignalDateBadge'));
  check('SignalDateBadge 렌더', /<SignalDateBadge/.test(card));
  check('rcpDt 전달(귀속일 정직화)', card.includes('rcpDt={signal.rcpDt}'));
  check('createdAt 전달', card.includes('createdAt={signal.createdAt}'));
  check('a11y 라벨에 dateStatus.accessibleText 합성', card.includes('dateStatus.accessibleText'));
  check('배지 표시 게이트(dateStatus.show)', card.includes('dateStatus.show'));
}

// ── 결과 ────────────────────────────────────────────────────────────
console.log(`\n${fail === 0 ? '✅' : '❌'} signal-timing: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
