/**
 * DAR-437 결정론적 검증: 매수 신호 카드(BuyScoreCard)의 이벤트유형 칩 가로 잘림.
 *
 * 배경 — DAR-191(구): 이벤트 칩을 기업명과 같은 headerLeft 행에 두고
 * flexShrink:1 + maxWidth:50% 로 "기업명 우선"을 달성했다. 그러나 그 대가로
 * 긴 이벤트 라벨('신주인수권부사채(BW) 발행' 등)이 행의 절반 폭으로 캡되어
 * RNP Chip 내부 numberOfLines=1 에 의해 중간 생략(식별 불가)됐다 — 본 이슈의 버그.
 *
 * DAR-437(신): 이벤트 칩을 기업명 아래 **별도 행**으로 분리(SignalExploreCard
 * DAR-307 패턴)하고 maxWidth 캡을 폐기, alignSelf:'flex-start' 로 내용폭 정렬한다.
 * → 기업명은 자기 행에서 온전히, 이벤트 라벨도 카드 폭 안에서 온전히 표시.
 * 카드 폭을 넘는 극단 케이스만 ellipsizeMode='tail' 로 꼬리 생략(중간 잘림 0).
 *
 * 이 스크립트는 RN flexbox 단일 행(numberOfLines=1) 동작을 모델링해
 * "구 설계: 이벤트 라벨 클립 / 신 설계: 이벤트 라벨 완전 표시"를 증명한다.
 *
 * 모델(dp 단위):
 * - 칩 자연폭 C, 칩 최소폭(ellipsis "…") CHIP_MIN.
 * - 구 설계: 가용폭 = headerLeft 폭 W_header, 칩 캡 = 0.5*W_header.
 * - 신 설계: 가용폭 = 카드 콘텐츠 폭 W_row(전폭 단독 행), 캡 없음.
 *
 * 반환: 최종 표시 이벤트 라벨 폭. labelW < C 이면 라벨 잘림(식별 저하).
 */

const CHIP_MIN = 28; // 칩이 ellipsis까지 줄어드는 최소 폭(칩 패딩+"…")

// 구 설계(DAR-191): 같은 행, maxWidth 50% 캡 → 캡 초과분은 라벨이 잘린다.
function layoutSameRow(wHeader: number, chipNaturalW: number): number {
  const cap = wHeader * 0.5;
  if (chipNaturalW <= cap) return chipNaturalW; // 캡 안 → 온전
  return Math.max(CHIP_MIN, cap); // 캡 초과 → 캡 폭으로 라벨 잘림
}

// 신 설계(DAR-437): 전폭 단독 행, 캡 없음 → 행 폭 안이면 온전, 초과만 꼬리 생략.
function layoutDedicatedRow(wRow: number, chipNaturalW: number): number {
  if (chipNaturalW <= wRow) return chipNaturalW; // 행 안 → 온전(짧은 라벨 포함)
  return Math.max(CHIP_MIN, wRow); // 행 초과 → 꼬리 생략(중간 아님)
}

interface Case {
  name: string;
  C: number; // 이벤트 라벨 칩 자연폭(dp)
  clippedBefore: boolean; // 구 설계에서 라벨이 잘렸는가(버그 실재)
}

// 360dp 폰 기준: 카드 콘텐츠 폭 ≈ 360 - 2*16(padding) = 328dp.
// headerLeft 가용 ≈ 등급칩/간격 차감 후 ~205dp → 50% 캡 ≈ 102dp.
const W_HEADER = 205;
const W_ROW = 328;

// 이벤트 라벨 자연폭(12px weight500 한글 ≈ 13dp/자 + 칩 패딩 ~24dp).
const cases: Case[] = [
  { name: '신주인수권부사채(BW) 발행 (최장)', C: 178, clippedBefore: true },
  { name: '제3자배정 유상증자', C: 142, clippedBefore: true },
  { name: '감사의견 거절·한정', C: 128, clippedBefore: true },
  { name: '공급계약 해제·취소', C: 128, clippedBefore: true },
  // 짧은 라벨: 구·신 설계 모두 온전(과잉 잘림 회귀 가드).
  { name: '유상증자 (짧음)', C: 80, clippedBefore: false },
];

let failures = 0;
let buggyConfirmed = 0;
for (const c of cases) {
  const before = layoutSameRow(W_HEADER, c.C);
  const after = layoutDedicatedRow(W_ROW, c.C);

  const beforeClipped = before < c.C; // 구 설계 라벨 잘림
  const afterFull = after === c.C; // 신 설계 라벨 완전 표시(DoD 핵심)
  const noRegression = after >= before; // 절대 더 나빠지지 않음

  if (beforeClipped) buggyConfirmed++;
  // clippedBefore 케이스는 구 설계 잘림 재현까지 검증, 짧은 라벨은 양쪽 온전.
  const reproOk = c.clippedBefore ? beforeClipped : !beforeClipped;
  const ok = reproOk && afterFull && noRegression;
  if (!ok) failures++;

  console.log(
    `${ok ? 'PASS' : 'FAIL'} | ${c.name}\n` +
      `   구(같은 행 50%캡): 라벨 ${before}/${c.C}dp ${beforeClipped ? '(잘림 ✗)' : '(온전)'}\n` +
      `   신(별도 전폭 행) : 라벨 ${after}/${c.C}dp ${afterFull ? '(온전 ✓)' : '(잘림 ✗)'}`,
  );
}

console.log(
  `\n결과: ${cases.length - failures}/${cases.length} PASS · 버그 재현(구 설계 라벨 잘림) ` +
    `${buggyConfirmed}/${cases.filter((c) => c.clippedBefore).length} 케이스`,
);
if (failures > 0) {
  console.error('FAILURES present');
  process.exit(1);
}
console.log('All cases passed');
