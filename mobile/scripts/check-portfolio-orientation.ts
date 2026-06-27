/**
 * DAR-451 결정론적 검증: 포트폴리오 탭 오리엔테이션 + 헤드라인 위계/정렬 방향.
 *
 * UI/UX 전수 감사(2026-06-27)의 3건을 고정한다.
 *
 *  C1 — 6서브탭이 구분 안내 없이 병렬 → 신규 사용자 길잃음.
 *       해결: 탭을 주체 기준 2그룹('내 운용'·'시스템 검증')으로 묶고, 가로 칩 행에 그룹
 *       머릿글을 각 그룹 첫 칩 앞에 1회 끼워 오리엔테이션 제공(탭 수는 보존).
 *  C2 — '총 평가금액' 헤드라인 토큰이 탭마다 다름(live h1 / paper h2 / sim h2).
 *       해결: 세 탭 총평가금액 헤드라인을 동일 토큰(typo.h1)으로 통일.
 *  C12 — 수익률 정렬이 오름차순(손실 큰 종목 최상단)이고 방향 표시 불명.
 *       해결: '손익순' 기본 내림차순(수익률 높은 종목 최상단)으로 — '비중순'과 동일 관례.
 *
 * 순수 모듈(utils/portfolioTabs.ts)은 직접 임포트해 그룹 진리표를 증명하고,
 * TSX 토큰/정렬은 소스 바인딩(정적 패턴)으로 불변식을 고정한다.
 * 실행: npx tsx scripts/check-portfolio-orientation.ts  (실패 시 exit 1)
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  PORTFOLIO_TABS,
  PORTFOLIO_TAB_GROUPS,
  groupedPortfolioTabs,
  type PortfolioSubTab,
  type PortfolioTabGroup,
} from '../utils/portfolioTabs';

const __dirname = dirname(fileURLToPath(import.meta.url));

let failures = 0;
let total = 0;
function check(name: string, ok: boolean, detail = ''): void {
  total++;
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'} | ${name}${detail ? `\n   ${detail}` : ''}`);
}

// ──────────────────────────────────────────────────────────────────────────
// C1: 탭 그룹핑(순수 모듈)
// ──────────────────────────────────────────────────────────────────────────
const expectedGroup: Record<PortfolioSubTab, PortfolioTabGroup> = {
  live: 'mine',
  paper: 'mine',
  sim: 'system',
  strategy: 'system',
  persona: 'system',
  style: 'system',
};

check(
  'C1a 모든 탭이 mine/system 그룹을 가짐',
  PORTFOLIO_TABS.every((t) => t.group === 'mine' || t.group === 'system'),
);
check(
  'C1b 탭별 그룹 배정 일치(live·paper=mine, sim·strategy·persona·style=system)',
  PORTFOLIO_TABS.every((t) => t.group === expectedGroup[t.value]),
  `got=${PORTFOLIO_TABS.map((t) => `${t.value}:${t.group}`).join(' ')}`,
);
check('C1c 그룹 라벨 mine="내 운용"', PORTFOLIO_TAB_GROUPS.mine === '내 운용');
check('C1d 그룹 라벨 system="시스템 검증"', PORTFOLIO_TAB_GROUPS.system === '시스템 검증');

const grouped = groupedPortfolioTabs();
check('C1e groupedPortfolioTabs() = 2그룹', grouped.length === 2, `len=${grouped.length}`);
check(
  'C1f 그룹 순서 [mine, system]',
  grouped[0]?.group === 'mine' && grouped[1]?.group === 'system',
  `order=${grouped.map((g) => g.group).join('/')}`,
);
check(
  'C1g 그룹 라벨이 PORTFOLIO_TAB_GROUPS와 동일',
  grouped.every((g) => g.label === PORTFOLIO_TAB_GROUPS[g.group]),
);
const flatFromGroups = grouped.flatMap((g) => g.tabs.map((t) => t.value));
check(
  'C1h 그룹 평탄화 = 원본 탭 순서(누락/중복/재배열 없음)',
  flatFromGroups.length === PORTFOLIO_TABS.length &&
    flatFromGroups.every((v, i) => v === PORTFOLIO_TABS[i].value),
  `flat=${flatFromGroups.join('/')}`,
);
check(
  'C1i 동일 그룹 인접(머릿글 1회만 — 그룹 분할 없음)',
  // groupedPortfolioTabs는 연속 동일 group만 한 묶음으로 만든다. 2그룹이면 각 group값이
  // 정확히 1개의 연속 구간 → 비인접 분할이 없었음을 증명.
  new Set(grouped.map((g) => g.group)).size === grouped.length,
);
check(
  'C1j 그룹별 멤버십(mine=live,paper / system=sim,strategy,persona,style)',
  grouped[0]?.tabs.map((t) => t.value).join(',') === 'live,paper' &&
    grouped[1]?.tabs.map((t) => t.value).join(',') === 'sim,strategy,persona,style',
);
check(
  'C1k a11y 라벨에 그룹명 포함(오리엔테이션 내장)',
  PORTFOLIO_TABS.every((t) => t.a11y.includes(PORTFOLIO_TAB_GROUPS[t.group])),
);

// ──────────────────────────────────────────────────────────────────────────
// 소스 바인딩 — index.tsx (C1 렌더 · C2 토큰 · C12 정렬)
// ──────────────────────────────────────────────────────────────────────────
const indexSrc = readFileSync(
  join(__dirname, '..', 'app', '(tabs)', 'portfolio', 'index.tsx'),
  'utf8',
);

// C1 렌더: 그룹 머릿글이 칩 행에 들어간다.
check('C1l index.tsx가 groupedPortfolioTabs() 사용', /groupedPortfolioTabs\(\)/.test(indexSrc));
check('C1m 그룹 머릿글 Text가 accessibilityRole="header"로 렌더', /accessibilityRole="header"/.test(indexSrc));
check('C1n 그룹 머릿글 라벨(grp.label) 렌더', /\{grp\.label\}/.test(indexSrc));

// C2 토큰 통일: 세 헤드라인 모두 typo.h1.
const liveHeadIdx = indexSrc.indexOf('총 평가금액');
const liveHeadWindow = indexSrc.slice(liveHeadIdx, liveHeadIdx + 500);
check(
  'C2a 실전 총평가금액 헤드라인 = typo.h1',
  /typo\.h1, styles\.headlineValue/.test(liveHeadWindow),
  'expect typo.h1, styles.headlineValue',
);
const paperHeadIdx = indexSrc.indexOf('가상 총자산');
const paperHeadWindow = indexSrc.slice(paperHeadIdx, paperHeadIdx + 400);
check('C2b 내 모의 가상 총자산 헤드라인 = typo.h1', /typo\.h1/.test(paperHeadWindow));
check('C2c 내 모의 헤드라인에 typo.h2 잔존 없음', !/typo\.h2/.test(paperHeadWindow));

// C12 정렬 방향: '손익순'은 내림차순(b - a). 오름차순(a - b) 잔존 없음.
check('C12a 손익 정렬 내림차순(b.pnlPercent - a.pnlPercent)', /b\.pnlPercent - a\.pnlPercent/.test(indexSrc));
check('C12b 손익 정렬 오름차순(a - b) 잔존 없음', !/a\.pnlPercent - b\.pnlPercent/.test(indexSrc));

// ──────────────────────────────────────────────────────────────────────────
// 소스 바인딩 — SimulationStatusSection.tsx (C2 시스템 모의 헤드라인 토큰)
// ──────────────────────────────────────────────────────────────────────────
const simSrc = readFileSync(
  join(__dirname, '..', 'components', 'portfolio', 'SimulationStatusSection.tsx'),
  'utf8',
);
const simHeadIdx = simSrc.indexOf('모의 평가금액');
const simHeadWindow = simSrc.slice(simHeadIdx, simHeadIdx + 300);
check('C2d 시스템 모의 평가금액 헤드라인 = typo.h1', /typo\.h1/.test(simHeadWindow));
check('C2e 시스템 모의 헤드라인에 typo.h2 잔존 없음', !/typo\.h2/.test(simHeadWindow));

console.log(`\n결과: ${total - failures}/${total} PASS`);
if (failures > 0) {
  console.error('FAILURES present');
  process.exit(1);
}
console.log('All cases passed');
