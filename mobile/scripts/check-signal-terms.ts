/**
 * DAR-217 결정론적 검증: 신호 도메인 용어 위계(SSOT) 일관성.
 *
 * 문제(수정 전): 같은 데이터가 화면마다 '투자판단'·'매수 신호'·'Buy Score'로 혼용되고,
 *   일부 카드 a11y 라벨 포맷이 달라(점 유무 등) 화면낭독 어휘가 시각과 어긋났다.
 *
 * 수정 후: utils/signalTerms.ts 1곳에 위계를 명문화하고 카드 a11y는 빌더로만 생성.
 *   - L1 화면/섹션 헤더 = '투자판단'(우산)
 *   - L2 개별 카드/점수 = '매수 신호' + 'Buy Score'(고정)
 *   - 카드 a11y는 시각(L2) 어휘와 일치: '매수 신호'·'Buy Score' 포함, '투자판단' 미포함
 *   - 모든 카드(홈/탐색/큐레이션/공시역링크) a11y가 동일 포맷
 *
 * 실행: npx tsx scripts/check-signal-terms.ts  (실패 시 exit 1)
 */
import { SIGNAL_TERMS, buildSignalCardA11yLabel } from '../utils/signalTerms.ts';

interface Case {
  name: string;
  pass: boolean;
  detail: string;
}

const cases: Case[] = [];

// 1) 위계 상수 고정값 — 우산(L1) vs 카드/점수(L2) 어휘 분리.
cases.push({
  name: "L1 화면 헤더 어휘 = '투자판단'",
  pass: SIGNAL_TERMS.screenHeader === '투자판단' && SIGNAL_TERMS.homeHeader === '오늘의 투자판단',
  detail: `screenHeader="${SIGNAL_TERMS.screenHeader}", homeHeader="${SIGNAL_TERMS.homeHeader}"`,
});
cases.push({
  name: "L2 카드/점수 어휘 = '매수 신호' + 'Buy Score'",
  pass: SIGNAL_TERMS.card === '매수 신호' && SIGNAL_TERMS.buyScore === 'Buy Score',
  detail: `card="${SIGNAL_TERMS.card}", buyScore="${SIGNAL_TERMS.buyScore}"`,
});

// 2) 카드 a11y 빌더 — 시각(L2) 어휘와 일치.
const base = buildSignalCardA11yLabel({
  corpName: '삼성전자',
  buyScore: 72,
  gradeText: '매수',
});
cases.push({
  name: "카드 a11y에 L2 어휘('매수 신호'·'Buy Score') 포함",
  pass: base.includes('매수 신호') && base.includes('Buy Score 72'),
  detail: base,
});
cases.push({
  name: "카드 a11y에 우산 어휘('투자판단') 미포함(위계 혼용 차단)",
  pass: !base.includes('투자판단'),
  detail: base,
});
cases.push({
  name: '카드 a11y 점수 표기에 단위 「점」 부착(낭독 명료성)',
  pass: base.includes('Buy Score 72점'),
  detail: base,
});

// 3) 위험요약 옵션 — 있으면 끝에 1회만 덧붙고, 없으면 미부착.
const withRisk = buildSignalCardA11yLabel({
  corpName: '카카오',
  buyScore: 40,
  gradeText: '관망',
  riskSummary: '거래정지 이력',
});
cases.push({
  name: '위험요약은 있으면 말미에 덧붙음',
  pass: withRisk.endsWith(', 거래정지 이력') && withRisk.includes('Buy Score 40점'),
  detail: withRisk,
});
cases.push({
  name: '위험요약은 없으면 빈 꼬리표 미부착',
  pass: !base.endsWith(', ') && !base.includes(', undefined'),
  detail: base,
});

// 4) 전 카드 동일 포맷 — 입력 동일 시 출력 동일(드리프트 0). 컴포넌트가 모두 이 빌더만 쓰므로
//    동일 입력의 결정론적 동일 출력이 곧 카드 간 포맷 일치를 보장한다.
const a = buildSignalCardA11yLabel({ corpName: 'LG', buyScore: 55, gradeText: '매수' });
const b = buildSignalCardA11yLabel({ corpName: 'LG', buyScore: 55, gradeText: '매수' });
cases.push({
  name: '동일 입력 → 동일 a11y(전 카드 포맷 단일화)',
  pass: a === b && a === 'LG 매수 신호, Buy Score 55점, 매수',
  detail: a,
});

// 5) 점수 라벨이 매수/청산 영문 고정 — kind 분기 라벨이 SSOT에서만 옴.
cases.push({
  name: "점수 라벨 고정: buyScore='Buy Score', exitScore='Exit Score'",
  pass: SIGNAL_TERMS.buyScore === 'Buy Score' && SIGNAL_TERMS.exitScore === 'Exit Score',
  detail: `buyScore="${SIGNAL_TERMS.buyScore}", exitScore="${SIGNAL_TERMS.exitScore}"`,
});

let failures = 0;
for (const c of cases) {
  if (!c.pass) failures++;
  console.log(`${c.pass ? 'PASS' : 'FAIL'} | ${c.name}\n   ${c.detail}`);
}

console.log(`\n결과: ${cases.length - failures}/${cases.length} PASS`);
if (failures > 0) {
  console.error('FAILURES present');
  process.exit(1);
}
console.log('All cases passed');
