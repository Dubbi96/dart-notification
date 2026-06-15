/**
 * DAR-299 결정론적 검증: 매수 후보 상세 Score 근거 합계 ≠ 헤더 Buy Score 불일치 +
 * DEV 경고 실기기 노출 차단.
 *
 * 종전 버그:
 *  - ScoreBreakdownSection 꼬리줄 '합계'가 헤더 Buy Score(totalScore=가중·정규화 후, 예 11)
 *    를 그대로 출력했으나, 표시된 행들은 가중 전 원시 기여(예 차트+44·내부자+40=84)라
 *    행합(84)과 꼬리줄(11)이 시각적으로 모순.
 *  - __DEV__ isScoreSumMismatch 경고가 합(84)≠헤더(11)에서 발화 → 실기기에서
 *    '[ScoreBreakdownSection] 합계(84) ≠ 헤더 점수(11)' 토스트가 사용자에게 노출.
 *
 * 해결(표시 모델을 '가중 전 원시 기여'로 명시):
 *  - 꼬리줄 '합계'는 표시 행들의 산술합 rawSum(반올림)을 노출 → 행과 정합.
 *  - 합과 헤더가 다르면 라벨에 '(가중 전)' 부기 + '최종 Buy Score N점은 …가중·정규화…' 안내문.
 *  - __DEV__ 경고 제거(두 모델의 차이는 정상이므로 오발화 원인 자체 제거).
 *
 * 실행: npx tsx scripts/check-score-breakdown-reconcile.ts  (실패 시 exit 1)
 */
import { readFileSync } from 'fs';
import { join } from 'path';

let failed = 0;
function check(label: string, got: unknown, want: unknown): void {
  const ok = got === want;
  if (!ok) failed += 1;
  console.log(
    `${ok ? 'PASS' : 'FAIL'} | ${label} | got=${JSON.stringify(got)} want=${JSON.stringify(want)}`,
  );
}

// ── 1) 표시 로직 모델(컴포넌트 계산식과 동일) ───────────────────────────────
// 컴포넌트: rawSum = Math.round(Σ item.score); isWeightedDiff = rawSum !== totalScore
function rawSum(items: ReadonlyArray<{ score: number }>): number {
  return Math.round(items.reduce((acc, i) => acc + i.score, 0));
}
function isWeightedDiff(items: ReadonlyArray<{ score: number }>, totalScore: number): boolean {
  return rawSum(items) !== totalScore;
}

// 이슈 스크린샷 데이터: 공시0+핵심0+페르소나0+과거0+차트44+거래량0+시장0+내부자40 = 84, 헤더 11
const issueItems = [
  { score: 0 }, // 공시
  { score: 0 }, // 핵심
  { score: 0 }, // 페르소나
  { score: 0 }, // 과거
  { score: 44 }, // 차트
  { score: 0 }, // 거래량
  { score: 0 }, // 시장
  { score: 40 }, // 내부자
];

// 1-1) 꼬리줄 합계는 표시된 행들의 산술합(84) — 더 이상 헤더(11)가 아님
check('이슈 케이스 rawSum=84(행 정합)', rawSum(issueItems), 84);
// 1-2) 가중 전 합(84) ≠ 헤더(11) → '(가중 전)' 라벨 + 안내문 분기 ON
check('이슈 케이스 isWeightedDiff(84≠11)', isWeightedDiff(issueItems, 11), true);

// 1-3) 부동소수 누적도 정수 자릿수로 반올림(헤더와 같은 자릿수)
check('부동소수 합 반올림(0.1+0.2→0)', rawSum([{ score: 0.1 }, { score: 0.2 }]), 0);
check('소수 기여 합 반올림(7.5+4.5→12)', rawSum([{ score: 7.5 }, { score: 4.5 }]), 12);

// 1-4) 음수 패널티 포함 산술합
check('패널티 포함 합(+10-3→7)', rawSum([{ score: 10 }, { score: -3 }]), 7);

// 1-5) 가중 전 합 == 헤더면 차이 분기 OFF(라벨/안내문 미노출)
check('합==헤더면 차이 OFF', isWeightedDiff([{ score: 7.5 }, { score: 4.5 }], 12), false);
// 반올림 동치(부동소수)도 정합으로 판정 → 오발화 없음
check('round 동치면 차이 OFF', isWeightedDiff([{ score: 0.1 }, { score: 0.2 }], 0), false);

// ── 2) 소스 바인딩 검증(컴포넌트가 실제 위 로직/문구를 사용하는지) ──────────
const src = readFileSync(
  join(__dirname, '../components/signals/ScoreBreakdownSection.tsx'),
  'utf8',
);

// 2-1) DEV 경고 완전 제거 — console.warn / isScoreSumMismatch / __DEV__ 흔적 없음
check('console.warn 제거', /console\.warn/.test(src), false);
check('isScoreSumMismatch 미사용', /isScoreSumMismatch/.test(src), false);
check('__DEV__ 경고 가드 제거', /if\s*\(\s*__DEV__/.test(src), false);

// 2-2) rawSum 산출(표시 행 산술합) 바인딩
check('rawSum 산술합 계산', /const rawSum = Math\.round\(items\.reduce\(/.test(src), true);
check('isWeightedDiff 산출', /const isWeightedDiff = rawSum !== totalScore;/.test(src), true);

// 2-3) 꼬리줄은 totalScore 가 아니라 rawSum 을 출력
check('꼬리줄 값 = rawSum', /\{rawSum\}점/.test(src), true);
// totalScore 는 안내문에만 1회 등장(꼬리줄 합계 값으로는 쓰이지 않음).
check('{totalScore}점 은 안내문 1곳뿐', (src.match(/\{totalScore\}점/g) ?? []).length, 1);
check('안내문의 {totalScore}점만 잔존', /Buy Score \{totalScore\}점은/.test(src), true);

// 2-4) 차이 시 '(가중 전)' 라벨 + 안내문 노출
check('가중 전 라벨 분기', /isWeightedDiff \? ' \(가중 전\)' : ''/.test(src), true);
check(
  '최종 Buy Score 안내문',
  /최종 Buy Score \{totalScore\}점은 항목별 가중·정규화를 적용한 값입니다\./.test(src),
  true,
);

// ── 3) 음성 대조: 이슈의 오노출 문구가 더는 소스에 없어야 ─────────────────────
check('과거 경고 문구 제거', /≠ 헤더 점수/.test(src), false);

console.log(failed === 0 ? '\nALL PASS' : `\n${failed} FAILED`);
process.exit(failed === 0 ? 0 : 1);
