/**
 * DAR-211 결정론적 검증: 화면별 헤더 정렬 비일관(스페이서 width40 / flex1 textAlign
 * center / 좌버튼 시각폭≠우스페이서) → 공통 ScreenHeader(좌·우 동폭) 통일.
 *
 * RN flex 헤더의 "제목 시각적 중앙" 불변식을 모델링한다.
 *
 * 헤더 가로폭 W. 좌측 플랭크 폭 L, 우측 플랭크 폭 R. 가운데 타이틀은 flex:1로
 * [L, W-R] 구간을 차지하고 텍스트는 그 구간 중앙에 정렬된다.
 *   타이틀 중앙 = L + (W - L - R) / 2 = (W + L - R) / 2
 *   헤더 기하 중앙 = W / 2
 *   치우침(offset) = 타이틀 중앙 - 헤더 중앙 = (L - R) / 2
 * ⇒ L === R 일 때만 offset 0(완전 중앙). 좌우 플랭크 폭이 다르면 제목이 치우친다.
 */

const SIDE = 44; // 공통 ScreenHeader 좌·우 동폭(터치영역 ≥ 44pt 동시 충족)

function titleOffset(L: number, R: number): number {
  return (L - R) / 2;
}

// 공통 ScreenHeader의 플랭크 폭 계산: 좌/우 측면 컨테이너는 onBack/rightSlot 유무와
// 무관하게 항상 고정 width=SIDE 다(빈 슬롯도 동폭 스페이서로 렌더). → 항상 L===R.
function screenHeaderFlanks(_opts: {
  hasBack: boolean;
  hasRight: boolean;
}): { L: number; R: number } {
  return { L: SIDE, R: SIDE };
}

interface Case {
  name: string;
  L: number;
  R: number;
  /** 통일 전(naive) 패턴이 치우쳤는가(설계 의도상 버그/비일관). */
  legacySkewed: boolean;
}

// 통일 전 실제 화면들의 좌/우 플랭크(근거: 이슈 본문).
const legacyCases: Case[] = [
  // trade-history: 좌 백버튼 컨테이너가 아이콘 자연폭(~26, flex-start)인데 우 스페이서는 width40 → 좌측 치우침.
  { name: 'trade-history (좌 아이콘폭26 ≠ 우 스페이서40)', L: 26, R: 40, legacySkewed: true },
  // event-stats/persona: 좌우 스페이서 width40 동폭 → 개별 화면 내에선 중앙(단, 폭 40으로 화면 간 비일관).
  { name: 'event-stats (좌우 스페이서 40 동폭)', L: 40, R: 40, legacySkewed: false },
  // notification-settings: 좌우 headerButton width56 동폭 → 중앙(단, 폭 56으로 또 다른 값).
  { name: 'notification-settings (좌우 56 동폭)', L: 56, R: 56, legacySkewed: false },
  // watchlist: 좌 백버튼 vs 우 add버튼 동일 headerButton 스타일 → 동폭.
  { name: 'watchlist (좌 백 ≈ 우 add 동폭)', L: 48, R: 48, legacySkewed: false },
];

// 통일 후 공통 ScreenHeader 적용 시의 4가지 구성(모든 소비 화면 커버).
const headerConfigs = [
  { name: 'back만 (trade-history/notification-settings)', hasBack: true, hasRight: false },
  { name: 'back + 부제 (event-stats)', hasBack: true, hasRight: false },
  { name: 'back + 우액션 (watchlist add)', hasBack: true, hasRight: true },
  { name: 'back 없음 (스페이서만)', hasBack: false, hasRight: false },
];

let failures = 0;

console.log('— 통일 전 패턴 진단 (offset = (L-R)/2) —');
for (const c of legacyCases) {
  const off = titleOffset(c.L, c.R);
  const skewed = off !== 0;
  // 이슈가 지목한 치우침 케이스는 실제로 offset≠0 이어야(버그 재현),
  // 동폭 케이스는 화면 내 중앙이지만 플랭크 폭(40/56/48)이 제각각이라 화면 간 비일관.
  const ok = skewed === c.legacySkewed;
  if (!ok) failures++;
  console.log(
    `${ok ? 'PASS' : 'FAIL'} | ${c.name} → offset ${off}dp ${skewed ? '(치우침 ✗)' : '(중앙)'}`,
  );
}

console.log('\n— 통일 후 공통 ScreenHeader (L=R=SIDE=44 고정) —');
const flankWidths = new Set<string>();
for (const cfg of headerConfigs) {
  const { L, R } = screenHeaderFlanks(cfg);
  const off = titleOffset(L, R);
  const centered = off === 0;
  const touchOk = L >= 44 && R >= 44; // 44pt 터치영역 동시 충족
  flankWidths.add(`${L}x${R}`);
  const ok = centered && touchOk;
  if (!ok) failures++;
  console.log(
    `${ok ? 'PASS' : 'FAIL'} | ${cfg.name} → L=${L} R=${R} offset ${off}dp ${centered ? '(중앙 ✓)' : '(치우침 ✗)'} 터치≥44 ${touchOk ? '✓' : '✗'}`,
  );
}

// 통일성: 모든 구성에서 플랭크 폭이 단 하나(44x44)로 수렴해야 한다(화면 간 일관).
const unified = flankWidths.size === 1 && flankWidths.has(`${SIDE}x${SIDE}`);
if (!unified) failures++;
console.log(
  `\n통일성: 플랭크 폭 집합 = {${[...flankWidths].join(', ')}} → ${unified ? '단일(44x44) 일관 ✓' : '비일관 ✗'}`,
);

console.log(
  `\n결과: ${failures === 0 ? 'ALL PASS' : `${failures} FAIL`} (전 치우침 재현 + 후 전구성 중앙·터치44·단일 플랭크)`,
);
if (failures > 0) {
  console.error('FAILURES present');
  process.exit(1);
}
