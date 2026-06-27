/**
 * DAR-449 결정론적 검증: 실제 노출 신호 카드/리스트의 접근성·이벤트 칩 대비 일관화.
 *
 * 배경 — UI/UX 전수 감사 2026-06-27(정본: docs/roadmap/cc-ui-ux-audit-2026-06-27.md).
 * 칩 대비 보강(weight 500, DAR-143)이 미사용 BuyScoreCard 에만 적용되어 실제 노출 카드
 * (Curated/Explore)는 누락, 정렬/필터/빈상태 버튼은 44pt 미만이고 hitSlop 도 없었으며
 * 매도 카드마다 'AI 분석 참고용'이 반복됐다(매수는 푸터 DisclaimerSection 1회).
 *
 * 이 스크립트는 RN을 띄우지 않고 소스 파일을 정적으로 읽어 4개 수정(B4·B7·B8·B14)이
 * 실제 코드에 존재함을 단정한다. 회귀 시 패턴 누락으로 즉시 FAIL.
 *
 * 실행: node scripts/check-signal-card-a11y.ts (Node ≥ 23, 네이티브 TS 실행)
 */

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel: string): string => readFileSync(join(ROOT, rel), 'utf8');

interface Check {
  name: string;
  ok: boolean;
}

const checks: Check[] = [];
const assert = (name: string, ok: boolean) => checks.push({ name, ok });

// ── B4: 실제 노출 카드 이벤트 칩 대비 보강(weight 500) ──────────────────────────
for (const file of [
  'components/signals/CuratedSignalCard.tsx',
  'components/signals/SignalExploreCard.tsx',
]) {
  const src = read(file);
  // 이벤트 칩 textStyle 가 eventChipText(weight 500) 토큰을 참조하는가.
  assert(
    `B4 ${file}: 이벤트 칩 textStyle 에 styles.eventChipText 적용`,
    /textStyle=\{\[typo\.small,\s*styles\.eventChipText,\s*\{\s*color:\s*colors\.textSecondary\s*\}\]\}/.test(src),
  );
  // eventChipText 스타일이 fontWeight '500' 으로 정의됐는가(BuyScoreCard 정본 일치).
  assert(
    `B4 ${file}: eventChipText fontWeight '500' 정의`,
    /eventChipText:\s*\{\s*[^}]*fontWeight:\s*'500'/.test(src),
  );
}

// 정본(BuyScoreCard)도 동일 토큰을 유지하는지(대조 회귀 가드).
{
  const buy = read('components/signals/BuyScoreCard.tsx');
  assert(
    'B4 대조: BuyScoreCard 이벤트 칩 weight 500 정본 유지',
    /eventChipText:\s*\{\s*[^}]*fontWeight:\s*'500'/.test(buy) &&
      /styles\.eventChipText/.test(buy),
  );
}

// ── B7: 정렬/필터 칩 유효 터치 영역 44pt 보정(hitSlop) ──────────────────────────
{
  const explorer = read('components/signals/SignalExplorer.tsx');
  assert('B7 SignalExplorer: 필터칩 hitSlop verticalHitSlopForHeight(34)', /hitSlop=\{verticalHitSlopForHeight\(34\)\}/.test(explorer));
  assert('B7 SignalExplorer: 정렬칩 hitSlop verticalHitSlopForHeight(30)', /hitSlop=\{verticalHitSlopForHeight\(30\)\}/.test(explorer));
  assert('B7 SignalExplorer: touchTarget 헬퍼 import', /from '@utils\/touchTarget'/.test(explorer));
}

// ── B8: 매도 카드 AiReferenceLabel 반복 제거(푸터 1회 패턴으로 정리) ─────────────
{
  const exit = read('components/signals/ExitScoreCard.tsx');
  assert('B8 ExitScoreCard: AiReferenceLabel import 제거', !/AiReferenceLabel/.test(exit));
  // 매도 피드 푸터가 AI 참고 고지(DisclaimerSection)를 1회 제공하는지(피드 화면, 미수정).
  const feed = read('app/(tabs)/signals/index.tsx');
  assert('B8 매도 피드: 푸터 DisclaimerSection 1회 유지(AI 참고 고지)', /ListFooterComponent=\{[^}]*DisclaimerSection/.test(feed));
}

// ── B14: 빈상태 '점수순 전체 탐색' CTA 유효 터치 영역 44pt 보정 ──────────────────
{
  const slot = read('components/signals/CurationSlot.tsx');
  assert('B14 CurationSlot: 빈상태 CTA hitSlop verticalHitSlopForHeight(36)', /hitSlop=\{verticalHitSlopForHeight\(36\)\}/.test(slot));
  assert('B14 CurationSlot: touchTarget 헬퍼 import', /from '@utils\/touchTarget'/.test(slot));
}

// ── 결과 ────────────────────────────────────────────────────────────────────────
let failures = 0;
for (const c of checks) {
  if (!c.ok) failures++;
  console.log(`${c.ok ? 'PASS' : 'FAIL'} | ${c.name}`);
}
console.log(`\n결과: ${checks.length - failures}/${checks.length} PASS`);
if (failures > 0) {
  console.error('FAILURES present');
  process.exit(1);
}
console.log('All checks passed');
