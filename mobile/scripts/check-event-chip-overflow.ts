/**
 * DAR-191 결정론적 검증: 매수 신호 카드 헤더(headerLeft = flex row)에서
 * 긴 이벤트 칩이 같은 행의 기업명(corpName)을 짓눌러 "삼…"으로 축약하던 버그.
 *
 * RN flexbox 단일 행(numberOfLines=1) 축약 동작을 모델링해
 * "수정 전: 기업명 클립 / 수정 후: 기업명 완전 표시, 칩이 대신 축약"을 증명한다.
 *
 * 모델(dp 단위):
 * - headerLeft 가용 폭 W, gap G.
 * - chip 자연폭 C, corpName 자연폭 N.
 * - chip props: flexShrink(0|1), maxWidthPct(없으면 null).
 * - RN 기본 flexShrink=0 (web과 달리). corpName은 항상 flexShrink=0.
 * - chip의 최소 폭(ellipsis "…" 노출) = CHIP_MIN.
 *
 * 반환: { chipW, corpW } 최종 표시 폭. corpW < N 이면 기업명 클립(버그).
 */

const CHIP_MIN = 28; // 칩이 ellipsis까지 줄어드는 최소 폭

interface ChipProps {
  flexShrink: 0 | 1;
  maxWidthPct: number | null;
}

function layoutHeaderLeft(
  W: number,
  G: number,
  C: number,
  N: number,
  chip: ChipProps,
): { chipW: number; corpW: number } {
  // maxWidth는 flex-basis 상한으로 작용(칩 자연폭을 먼저 캡).
  const cap = chip.maxWidthPct != null ? W * chip.maxWidthPct : Infinity;
  const chipBasis = Math.min(C, cap);
  const total = chipBasis + G + N;

  if (total <= W) {
    // 넘치지 않음 → 아무도 줄지 않음, 기업명 완전 표시.
    return { chipW: chipBasis, corpW: N };
  }

  const overflow = total - W;
  if (chip.flexShrink === 1) {
    // 칩이 먼저 양보(ellipsis 최소까지). 흡수하고 남으면 기업명 클립.
    const absorb = Math.min(overflow, chipBasis - CHIP_MIN);
    const chipW = chipBasis - absorb;
    const remaining = overflow - absorb;
    const corpW = Math.max(0, N - remaining);
    return { chipW, corpW };
  }

  // flexShrink=0 (수정 전): 아무도 안 줄어듦 → 마지막 항목(corpName)이 컨테이너에 클립.
  const corpW = Math.max(0, W - chipBasis - G);
  return { chipW: chipBasis, corpW };
}

interface Case {
  name: string;
  W: number; // headerLeft 가용 폭 (360dp 폰: 카드 padding+gradeChip 차감 후 ~205dp)
  C: number; // 이벤트 라벨 칩 자연폭
  N: number; // 기업명 자연폭
  buggy: boolean; // 수정 전 충돌(칩+기업명 > W)이 발생해 기업명이 클립되는 케이스인가
}

const G = 8; // spacing.sm
const BEFORE: ChipProps = { flexShrink: 0, maxWidthPct: null };
const AFTER: ChipProps = { flexShrink: 1, maxWidthPct: 0.5 }; // DAR-191 수정값

// 360dp 폰 기준. 긴 라벨 칩 ~150-180dp, headerLeft 가용 ~205dp.
const cases: Case[] = [
  { name: '신주인수권부사채(BW) 발행 + "삼성전자"',          W: 205, C: 178, N: 64, buggy: true },
  { name: '제3자배정 유상증자 + "한화에어로스페이스"',        W: 205, C: 168, N: 120, buggy: true },
  { name: '감사의견 거절·한정 + "카카오뱅크"',               W: 205, C: 152, N: 88, buggy: true },
  // 비충돌(짧은 라벨): 수정 후에도 불필요하게 칩을 자르지 않아야 함(회귀 가드).
  { name: '유상증자 + "삼성전자" (충돌 없음)',               W: 205, C: 80, N: 64, buggy: false },
];

let failures = 0;
let buggyConfirmed = 0;
for (const c of cases) {
  const before = layoutHeaderLeft(c.W, G, c.C, c.N, BEFORE);
  const after = layoutHeaderLeft(c.W, G, c.C, c.N, AFTER);

  const beforeClipped = before.corpW < c.N; // 버그 재현(기업명 잘림)
  const afterFull = after.corpW === c.N; // 수정 후 기업명 완전 표시(DoD 핵심)
  const noRegression = after.corpW >= before.corpW; // 절대 더 나빠지지 않음
  // 충돌 케이스만 칩 축약을 요구. 비충돌은 칩 원본 유지(과축약 금지).
  const chipBehavior = c.buggy ? after.chipW < c.C : after.chipW === c.C;

  if (beforeClipped) buggyConfirmed++;
  // 충돌 케이스는 before 클립까지 검증(버그 실재 증명). 비충돌은 before/after 모두 full.
  const reproOk = c.buggy ? beforeClipped : !beforeClipped;
  const ok = reproOk && afterFull && noRegression && chipBehavior;
  if (!ok) failures++;

  console.log(
    `${ok ? 'PASS' : 'FAIL'} | ${c.name}\n` +
      `   before: corpName ${before.corpW}/${c.N}dp ${beforeClipped ? '(클립 ✗ "삼…")' : '(full)'}` +
      `  chip ${before.chipW}dp\n` +
      `   after : corpName ${after.corpW}/${c.N}dp ${afterFull ? '(full ✓)' : '(클립 ✗)'}` +
      `  chip ${after.chipW}dp ${after.chipW < c.C ? '(축약)' : '(원본유지)'}`,
  );
}

console.log(
  `\n결과: ${cases.length - failures}/${cases.length} PASS · 버그 재현(before 클립) ${buggyConfirmed}/${cases.filter((c) => c.buggy).length} 충돌케이스`,
);
if (failures > 0) {
  console.error('FAILURES present');
  process.exit(1);
}
console.log('All cases passed');
