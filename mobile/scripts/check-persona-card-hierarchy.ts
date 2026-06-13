/**
 * DAR-195 결정론적 검증: 페르소나 선택 카드 정보위계 재편.
 *
 * 버그(before): 4지표(현재 장 적합도·누적수익·신호 적중률·MDD)가 50% 그리드에
 *   동일 weight로 상시 노출. 결정 동인(적합도)이 보조지표에 묻힘.
 *   신호 적중률 셀은 `${pct}% (n=${sampleSize})`로 퍼센트+표본수를 한 셀에 욱여넣어 과밀.
 *
 * 수정(after): 현재 장 적합도 = hero(단일 prominent 값). 누적수익/적중률/MDD =
 *   '성과 자세히' 접기(기본 접힘) demote. 적중률 가시 셀에서 inline (n=…) 제거,
 *   표본수는 tertiary 접미(hint)·a11y 라벨로만 노출.
 *
 * 컴포넌트 JSX의 순수 파생값을 그대로 재현해 위계 전환을 증명한다.
 */

interface CardModel {
  name: string;
  regimeFitScore: number;
  cumulativeReturnPct: number;
  hitRatePct: number;
  hitRateSampleSize: number;
  mddPct: number | null;
}

function formatSignedPct(pct: number): string {
  return `${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%`;
}

// ── before: 그리드 4셀, 적중률 셀에 inline (n=) ──────────────────────────
function beforeCells(m: CardModel): { label: string; value: string }[] {
  return [
    { label: '현재 장 적합도', value: `${Math.round(m.regimeFitScore)}점` },
    { label: '누적수익', value: formatSignedPct(m.cumulativeReturnPct) },
    { label: '신호 적중률', value: `${Math.round(m.hitRatePct)}% (n=${m.hitRateSampleSize})` },
    { label: 'MDD', value: m.mddPct === null ? '측정 불가' : formatSignedPct(m.mddPct) },
  ];
}

// ── after: hero + demote(접힘) ─────────────────────────────────────────
interface AfterVM {
  hero: { label: string; value: string }; // 단일 prominent 값
  detailExpandedDefault: boolean; // 기본 접힘
  detailCells: { label: string; value: string; hint?: string }[];
  a11yLabel: string;
}

function afterVM(m: CardModel, recommended: boolean, selected: boolean): AfterVM {
  const fitScore = Math.round(m.regimeFitScore);
  return {
    hero: { label: '현재 장 적합도', value: `${fitScore}점` },
    detailExpandedDefault: false,
    detailCells: [
      { label: '누적수익', value: formatSignedPct(m.cumulativeReturnPct) },
      { label: '신호 적중률', value: `${Math.round(m.hitRatePct)}%`, hint: `표본 ${m.hitRateSampleSize}건` },
      { label: 'MDD', value: m.mddPct === null ? '측정 불가' : formatSignedPct(m.mddPct) },
    ],
    a11yLabel:
      `현재 장 적합도 ${fitScore}점. 누적수익 ${formatSignedPct(m.cumulativeReturnPct)}. ` +
      `신호 적중률 ${Math.round(m.hitRatePct)}퍼센트 표본 ${m.hitRateSampleSize}건.` +
      `${recommended ? ' 현재 장 추천.' : ''}${selected ? ' 선택됨.' : ''}`,
  };
}

const cases: CardModel[] = [
  { name: 'VALUE 추천', regimeFitScore: 82.4, cumulativeReturnPct: 12.3, hitRatePct: 61.7, hitRateSampleSize: 48, mddPct: -8.2 },
  { name: 'GROWTH 저표본', regimeFitScore: 55.0, cumulativeReturnPct: -3.4, hitRatePct: 40.0, hitRateSampleSize: 7, mddPct: -15.9 },
  { name: 'MDD 측정불가', regimeFitScore: 70.6, cumulativeReturnPct: 0.0, hitRatePct: 50.0, hitRateSampleSize: 0, mddPct: null },
  { name: '경계 반올림', regimeFitScore: 49.5, cumulativeReturnPct: 99.95, hitRatePct: 33.49, hitRateSampleSize: 30, mddPct: -0.04 },
];

let failures = 0;
for (const m of cases) {
  const before = beforeCells(m);
  const after = afterVM(m, true, false);

  // R1: 현재 장 적합도가 hero(단일 값). hero 값은 점수 그대로.
  const heroOk = after.hero.label === '현재 장 적합도' && after.hero.value === `${Math.round(m.regimeFitScore)}점`;

  // R2: 보조 3지표는 접힘 detail에만(상시 그리드 아님). hero는 detail에 없음.
  const demotedKeys = after.detailCells.map((c) => c.label);
  const demoteOk =
    after.detailExpandedDefault === false &&
    demotedKeys.length === 3 &&
    demotedKeys.includes('누적수익') &&
    demotedKeys.includes('신호 적중률') &&
    demotedKeys.includes('MDD') &&
    !demotedKeys.includes('현재 장 적합도');

  // R3: 가시 적중률 셀에서 inline (n=…) 제거 — 표본수는 hint로만.
  const hitCellBefore = before.find((c) => c.label === '신호 적중률')!;
  const hitCellAfter = after.detailCells.find((c) => c.label === '신호 적중률')!;
  const inlineRemoved =
    /\(n=\d+\)/.test(hitCellBefore.value) && // before: 셀에 (n=) 존재(버그 재현)
    !/\(n=/.test(hitCellAfter.value) && // after: 셀 값에 (n= 없음
    hitCellAfter.value === `${Math.round(m.hitRatePct)}%` &&
    hitCellAfter.hint === `표본 ${m.hitRateSampleSize}건`; // 표본수는 tertiary 접미로 보존

  // R4: 표본수 정보 손실 없음 — a11y 라벨에 표본수 포함.
  const sampleInA11y = after.a11yLabel.includes(`표본 ${m.hitRateSampleSize}건`);

  // R5: 회귀 — 적합도 점수/수익/MDD 표기값은 before와 동일(반올림·부호·측정불가 보존).
  const fitSame = after.hero.value === before.find((c) => c.label === '현재 장 적합도')!.value;
  const cumSame =
    after.detailCells.find((c) => c.label === '누적수익')!.value ===
    before.find((c) => c.label === '누적수익')!.value;
  const mddSame =
    after.detailCells.find((c) => c.label === 'MDD')!.value === before.find((c) => c.label === 'MDD')!.value;
  const noRegression = fitSame && cumSame && mddSame;

  const ok = heroOk && demoteOk && inlineRemoved && sampleInA11y && noRegression;
  if (!ok) failures++;

  console.log(
    `${ok ? 'PASS' : 'FAIL'} | ${m.name}\n` +
      `   before 적중률 셀: "${hitCellBefore.value}" (과밀)\n` +
      `   after  hero: "${after.hero.label} ${after.hero.value}" · 적중률 셀: "${hitCellAfter.value}" hint="${hitCellAfter.hint}"\n` +
      `   접힘기본=${after.detailExpandedDefault} demote=[${demotedKeys.join(', ')}] a11y표본=${sampleInA11y}`,
  );
}

console.log(`\n결과: ${cases.length - failures}/${cases.length} PASS`);
if (failures > 0) {
  console.error('FAILURES present');
  process.exit(1);
}
console.log('All cases passed');
