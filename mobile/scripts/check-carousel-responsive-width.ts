// DAR-301 결정론 체크: 카루셀 카드 폭 화면 폭 반응형.
// 1) computeCarouselMetrics 순수 로직: 폭에 비례·peek 비율 일정·상한 캡·정수.
// 2) 소스 바인딩: 두 카루셀이 고정 px 제거 + 훅/스냅 사용.
//
// 실행: npx tsx scripts/check-carousel-responsive-width.ts
import { readFileSync } from 'fs';
import { join } from 'path';

import {
  computeCarouselMetrics,
  CAROUSEL_H_PADDING,
  CAROUSEL_GAP,
  CARD_WIDTH_RATIO,
  MAX_CARD_WIDTH,
} from '../utils/carouselMetrics';

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

console.log('— 순수 산출 로직 —');

// 대표 기기 폭들(작은~큰 폰).
const widths = [320, 360, 390, 412, 430];
const metrics = widths.map((w) => ({ w, ...computeCarouselMetrics(w) }));

// 1. 폭에 따라 카드폭이 단조 증가(상한 미도달 구간).
check(
  '넓은 화면일수록 카드폭이 크다(단조 증가)',
  metrics.every((m, i) => i === 0 || m.cardWidth >= metrics[i - 1].cardWidth),
);

// 2. 카드가 좌측 패딩 이후 트랙의 ~86%를 채운다(좁지 않다).
check(
  '카드폭이 가용 트랙의 84~88%를 채운다(과소폭 아님)',
  metrics.every((m) => {
    const track = m.w - CAROUSEL_H_PADDING;
    const ratio = m.cardWidth / track;
    return ratio >= 0.84 && ratio <= 0.88;
  }),
);

// 3. peek(다음 카드 노출분)이 모든 폭에서 양수이고 비율이 일정(기기별 어긋남 없음).
const peeks = metrics.map((m) => {
  const track = m.w - CAROUSEL_H_PADDING;
  const peek = track - m.cardWidth - CAROUSEL_GAP; // 다음 카드 보이는 폭
  return { w: m.w, peekRatio: peek / m.w, peek };
});
check('모든 폭에서 peek > 0(다음 카드가 항상 살짝 보인다)', peeks.every((p) => p.peek > 0));
const peekRatios = peeks.map((p) => p.peekRatio);
const peekSpread = Math.max(...peekRatios) - Math.min(...peekRatios);
check('peek 비율이 기기 간 일정(스프레드 ≤ 3%p)', peekSpread <= 0.03);

// 4. snapToInterval = 카드폭 + gap (카드 단위 스냅).
check(
  'snapToInterval === cardWidth + CAROUSEL_GAP',
  metrics.every((m) => m.snapToInterval === m.cardWidth + CAROUSEL_GAP),
);

// 5. 정수 폭(소수 픽셀 잔상 방지).
check('cardWidth 는 정수', metrics.every((m) => Number.isInteger(m.cardWidth)));

// 6. 초광폭(태블릿/가로)에서 상한으로 캡된다.
const wide = computeCarouselMetrics(1024);
check('초광폭에서 cardWidth <= MAX_CARD_WIDTH 캡', wide.cardWidth === MAX_CARD_WIDTH);
check('상수 sanity: 0.8 < ratio < 0.9, MAX>300', CARD_WIDTH_RATIO > 0.8 && CARD_WIDTH_RATIO < 0.9 && MAX_CARD_WIDTH > 300);

// 7. 회귀 대조: 넓은 기기(430)의 새 카드폭이 옛 고정폭(264/272)보다 크다(좌우 과공간 해소).
check('430px 기기에서 새 카드폭 > 옛 고정폭 272', computeCarouselMetrics(430).cardWidth > 272);

console.log('\n— 소스 바인딩 —');

const home = read('components/home/HomeSignalPreview.tsx');
const curatedCard = read('components/signals/CuratedSignalCard.tsx');
const curationSlot = read('components/signals/CurationSlot.tsx');

// 고정 px 상수 제거.
check('Home: 고정 CARD_WIDTH 상수 제거', !/const\s+CARD_WIDTH\s*=\s*\d+/.test(home));
check('CuratedCard: 고정 CARD_WIDTH 상수 제거', !/const\s+CARD_WIDTH\s*=\s*\d+/.test(curatedCard));
check('CuratedCard: CURATED_CARD_WIDTH 고정 export 제거', !/export const CURATED_CARD_WIDTH/.test(curatedCard));

// 반응형 훅 사용.
check('Home: useCarouselCardWidth 사용', /useCarouselCardWidth\(\)/.test(home));
check('CurationSlot: useCarouselCardWidth 사용', /useCarouselCardWidth\(\)/.test(curationSlot));

// 카드 폭을 인라인으로 주입.
check('Home: 카드에 width: cardWidth 인라인 주입', /width:\s*cardWidth/.test(home));
check('CuratedCard: 카드에 width: cardWidth 인라인 주입', /width:\s*cardWidth/.test(curatedCard));

// FlatList 스냅 적용(두 카루셀).
check('Home: snapToInterval 적용', /snapToInterval=\{snapToInterval\}/.test(home));
check('Home: snapToAlignment start + decelerationRate fast', /snapToAlignment="start"/.test(home) && /decelerationRate="fast"/.test(home));
check('CurationSlot: snapToInterval 적용', /snapToInterval=\{snapToInterval\}/.test(curationSlot));
check('CurationSlot: snapToAlignment start + decelerationRate fast', /snapToAlignment="start"/.test(curationSlot) && /decelerationRate="fast"/.test(curationSlot));

// 카루셀 레이아웃 계약(좌측 정렬 기준 좌우 패딩 lg) 유지 — 정렬 일관.
// DAR-319: 카드 간격은 contentContainer gap 이 아니라 카드 marginRight 로 적용(아래 별도 체크).
check('Home: carousel paddingHorizontal lg 유지', /carousel:\s*\{[^}]*paddingHorizontal:\s*spacing\.lg/s.test(home));
check('CurationSlot: carousel paddingHorizontal lg 유지', /carousel:\s*\{[^}]*paddingHorizontal:\s*spacing\.lg/s.test(curationSlot));

console.log(`\n결과: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
