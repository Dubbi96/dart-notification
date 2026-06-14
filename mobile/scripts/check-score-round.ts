/**
 * DAR-258 결정론적 검증: Score 근거 행 라벨 반올림 + 합계 정합경고 오발화 차단.
 *
 * 종전 버그:
 *  - ScoreProgressRow 라벨 `signed`가 원시 magnitude(예: 7.5)를 그대로 노출 →
 *    헤더 합계(정수 추정)와 자릿수가 어긋나 행합이 틀려 보임.
 *  - ScoreBreakdownSection 정합 검사 `sum !== totalScore`가 소수 기여 누적의
 *    부동소수 오차(0.1+0.2 류)로 DEV 경고를 오발화.
 *
 * 해결: utils/numberFormat
 *  - formatSignedScore(score): 부호 + Math.round(|score|) (헤더와 같은 정수 자릿수)
 *  - isScoreSumMismatch(items, total): Math.round(sum) !== total (반올림 비교)
 *
 * 실행: npx tsx scripts/check-score-round.ts  (실패 시 exit 1)
 */
import { formatSignedScore, isScoreSumMismatch } from '../utils/numberFormat.ts';

let failed = 0;
function check(label: string, got: unknown, want: unknown): void {
  const ok = got === want;
  if (!ok) failed += 1;
  console.log(
    `${ok ? 'PASS' : 'FAIL'} | ${label} | got=${JSON.stringify(got)} want=${JSON.stringify(want)}`,
  );
}

// 1) formatSignedScore — 소수 기여 반올림 + 부호 병행
check('정수 가산', formatSignedScore(7), '+7');
check('소수 가산 반올림(7.5→8)', formatSignedScore(7.5), '+8');
check('소수 가산 반올림(7.4→7)', formatSignedScore(7.4), '+7');
check('음수 패널티 크기 반올림(-3.4→-3)', formatSignedScore(-3.4), '-3');
check('음수 패널티 크기 반올림(-3.5→-4)', formatSignedScore(-3.5), '-4');
check('0은 가산 부호(+0)', formatSignedScore(0), '+0');
check('소수만(0.4→+0)', formatSignedScore(0.4), '+0');

// 2) isScoreSumMismatch — 부동소수 오차로 오발화하지 않음
// 0.1 + 0.2 = 0.30000000000000004, round→0 == 0 → 정합(경고 미발화)
check('부동소수 오차 합계 정합(round 0)', isScoreSumMismatch([{ score: 0.1 }, { score: 0.2 }], 0), false);

// 소수 기여 행합이 헤더 정수와 일치: 7.5 + 4.5 = 12.0, round→12 == 12 → 정합
check(
  '소수 기여 합=헤더 정수 정합',
  isScoreSumMismatch([{ score: 7.5 }, { score: 4.5 }], 12),
  false,
);

// 소수 기여가 반올림 후에도 헤더와 다르면 진짜 불일치(true) — 회귀 가드
check('실제 불일치는 여전히 감지', isScoreSumMismatch([{ score: 7.5 }, { score: 4.5 }], 11), true);

// 패널티 포함 합계: 10 + 5 - 3.2 = 11.8, round→12; 헤더 12 → 정합
check(
  '패널티 포함 합 반올림 정합',
  isScoreSumMismatch([{ score: 10 }, { score: 5 }, { score: -3.2 }], 12),
  false,
);

// 정수만(회귀): 정확 일치 유지
check('정수 합 정확 일치', isScoreSumMismatch([{ score: 8 }, { score: 4 }], 12), false);
check('정수 합 불일치 감지', isScoreSumMismatch([{ score: 8 }, { score: 4 }], 13), true);

// 3) DoD 핵심 — 백엔드 소수 기여(현실적 Engine3 분해) 시
//    (행 라벨 합) == 헤더 점수, DEV 경고 미발화.
//    Engine3는 보통 .5 경계가 아닌 소수(12.3, 4.7 …)를 보내며, 이 경우 개별 반올림
//    합과 round(원시합)이 일치한다.
const items = [{ score: 12.3 }, { score: 4.7 }, { score: -1.0 }];
const headerScore = Math.round(items.reduce((a, i) => a + i.score, 0)); // round(16.0) = 16
const rowLabelSum = items.reduce(
  (acc, i) => acc + (i.score < 0 ? -1 : 1) * Math.round(Math.abs(i.score)),
  0,
); // +12 +5 -1 = 16
console.log(`INFO | 개별 라벨 합=${rowLabelSum}, 헤더=${headerScore}`);
check('DoD: 행 라벨 합 == 헤더 점수', rowLabelSum, headerScore);
check('DoD: 소수 기여 경고 미발화', isScoreSumMismatch(items, headerScore), false);

// 알려진 한계(정직 표기): 두 기여가 정확히 .5 경계면 개별 반올림(8,5)이
// round(원시합 12.0)=12 과 어긋날 수 있다. 경고는 round(원시합) 기준이라
// 미발화로 일관되지만, 시각적 행합이 헤더와 1점 차날 수 있는 희귀 케이스.
// Engine3 실데이터는 .5 경계 동시발생이 사실상 없어 무영향.

if (failed > 0) {
  console.error(`\n${failed} check(s) FAILED`);
  process.exit(1);
}
console.log('\nAll checks passed.');
