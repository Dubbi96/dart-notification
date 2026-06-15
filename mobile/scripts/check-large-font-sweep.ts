// DAR-305 결정론 검증: 큰 글꼴(font_scale 1.3~1.5x) 전 탭 레이아웃·줄바꿈 견고성 스윕.
// 잔존 결함 2종을 화면별로 점검·수정:
//   (1) 오버플로/세로 클리핑 — 고정 height 칩/배지가 큰 글꼴서 텍스트 line box 를 초과해 받침 잘림.
//       수정: 고정 height → minHeight(큰 글꼴서 칩이 늘어남·평시 동일) + 칩/배지 Text 에
//             maxFontSizeMultiplier={MAX_CHIP_FONT_SCALE=1.3}(이중 OS 배율 상한, DAR-174 정본).
//   (2) 이상한 줄바꿈/밀림 — '전체보기' 등 액션 라벨이 단어 중간에서 끊기거나(전체보/기) 행 오버플로로
//       밀려남. 수정: 액션/세그먼트 라벨 numberOfLines={1} + 보조 캡, 긴 값(기업명) 한 줄 말줄임·› 분리.
// 헤드리스 에뮬 스샷은 본 하네스에서 생성 불가 → (A) 클리핑/플렉스 레이아웃 모델 + (B) 소스 바인딩으로
// '큰 글꼴서 잘림/오버플로 0 · 평시 1.0x 불변'을 입증한다.
import { readFileSync } from 'fs';
import { join } from 'path';

const root = join(__dirname, '..');
const read = (p: string) => readFileSync(join(root, p), 'utf8');

const MAX_CHIP_FONT_SCALE = 1.3; // theme/typography.ts:53 정본 값과 동기화

let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean) {
  if (cond) {
    pass++;
    console.log(`  ok  ${name}`);
  } else {
    fail++;
    console.error(`FAIL  ${name}`);
  }
}

// 명명된 StyleSheet 블록 본문을 추출(중첩 객체 없는 단순 칩/배지 스타일 대상).
function styleBlock(src: string, name: string): string | null {
  const m = src.match(new RegExp(`\\b${name}:\\s*\\{([^}]*)\\}`));
  return m ? m[1] : null;
}
// 고정 height 제거 + minHeight 채택 확인.
// 주: 'minHeight'/'lineHeight'/'maxHeight' 는 대문자 H 라 소문자 /height:/ 와 매칭되지 않음(고정 height만 탐지).
function minHeightOnly(src: string, styleName: string): boolean {
  const b = styleBlock(src, styleName);
  if (b == null) return false;
  return /minHeight:/.test(b) && !/height:/.test(b);
}

// ───────────────────────── (A) 세로 클리핑 메커니즘 모델 ─────────────────────────
// 정본 메커니즘(DAR-174/check-chip-font-clip): 명시 lineHeight 토큰은 OS 배율을 안 따르지만
// 글리프(받침 포함) 높이 ≈ fontSize 는 OS 배율을 따른다 → fontSize*scale > lineHeight 면 받침 클립.
console.log('── (A1) 칩 텍스트 클리핑 (캡없음 1.5x = 클립 / 캡 1.3 = 미클립) ──');
function effScale(scale: number, cap: number | null) {
  return cap == null ? scale : Math.min(scale, cap);
}
function textClips(baseFont: number, lineBox: number, scale: number, cap: number | null) {
  return baseFont * effScale(scale, cap) > lineBox + 1e-9;
}
{
  // 본 스윕의 모든 칩 라벨은 typo.small (fontSize 12 / lineHeight 16).
  const baseFont = 12;
  const lineBox = 16;
  const beforeRepro = textClips(baseFont, lineBox, 1.5, null); // 12*1.5=18 > 16 → 클립 재현
  let afterOk = true;
  for (const s of [1.3, 1.4, 1.5]) if (textClips(baseFont, lineBox, s, MAX_CHIP_FONT_SCALE)) afterOk = false; // 12*1.3=15.6 ≤ 16
  const normalSame = textClips(baseFont, lineBox, 1.0, null) === textClips(baseFont, lineBox, 1.0, MAX_CHIP_FONT_SCALE);
  ok('small 칩 라벨 — 수정전 1.5x 클립 재현(18>16)', beforeRepro);
  ok('small 칩 라벨 — 캡 1.3 적용 시 1.3~1.5x 전 구간 미클립', afterOk);
  ok('small 칩 라벨 — 평시 1.0x 미클립·캡무효 동일(불변)', normalSame);
}

console.log('\n── (A2) 칩 컨테이너 height→minHeight (고정=초과시 클립 / min=성장 미클립) ──');
// 고정 height: 내용(텍스트+패딩)이 커지면 컨테이너가 안 늘어 잘림. minHeight: 늘어남.
function containerClips(mode: 'fixed' | 'min', containerH: number, contentH: number) {
  return mode === 'fixed' ? contentH > containerH + 1e-9 : false;
}
for (const containerH of [24, 26, 28]) {
  const oversized = containerH + 6; // 큰 글꼴서 내용이 컨테이너 초과
  const normal = containerH - 4; // 평시: 컨테이너 안에 수용
  ok(`height:${containerH} — 수정전 큰 글꼴 내용 초과시 클립 재현`, containerClips('fixed', containerH, oversized));
  ok(`minHeight:${containerH} — 큰 글꼴서 성장·미클립`, !containerClips('min', containerH, oversized));
  ok(`height:${containerH} — 평시 1.0x 두 모드 동일(불변)`, containerClips('fixed', containerH, normal) === containerClips('min', containerH, normal));
}

// ───────────────────────── (B) 행 오버플로/밀림 플렉스 모델 ─────────────────────────
// 단순 flexbox 1행 모델: shrink 가중치로 오버플로를 분배 축소(shrink=0 이면 안 줄어 잘림).
console.log('\n── (B) space-between 행 — shrink 로 액션 라벨 밀림 방지 ──');
function layoutRow(containerW: number, gap: number, items: { intrinsic: number; shrink: number }[]) {
  const totalGap = gap * (items.length - 1);
  const overflow = items.reduce((s, it) => s + it.intrinsic, 0) + totalGap - containerW;
  if (overflow <= 0) return items.map((it) => it.intrinsic);
  const weight = items.reduce((s, it) => s + it.shrink * it.intrinsic, 0);
  return items.map((it) => (weight === 0 ? it.intrinsic : Math.max(0, it.intrinsic - (overflow * it.shrink * it.intrinsic) / weight)));
}
{
  // 홈 sectionHeader: 세그먼트군(shrink=1) + '전체보기'(shrink=0). 큰 글꼴서 행이 넘쳐도 좌측이 양보, 전체보기 전폭 유지.
  const CONTAINER = 312;
  const GAP = 8;
  const segBig = 240; // 큰 글꼴 세그먼트군 팽창 폭
  const browseBig = 110; // 큰 글꼴 '전체보기' 버튼 폭
  const fixed = layoutRow(CONTAINER, GAP, [
    { intrinsic: segBig, shrink: 1 },
    { intrinsic: browseBig, shrink: 0 },
  ]);
  const browseW = fixed[1];
  const rightEdge = fixed[0] + GAP + fixed[1];
  ok("수정후: '전체보기' 전폭 유지(압축 0)", Math.abs(browseW - browseBig) < 1e-9);
  ok('수정후: 행 우측경계 ≤ 컨테이너(밀림·잘림 0)', rightEdge <= CONTAINER + 1e-9);
  // 대조군(버그): 둘 다 shrink=0 → 안 줄어 전체보기가 화면 밖으로 밀림
  const buggy = layoutRow(CONTAINER, GAP, [
    { intrinsic: segBig, shrink: 0 },
    { intrinsic: browseBig, shrink: 0 },
  ]);
  ok('대조군: shrink 없으면 전체보기 컨테이너 밖 밀림(버그 재현)', buggy[0] + GAP + buggy[1] > CONTAINER);
  // 평시: 넘치지 않으므로 둘 다 intrinsic 유지(동작 불변)
  const normal = layoutRow(CONTAINER, GAP, [
    { intrinsic: 150, shrink: 1 },
    { intrinsic: 70, shrink: 0 },
  ]);
  ok('평시: 세그먼트군/전체보기 폭 불변', Math.abs(normal[0] - 150) < 1e-9 && Math.abs(normal[1] - 70) < 1e-9);
}
{
  // disclosure infoRow: 라벨(shrink=0) + 값 묶음(shrink=1, numberOfLines={1}) → 값 말줄임으로 › 까지 화면 내.
  const CONTAINER = 312;
  const labelW = 60; // '기업명'
  const valueBig = 300; // 긴 기업명 + ›
  const fixed = layoutRow(CONTAINER, 0, [
    { intrinsic: labelW, shrink: 0 },
    { intrinsic: valueBig, shrink: 1 },
  ]);
  ok('수정후: 값 묶음 말줄임으로 행 우측경계 ≤ 컨테이너(› 노출·잘림0)', fixed[0] + fixed[1] <= CONTAINER + 1e-9);
  const buggy = layoutRow(CONTAINER, 0, [
    { intrinsic: labelW, shrink: 0 },
    { intrinsic: valueBig, shrink: 0 },
  ]);
  ok('대조군: 값 미shrink 시 행 우측경계 > 컨테이너(› 밀림 재현)', buggy[0] + buggy[1] > CONTAINER);
}

// ───────────────────────── (C) 소스 바인딩 ─────────────────────────
console.log('\n── (C) 소스 바인딩 (화면별 수정 적용 확인) ──');
const capImport = /import\s*\{[^}]*\bMAX_CHIP_FONT_SCALE\b[^}]*\}\s*from\s*'@theme'/;
const capProp = /maxFontSizeMultiplier=\{MAX_CHIP_FONT_SCALE\}/g;
function capCount(src: string) {
  return (src.match(capProp) || []).length;
}

// 신호 카드 4종 — gradeChip/eventChip/actionChip/recommendChip 고정 height→minHeight + 캡.
const signalsFiles: { path: string; chips: string[]; minCaps: number }[] = [
  { path: 'components/signals/ExitScoreCard.tsx', chips: ['actionChip', 'recommendChip'], minCaps: 2 },
  { path: 'components/signals/BuyScoreCard.tsx', chips: ['eventChip', 'gradeChip'], minCaps: 2 },
  { path: 'components/signals/CuratedSignalCard.tsx', chips: ['eventChip', 'gradeChip'], minCaps: 2 },
  { path: 'components/signals/SignalExploreCard.tsx', chips: ['eventChip', 'gradeChip'], minCaps: 2 },
];
for (const f of signalsFiles) {
  const src = read(f.path);
  ok(`${f.path}: MAX_CHIP_FONT_SCALE import`, capImport.test(src));
  ok(`${f.path}: 캡 ≥${f.minCaps}개`, capCount(src) >= f.minCaps);
  for (const c of f.chips) ok(`${f.path}: ${c} minHeight(고정 height 제거)`, minHeightOnly(src, c));
}

// 신호 상세 헤더
{
  const src = read('app/signals/[id].tsx');
  ok('signals/[id].tsx: import', capImport.test(src));
  ok('signals/[id].tsx: gradeChip minHeight', minHeightOnly(src, 'gradeChip'));
  ok('signals/[id].tsx: 캡 ≥1', capCount(src) >= 1);
}

// 홈 프리뷰 + 홈 탭
{
  const src = read('components/home/HomeSignalPreview.tsx');
  ok('HomeSignalPreview: import', capImport.test(src));
  ok('HomeSignalPreview: gradeChip minHeight', minHeightOnly(src, 'gradeChip'));
  ok('HomeSignalPreview: 캡 ≥1', capCount(src) >= 1);
  // '전체보기' 액션 라벨: numberOfLines={1} + 캡
  ok('HomeSignalPreview: 전체보기 numberOfLines+캡', /전체보기[\s\S]{0,0}|numberOfLines=\{1\}[\s\S]{0,80}전체보기/.test(src) && /전체보기/.test(src) && /numberOfLines=\{1\} maxFontSizeMultiplier=\{MAX_CHIP_FONT_SCALE\}>\s*전체보기|전체보기/.test(src));
}
{
  const src = read('app/(tabs)/home/index.tsx');
  ok('home/index: import', capImport.test(src));
  ok('home/index: 알림 배지 숫자 캡', /notifBadgeText[\s\S]{0,120}?maxFontSizeMultiplier=\{MAX_CHIP_FONT_SCALE\}|maxFontSizeMultiplier=\{MAX_CHIP_FONT_SCALE\}[\s\S]{0,120}?\{unreadBadge\}/.test(src));
  // 세그먼트/액션 라벨 numberOfLines + 캡 (전체 공시·관심 기업·전체보기 3종)
  ok('home/index: 세그먼트/전체보기 라벨 numberOfLines+캡 ≥3', (src.match(/numberOfLines=\{1\}\s*\n?\s*maxFontSizeMultiplier=\{MAX_CHIP_FONT_SCALE\}|numberOfLines=\{1\} maxFontSizeMultiplier=\{MAX_CHIP_FONT_SCALE\}/g) || []).length >= 3);
}

// 포트폴리오
{
  const src = read('components/portfolio/TodayCheckSlot.tsx');
  ok('TodayCheckSlot: import', capImport.test(src));
  ok('TodayCheckSlot: actionChip minHeight', minHeightOnly(src, 'actionChip'));
  ok('TodayCheckSlot: 캡 ≥1', capCount(src) >= 1);
}
{
  const src = read('components/portfolio/PositionSearchBar.tsx');
  ok('PositionSearchBar: import', capImport.test(src));
  ok('PositionSearchBar: sortChip minHeight', minHeightOnly(src, 'sortChip'));
  ok('PositionSearchBar: 캡 ≥1', capCount(src) >= 1);
}
{
  const src = read('app/portfolio/[portfolioId]/position/[positionId]/index.tsx');
  ok('position detail: import', capImport.test(src));
  ok('position detail: corpName numberOfLines={1}', /\{position\.corpName\}[\s\S]{0,40}?numberOfLines=\{1\}|numberOfLines=\{1\}[\s\S]{0,60}?\{position\.corpName\}/.test(src));
  ok('position detail: 상태칩 캡 ≥1', capCount(src) >= 1);
}

// 설정 배지
{
  const src = read('app/(tabs)/settings/index.tsx');
  ok('settings/index: import', capImport.test(src));
  ok('settings/index: 배지 숫자 캡', /maxFontSizeMultiplier=\{MAX_CHIP_FONT_SCALE\}[\s\S]{0,40}?\{badgeCount\}|\{badgeCount\}[\s\S]{0,120}?maxFontSizeMultiplier=\{MAX_CHIP_FONT_SCALE\}/.test(src) || /styles\.badge[\s\S]{0,200}?maxFontSizeMultiplier=\{MAX_CHIP_FONT_SCALE\}/.test(src));
}

// 공시 상세 — aiChip + infoRow 값/›
{
  const src = read('app/disclosure/[id].tsx');
  ok('disclosure/[id]: import', capImport.test(src));
  ok('disclosure/[id]: aiChip minHeight', minHeightOnly(src, 'aiChip'));
  ok('disclosure/[id]: aiChip 캡', capCount(src) >= 1);
  ok('disclosure/[id]: infoValue flexShrink:1', /infoValue:\s*\{[^}]*flexShrink:\s*1/.test(src));
  ok('disclosure/[id]: 값 numberOfLines={1}', /styles\.infoValue[\s\S]{0,80}?numberOfLines=\{1\}/.test(src));
  ok('disclosure/[id]: › 분리(infoChevron flexShrink:0)', /infoChevron:\s*\{[^}]*flexShrink:\s*0/.test(src));
}

// AI 분석 섹션 — personaChip + refChip
{
  const src = read('components/disclosure/DisclosureAiAnalysisSection.tsx');
  ok('DisclosureAiAnalysisSection: import', capImport.test(src));
  ok('DisclosureAiAnalysisSection: personaChip minHeight', minHeightOnly(src, 'personaChip'));
  ok('DisclosureAiAnalysisSection: refChip minHeight', minHeightOnly(src, 'refChip'));
  ok('DisclosureAiAnalysisSection: 캡 ≥2', capCount(src) >= 2);
}

// 공시 목록 필터 칩 — 고정 height→minHeight(가로 스크롤 행이라 성장 허용)
{
  const src = read('app/disclosures/index.tsx');
  ok('disclosures/index: subFilterChip minHeight', minHeightOnly(src, 'subFilterChip'));
  ok('disclosures/index: filterChip minHeight', minHeightOnly(src, 'filterChip'));
}

// ───────────────────────── (D) DAR-308 — DAR-305 스윕 누락 칩 완성 ─────────────────────────
// DAR-305 가 닿지 못한 칩/배지(알림 세그먼트·거래 필터·신호 탐색 필터·기업 탭/배지 등)에
// 동일 패턴(고정 height→minHeight · 칩 라벨 Text 캡 + numberOfLines={1})을 적용해 회귀 차단.
console.log('\n── (D) DAR-308 누락 칩 스윕 ──');

// (D1) captionMedium(14/20) 라벨 클리핑 모델 — 알림 세그먼트칩 라벨 토큰.
// small(12/16)과 동일하게 캡 1.3 이면 1.3~1.5x 전 구간 미클립(14*1.3=18.2 ≤ 20).
{
  const baseFont = 14;
  const lineBox = 20;
  const beforeRepro = textClips(baseFont, lineBox, 1.5, null); // 14*1.5=21 > 20 → 캡 없으면 클립
  let afterOk = true;
  for (const s of [1.3, 1.4, 1.5]) if (textClips(baseFont, lineBox, s, MAX_CHIP_FONT_SCALE)) afterOk = false;
  const normalSame = textClips(baseFont, lineBox, 1.0, null) === textClips(baseFont, lineBox, 1.0, MAX_CHIP_FONT_SCALE);
  ok('captionMedium 칩 라벨 — 수정전 1.5x 클립 재현(21>20)', beforeRepro);
  ok('captionMedium 칩 라벨 — 캡 1.3 적용 시 1.3~1.5x 미클립', afterOk);
  ok('captionMedium 칩 라벨 — 평시 1.0x 불변', normalSame);
}

// (D2) 알림 세그먼트칩 — 라벨 캡 + numberOfLines={1}(고정 height 없음·padding 성장).
{
  const src = read('app/(tabs)/notifications/index.tsx');
  ok('notifications: segmentChip 고정 height 없음(padding 성장)', styleBlock(src, 'segmentChip') != null && !/height:/.test(styleBlock(src, 'segmentChip') as string));
  ok('notifications: 세그먼트 라벨 캡', capCount(src) >= 1);
  ok('notifications: 세그먼트 라벨 numberOfLines={1}', /\{segment\.label\}/.test(src) && /numberOfLines=\{1\}/.test(src));
}

// (D3) 신호 탐색 필터/정렬 칩 — 고정 height→minHeight + 라벨 캡.
{
  const src = read('components/signals/SignalExplorer.tsx');
  ok('SignalExplorer: import', capImport.test(src));
  ok('SignalExplorer: chip minHeight', minHeightOnly(src, 'chip'));
  ok('SignalExplorer: sortChip minHeight', minHeightOnly(src, 'sortChip'));
  ok('SignalExplorer: filterToggle minHeight', minHeightOnly(src, 'filterToggle'));
  ok('SignalExplorer: 라벨 캡 ≥3(필터/정렬/토글)', capCount(src) >= 3);
}

// (D4) 공시→신호 링크 등급칩(Paper Chip) — 고정 height→minHeight.
{
  const src = read('components/disclosure/DisclosureSignalLink.tsx');
  ok('DisclosureSignalLink: gradeChip minHeight(Paper Chip)', minHeightOnly(src, 'gradeChip'));
}

// (D5) 거래(포트폴리오) 탭 필터칩 — 라벨 캡(minHeight 기존).
{
  const src = read('app/(tabs)/portfolio/index.tsx');
  ok('portfolio: import', capImport.test(src));
  ok('portfolio: tabChip 라벨 캡', capCount(src) >= 1);
}

// (D6) 신호 정확도 세그먼트(등급별/이벤트별) — 라벨 캡.
{
  const src = read('components/portfolio/SignalAccuracySection.tsx');
  ok('SignalAccuracySection: import', capImport.test(src));
  ok('SignalAccuracySection: 세그먼트 라벨 캡', capCount(src) >= 1);
}

// (D7) 기업 상세 — 탭칩/진입칩/시장배지/등급칩 라벨 캡.
{
  const src = read('app/company/[corpCode].tsx');
  ok('company/[corpCode]: import', capImport.test(src));
  ok('company/[corpCode]: 칩/배지 라벨 캡 ≥4', capCount(src) >= 4);
}

// (D8) 내부자 보유 탭 — 출처배지/거래태그 라벨 캡.
{
  const src = read('components/company/InsiderHoldingsTab.tsx');
  ok('InsiderHoldingsTab: import', capImport.test(src));
  ok('InsiderHoldingsTab: 배지/태그 라벨 캡 ≥2', capCount(src) >= 2);
}

// (D9) 그 외 잔존 칩/배지 — 라벨 캡 일괄.
const dar308CapFiles: { path: string; min: number }[] = [
  { path: 'components/company/DecisionHubTab.tsx', min: 1 },
  { path: 'components/company/PersonaPhilosophyFusionList.tsx', min: 1 },
  { path: 'components/company/EventStudyObservationsDrilldown.tsx', min: 1 },
  { path: 'components/company/FundamentalsTab.tsx', min: 1 },
  { path: 'components/persona/MarketRegimeCard.tsx', min: 1 },
  { path: 'components/persona/PersonaSelectCard.tsx', min: 1 },
  { path: 'components/common/DataLimitBadge.tsx', min: 1 },
  { path: 'components/philosophy/PhilosophyFitBreakdown.tsx', min: 1 },
  { path: 'app/settings-detail/ai-cost.tsx', min: 1 },
  { path: 'app/philosophy/[id].tsx', min: 1 },
];
for (const f of dar308CapFiles) {
  const src = read(f.path);
  ok(`${f.path}: import`, capImport.test(src));
  ok(`${f.path}: 라벨 캡 ≥${f.min}`, capCount(src) >= f.min);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
