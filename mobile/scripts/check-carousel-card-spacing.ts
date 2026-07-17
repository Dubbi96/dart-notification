// DAR-319 결정론 체크: '오늘 주목할 신호'/'오늘의 투자판단' 가로 캐러셀 카드 겹침 수정.
//
// 버그: 카드 간격을 carousel contentContainerStyle 의 `gap: spacing.md` 로 줬는데,
//   Android RN0.85 Fabric 가로 FlatList 는 contentContainer gap 을 카드 사이에 적용하지
//   않을 수 있다 → 카드가 cardWidth 폭으로 '붙어서/겹쳐서' 렌더되고, 한편 스냅 간격은
//   snapToInterval = cardWidth + gap 이라 렌더 pitch 와 스냅 pitch 가 어긋난다.
//   (작성자도 스켈레톤은 marginRight 로, 실제 카드는 gap 으로 — 방식이 불일치했다.)
//
// 수정: 카드 간격을 각 카드의 marginRight(= CAROUSEL_GAP)로 결정론 적용(스켈레톤과 동일 방식).
//   gap 지원 여부와 무관하게 렌더 pitch = cardWidth + marginRight === snapToInterval 가 보장된다.
//
// 1) 레이아웃 모델: gap 미적용 환경에서 버그 재현(대조군) + marginRight 수정 후 pitch 일치.
// 2) 소스 바인딩: 두 카루셀이 contentContainer gap 제거 + 카드 marginRight 적용,
//    스켈레톤/실제 카드 간격 방식 일관, snapToInterval 유지.
//
// 실행: npx tsx scripts/check-carousel-card-spacing.ts
import { readFileSync } from 'fs';
import { join } from 'path';

import { computeCarouselMetrics, CAROUSEL_GAP } from '../utils/carouselMetrics';

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean) {
  if (cond) {
    pass += 1;
    console.log(`  ✓ ${name}`);
  } else {
    fail += 1;
    console.log(`  ✗ ${name}`);
  }
}

const read = (rel: string) => readFileSync(join(__dirname, '..', rel), 'utf8');

// 대표 기기 폭(좁은 폰 ~ 태블릿). 사용자 실기기 리포트는 기기 폭/카드 수 의존이었다.
const widths = [320, 360, 390, 412, 430, 768, 1024];

console.log('— 레이아웃 모델: 카드 pitch vs 스냅 pitch —');

/**
 * 가로 FlatList 카드의 좌측 경계 위치를 모델링.
 * spacingApplied=false 면 contentContainer gap 이 무시되는(Android Fabric 의심) 환경,
 * cardMarginRight 는 각 카드에 직접 준 marginRight.
 */
function cardLeftEdges(
  cardWidth: number,
  containerGap: number,
  cardMarginRight: number,
  gapApplied: boolean,
  count: number,
): number[] {
  const effectiveGap = (gapApplied ? containerGap : 0) + cardMarginRight;
  const pitch = cardWidth + effectiveGap;
  return Array.from({ length: count }, (_, i) => i * pitch);
}

// (대조군) 버그 재현: gap 으로만 간격 → gap 미적용 환경에서 카드가 붙고 스냅과 어긋난다.
for (const w of widths) {
  const { cardWidth, snapToInterval } = computeCarouselMetrics(w);
  const buggyEdges = cardLeftEdges(cardWidth, CAROUSEL_GAP, 0, false, 3);
  const buggyPitch = buggyEdges[1] - buggyEdges[0];
  // 렌더 pitch(cardWidth) < snapToInterval(cardWidth+gap) → 다음 카드가 스냅 위치 앞에 겹쳐 보인다.
  check(
    `[대조군 ${w}] gap-only + gap미적용: 렌더 pitch(${buggyPitch}) < snap(${snapToInterval}) → 겹침/어긋남`,
    buggyPitch < snapToInterval && buggyPitch === cardWidth,
  );
}

// (수정 후) marginRight 로 간격 → gap 지원 여부와 무관하게 pitch === snapToInterval.
for (const w of widths) {
  const { cardWidth, snapToInterval } = computeCarouselMetrics(w);
  for (const gapApplied of [true, false]) {
    // 수정안은 contentContainer gap 을 제거(0)하고 카드 marginRight = CAROUSEL_GAP.
    const edges = cardLeftEdges(cardWidth, 0, CAROUSEL_GAP, gapApplied, 4);
    const pitch = edges[1] - edges[0];
    // 렌더 pitch == 스냅 간격 → 카드가 정확히 스냅 단위로 배치, 겹침 0.
    check(
      `[수정 ${w}] marginRight 간격(gapApplied=${gapApplied}): pitch(${pitch}) === snap(${snapToInterval})`,
      pitch === snapToInterval,
    );
    // 인접 카드 경계가 음수로 겹치지 않는다(다음 카드 left >= 이전 카드 right).
    const noOverlap = edges.every((x, i) => i === 0 || x >= edges[i - 1] + cardWidth);
    check(`[수정 ${w}] 인접 카드 겹침 0(left>=prev right, gapApplied=${gapApplied})`, noOverlap);
  }
}

console.log('\n— 소스 바인딩 —');

const home = read('components/home/HomeSignalPreview.tsx');
const curatedCard = read('components/signals/CuratedSignalCard.tsx');
// DAR-535: 구 CurationSlot 카루셀은 신호탭 에디션 축 전환으로 폐기 — 홈 카루셀만 검증한다.

// carousel contentContainer 에서 gap 제거(미적용 위험 회피). carousel 블록 안에 gap: 없음.
const carouselBlock = (src: string) => (src.match(/carousel:\s*\{[^}]*\}/s) ?? [''])[0];
check('Home: carousel contentContainer 에 gap 없음', !/gap:/.test(carouselBlock(home)));

// 카드 컴포넌트는 marginRight: CAROUSEL_GAP 로 간격(스켈레톤과 동일 방식).
check('CuratedSignalCard: CAROUSEL_GAP import', /import\s*\{\s*CAROUSEL_GAP\s*\}\s*from\s*'@utils\/carouselMetrics'/.test(curatedCard));
check('CuratedSignalCard: cardTouchable marginRight: CAROUSEL_GAP', /cardTouchable:\s*\{[^}]*marginRight:\s*CAROUSEL_GAP/s.test(curatedCard));
check('CuratedSignalCard: 외곽 TouchableOpacity 에 cardTouchable 적용', /style=\{styles\.cardTouchable\}/.test(curatedCard));
check('Home: CAROUSEL_GAP import', /import\s*\{\s*CAROUSEL_GAP\s*\}\s*from\s*'@utils\/carouselMetrics'/.test(home));
check('Home(SignalPreviewCard): cardTouchable marginRight: CAROUSEL_GAP', /cardTouchable:\s*\{[^}]*marginRight:\s*CAROUSEL_GAP/s.test(home));
check('Home: 카드 TouchableOpacity 에 cardTouchable 적용', /style=\{styles\.cardTouchable\}/.test(home));

// 스켈레톤은 기존대로 marginRight 로 간격 → 실제 카드와 동일 방식(일관).
check('Home: skeletonCard marginRight 유지(실제 카드와 동일 방식)', /skeletonCard:\s*\{[^}]*marginRight:\s*spacing\.md/s.test(home));

// 카드 단위 스냅 유지(회귀 가드).
check('Home: snapToInterval 유지', /snapToInterval=\{snapToInterval\}/.test(home));

// CAROUSEL_GAP === spacing.md(=12) — marginRight 와 스켈레톤(spacing.md)이 같은 값.
check('CAROUSEL_GAP === 12 (spacing.md 와 동일 — 스켈레톤/카드 간격 동값)', CAROUSEL_GAP === 12);

console.log(`\n결과: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
