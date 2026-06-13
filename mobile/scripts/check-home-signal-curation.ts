/**
 * DAR-193 결정론적 검증: 홈 '오늘의 투자판단'이 recency 큐레이션이라
 * 매수등급 신호가 다수 존재해도 "최근성에 가려진" 빈상태로 표시되던 버그.
 *
 * 버그(수정 전): GET /signals 를 grade 필터 없이 latest(createdAt desc) limit=20 으로 받아
 *   클라이언트 curateBuySignals 가 그 20건 중에서만 매수등급을 추림. 공시 대부분이 NEUTRAL이라
 *   최신 20건이 전부 중립이면 매수등급 0건 → 홈 flagship 빈상태(라벨 "상위 매수 신호"와 모순).
 *
 * 수정 후: GET /signals?grade=STRONG_BUY,BUY&sort=score 로 매수등급만 점수 내림차순으로 받음.
 *   → 최근성 무관하게 시스템의 상위 매수 신호를 노출. 빈상태는 진짜 매수등급 0건일 때만.
 *
 * 실행: node scripts/check-home-signal-curation.ts  (실패 시 exit 1)
 */
import { curateBuySignals, CURATION_BUY_GRADES } from '../utils/signalCuration.ts';

import type { SignalGrade, TradingSignal } from '../types/signal.types.ts';

const LIMIT = 20; // 백엔드 기본 페이지 크기

function sig(
  id: string,
  grade: SignalGrade,
  buyScore: number,
  ageMinutes: number,
): TradingSignal {
  // createdAt: 작을수록(과거) 오래됨. ageMinutes 클수록 과거.
  const createdAt = new Date(Date.UTC(2026, 5, 13, 0, 0, 0) - ageMinutes * 60_000).toISOString();
  return {
    id,
    corpCode: `corp_${id}`,
    corpName: `회사 ${id}`,
    grade,
    buyScore,
    eventType: 'SUPPLY_CONTRACT',
    entryConditions: [],
    riskFlags: [],
    scoreBreakdown: [],
    createdAt,
  } as unknown as TradingSignal;
}

/** 백엔드 latest 정렬(createdAt desc) 후 limit 윈도우 — 수정 전 홈 요청을 모사. */
function backendLatest(all: TradingSignal[], limit: number): TradingSignal[] {
  return [...all]
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, limit);
}

/** 백엔드 grade∈buy + sort=score(buyScore desc, createdAt desc tiebreak) 후 limit — 수정 후 요청. */
function backendBuyByScore(all: TradingSignal[], limit: number): TradingSignal[] {
  const buyGrades = CURATION_BUY_GRADES as readonly SignalGrade[];
  return [...all]
    .filter((s) => buyGrades.includes(s.grade))
    .sort((a, b) => b.buyScore - a.buyScore || b.createdAt.localeCompare(a.createdAt))
    .slice(0, limit);
}

interface Scenario {
  name: string;
  build: () => TradingSignal[];
  expectOldEmpty: boolean; // 수정 전(recency) 빈상태 여부
  expectNewCount: number; // 수정 후 노출 매수 카드 수(curateBuySignals 결과)
  expectTopId?: string; // 수정 후 1순위(최고 점수) 신호 id
}

const scenarios: Scenario[] = [
  {
    // 핵심 재현: 신선한 매수 6건이 있으나 그보다 더 신선한 NEUTRAL 30건에 밀려 latest-20 밖.
    name: '매수 6건 존재하나 최신 30건이 전부 NEUTRAL → 수정전 빈상태, 수정후 노출',
    build: () => {
      const buys: TradingSignal[] = [
        sig('SB1', 'STRONG_BUY', 92, 400),
        sig('SB2', 'STRONG_BUY', 88, 410),
        sig('B1', 'BUY', 78, 420),
        sig('B2', 'BUY', 74, 430),
        sig('B3', 'BUY', 71, 440),
        sig('B4', 'BUY', 69, 450),
      ];
      // 매수보다 더 최근(ageMinutes 작음)인 중립 30건 → latest-20을 전부 점유.
      const neutrals = Array.from({ length: 30 }, (_, i) =>
        sig(`N${i}`, 'NEUTRAL', 40 - (i % 10), i),
      );
      return [...neutrals, ...buys];
    },
    expectOldEmpty: true,
    expectNewCount: 5, // CURATION_MAX=5 (6건 중 상위 5)
    expectTopId: 'SB1',
  },
  {
    // 회귀 가드: 매수 신호가 최신 윈도우 안에도 있으면 수정 전에도 노출됐음(둘 다 노출).
    name: '매수 신호가 최신 윈도우 내 → 수정 전/후 모두 노출(회귀 없음)',
    build: () => {
      const recentBuys = [
        sig('SB1', 'STRONG_BUY', 90, 1),
        sig('B1', 'BUY', 70, 2),
      ];
      const neutrals = Array.from({ length: 5 }, (_, i) => sig(`N${i}`, 'NEUTRAL', 30, i + 3));
      return [...recentBuys, ...neutrals];
    },
    expectOldEmpty: false,
    expectNewCount: 2,
    expectTopId: 'SB1',
  },
  {
    // 정직 빈상태: 매수등급이 시스템에 진짜 0건이면 수정 후에도 빈상태(가짜 BUY 금지).
    name: '매수등급 0건 → 수정 후에도 정직 빈상태 유지',
    build: () => Array.from({ length: 10 }, (_, i) => sig(`N${i}`, 'NEUTRAL', 50, i)),
    expectOldEmpty: true,
    expectNewCount: 0,
  },
  {
    // 점수 우선순위: 점수 높은 매수가 항상 1순위(최근성 무관).
    name: '오래된 고점수 매수가 신선한 저점수 매수보다 1순위',
    build: () => [
      sig('OLD_HIGH', 'STRONG_BUY', 95, 9999), // 매우 오래됨, 최고점
      sig('NEW_LOW', 'BUY', 60, 1), // 가장 신선, 저점
    ],
    expectOldEmpty: false,
    expectNewCount: 2,
    expectTopId: 'OLD_HIGH',
  },
];

let failures = 0;
for (const sc of scenarios) {
  const all = sc.build();

  // 수정 전: latest 윈도우를 받아 클라가 큐레이션 → 윈도우 밖 매수는 영영 미노출.
  const oldFeed = backendLatest(all, LIMIT);
  const oldCurated = curateBuySignals(oldFeed);

  // 수정 후: 매수등급 점수순 윈도우를 받아 클라가 큐레이션.
  const newFeed = backendBuyByScore(all, LIMIT);
  const newCurated = curateBuySignals(newFeed);

  const oldEmptyOk = (oldCurated.length === 0) === sc.expectOldEmpty;
  const newCountOk = newCurated.length === sc.expectNewCount;
  const topOk = sc.expectTopId ? newCurated[0]?.id === sc.expectTopId : true;
  // 수정 후 결과는 점수 내림차순 단조(큐레이션 정렬 계약).
  const sortedOk = newCurated.every(
    (s, i) => i === 0 || newCurated[i - 1].buyScore >= s.buyScore,
  );

  const ok = oldEmptyOk && newCountOk && topOk && sortedOk;
  if (!ok) failures++;

  console.log(
    `${ok ? 'PASS' : 'FAIL'} | ${sc.name}\n` +
      `   수정전(recency): ${oldCurated.length}건 ${oldCurated.length === 0 ? '(빈상태)' : ''}` +
      ` [기대 ${sc.expectOldEmpty ? '빈상태' : '노출'}]\n` +
      `   수정후(score)  : ${newCurated.length}건 top=${newCurated[0]?.id ?? '—'}` +
      ` [기대 ${sc.expectNewCount}건${sc.expectTopId ? `, top=${sc.expectTopId}` : ''}]`,
  );
}

console.log(`\n결과: ${scenarios.length - failures}/${scenarios.length} PASS`);
if (failures > 0) {
  console.error('FAILURES present');
  process.exit(1);
}
console.log('All scenarios passed');
