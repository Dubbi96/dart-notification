/**
 * DAR-212 결정론적 검증: 포트폴리오 5서브탭 용어/표시 정리.
 *
 * 실제 화면이 쓰는 순수 모듈(app/(tabs)/portfolio/tabs.ts)을 그대로 임포트해
 * 다음을 증명한다.
 *
 * A. 용어 불일치 해소 — '모의'(paper)/'모의운용'(sim) 모호성 제거
 *    1) paper 라벨 = '내 모의', sim 라벨 = '시스템 모의' (주체 구분, 둘 다 '모의' 보존)
 *    2) 한 단어 '모의'·'모의운용' 단독 라벨은 더 이상 없다(혼동 원인 제거)
 *    3) 모든 라벨/접근성 라벨은 고유(중복 없음)
 *    4) 5개 탭(live/paper/sim/persona/style) 모두 존재
 *
 * B. 빈 실전탭 처리 — pickLiveEmptyState 진리표
 *    포지션 0건 → 'preparing'(준비 중 안내), 1건 이상 → 'noSearchResult'(검색 결과 없음)
 */

import {
  PORTFOLIO_TABS,
  pickLiveEmptyState,
  type PortfolioSubTab,
} from '../utils/portfolioTabs';

let failures = 0;
let total = 0;
function check(name: string, ok: boolean, detail = '') {
  total++;
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'} | ${name}${detail ? `\n   ${detail}` : ''}`);
}

const byValue = Object.fromEntries(PORTFOLIO_TABS.map((t) => [t.value, t])) as Record<
  PortfolioSubTab,
  (typeof PORTFOLIO_TABS)[number]
>;

// A1: 역할 라벨 재정의
check('A1a paper 라벨 = "내 모의"', byValue.paper?.label === '내 모의', `label=${byValue.paper?.label}`);
check('A1b sim 라벨 = "시스템 모의"', byValue.sim?.label === '시스템 모의', `label=${byValue.sim?.label}`);
check(
  'A1c 둘 다 "모의" 보존(가상 표지 유지)',
  byValue.paper?.label.includes('모의') && byValue.sim?.label.includes('모의'),
);
check(
  'A1d 주체 구분 — paper에 "내", sim에 "시스템"',
  byValue.paper?.label.includes('내') === true && byValue.sim?.label.includes('시스템') === true,
);

// A2: 모호한 단독 라벨 제거
const labels = PORTFOLIO_TABS.map((t) => t.label);
check('A2a 단독 "모의" 라벨 없음', !labels.includes('모의'));
check('A2b 단독 "모의운용" 라벨 없음', !labels.includes('모의운용'));

// A3: 라벨/a11y 고유성
check('A3a 라벨 중복 없음', new Set(labels).size === labels.length, `labels=${labels.join('/')}`);
const a11ys = PORTFOLIO_TABS.map((t) => t.a11y);
check('A3b a11y 라벨 중복 없음', new Set(a11ys).size === a11ys.length);
check('A3c 모든 탭 a11y 라벨 비어있지 않음', a11ys.every((a) => a.trim().length > 0));

// A4: 5개 탭 존재(순서/값)
const expectedValues: PortfolioSubTab[] = ['live', 'paper', 'sim', 'persona', 'style'];
check(
  'A4 탭 값 5개 일치',
  PORTFOLIO_TABS.length === 5 && expectedValues.every((v, i) => PORTFOLIO_TABS[i].value === v),
  `values=${PORTFOLIO_TABS.map((t) => t.value).join('/')}`,
);

// B: 빈 실전탭 분기 진리표
const liveCases: { positions: number; expect: 'preparing' | 'noSearchResult' }[] = [
  { positions: 0, expect: 'preparing' },
  { positions: 1, expect: 'noSearchResult' },
  { positions: 7, expect: 'noSearchResult' },
];
for (const c of liveCases) {
  const got = pickLiveEmptyState(c.positions);
  check(`B positions=${c.positions} → ${c.expect}`, got === c.expect, `got=${got}`);
}

console.log(`\n결과: ${total - failures}/${total} PASS`);
if (failures > 0) {
  console.error('FAILURES present');
  process.exit(1);
}
console.log('All cases passed');
