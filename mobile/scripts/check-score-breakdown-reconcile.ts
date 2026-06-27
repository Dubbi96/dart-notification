/**
 * DAR-447 결정론적 검증: 신호 상세 '점수 합계 모순' 해소 + 헤더 점수 중복 제거 + ASCII divider 교체.
 *
 * 종전 버그(DAR-299 표시 모델의 한계):
 *  - ScoreBreakdownSection 꼬리줄 '합계'가 표시 행의 산술합 rawSum(가중 전, 예 84)을 출력하고,
 *    헤더 최종 Buy Score(가중·비선형 정규화 후, 예 11)와의 차이는 '안내문으로만' 무마 →
 *    초보 사용자는 '84인데 왜 11?'로 읽어 핵심 기능 신뢰를 잃었다(B3).
 *  - 헤더에 'Buy Score: 78' 텍스트(h3)와 바로 아래 ScoreGauge 큰 숫자가 점수를 이중 표기(B2).
 *  - 섹션/카드 제목이 '── X ──' ASCII 장식 divider라 폰트배율·다크모드에 취약(B10).
 *
 * 해결:
 *  - 항목을 '양의 근거 합 대비 상대 기여도(%)'로 정규화(어떤 가중식과도 무관하게 참).
 *    섹션의 유일한 절대 점수는 헤더와 동일한 '최종 Buy Score'(totalScore) 한 값뿐 →
 *    더는 헤더와 모순되는 '합계 점수'가 존재하지 않는다(불일치 0).
 *  - 헤더의 'Buy Score: N' 텍스트 제거, ScoreGauge 하나로 통합. 만료일은 별도 메타 행.
 *  - ASCII '── X ──' divider를 captionMedium 평문 라벨로 교체(양 파일).
 *
 * 실행: npx tsx scripts/check-score-breakdown-reconcile.ts  (실패 시 exit 1)
 */
import { readFileSync } from 'fs';
import { join } from 'path';

let failed = 0;
function check(label: string, got: unknown, want: unknown): void {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failed += 1;
  console.log(
    `${ok ? 'PASS' : 'FAIL'} | ${label} | got=${JSON.stringify(got)} want=${JSON.stringify(want)}`,
  );
}

// ── 1) 표시 모델(컴포넌트 computeScoreContributions 와 동일) ──────────────────
interface Item {
  id: string;
  label: string;
  score: number;
  sampleN?: number;
}
interface Contribution extends Item {
  pct: number | null;
  isPenalty: boolean;
}
function computeScoreContributions(items: ReadonlyArray<Item>): Contribution[] {
  const grossPositive = items.reduce((acc, i) => (i.score > 0 ? acc + i.score : acc), 0);
  const withPct: Contribution[] = items.map((item) => ({
    ...item,
    isPenalty: item.score < 0,
    pct: grossPositive > 0 ? Math.round((item.score / grossPositive) * 100) : null,
  }));
  return withPct.sort((a, b) => (a.isPenalty ? 1 : 0) - (b.isPenalty ? 1 : 0));
}

// 이슈 스크린샷 데이터: 차트44 + 내부자40 = 양의 근거 84, 헤더 최종 Buy Score 11.
const issueItems: Item[] = [
  { id: 'disc', label: '공시', score: 0 },
  { id: 'core', label: '핵심', score: 0 },
  { id: 'persona', label: '페르소나', score: 0 },
  { id: 'hist', label: '과거', score: 0 },
  { id: 'chart', label: '차트', score: 44 },
  { id: 'vol', label: '거래량', score: 0 },
  { id: 'mkt', label: '시장', score: 0 },
  { id: 'insider', label: '내부자', score: 40 },
];
const c = computeScoreContributions(issueItems);
const byId = (id: string) => c.find((x) => x.id === id)!;

// 1-1) ★핵심 DoD: 섹션의 유일한 절대 점수 = 헤더 최종 Buy Score. 이와 모순될 '근거 합계 점수'가 없다.
//      과거의 rawSum(=84)을 절대 점수로 노출하지 않으므로 '근거 합계 vs 헤더 점수' 불일치 0.
check('항목은 절대 점수(점)가 아니라 상대 기여도(%) — pct 산정', byId('chart').pct !== null, true);
// 1-2) 상대 기여도: 차트 44/84≈52%, 내부자 40/84≈48% (합 100%, 가중식과 무관하게 참)
check('차트 기여도 = round(44/84*100)=52%', byId('chart').pct, 52);
check('내부자 기여도 = round(40/84*100)=48%', byId('insider').pct, 48);
check('기여도 0 항목 = 0%', byId('disc').pct, 0);
// 1-3) 양의 근거 0이면 pct=null(— 표기), 0으로 나눗셈 방지
const zero = computeScoreContributions([{ id: 'a', label: 'A', score: 0 }]);
check('양의 근거 0 → pct null', zero[0].pct, null);
// 1-4) 패널티(음수)는 항상 마지막 + 음수 pct
const withPenalty = computeScoreContributions([
  { id: 'risk', label: '리스크', score: -10 },
  { id: 'gain', label: '가산', score: 40 },
]);
check('패널티는 마지막 순서', withPenalty[withPenalty.length - 1].id, 'risk');
check('패널티 pct 음수(-10/40*100=-25)', withPenalty[0].id === 'gain' ? withPenalty[1].pct : null, -25);
check('가산 pct 양수(40/40*100=100)', withPenalty[0].pct, 100);

// ── 2) ScoreBreakdownSection 소스 바인딩(신규 모델 사용 + 모순 유발 흔적 제거) ──
const section = readFileSync(
  join(__dirname, '../components/signals/ScoreBreakdownSection.tsx'),
  'utf8',
);
// 2-1) 신규 표시 모델 함수 사용
check('computeScoreContributions 정의', /export function computeScoreContributions\(/.test(section), true);
check('grossPositive 분모 산정', /i\.score > 0 \? acc \+ i\.score : acc/.test(section), true);
check('상대 기여도(%) 산정', /Math\.round\(\(item\.score \/ grossPositive\) \* 100\)/.test(section), true);
// 2-2) ★유일한 절대 점수 = 헤더 totalScore. '최종 Buy Score' 라벨로 1회 노출.
check('최종 Buy Score = {totalScore}점', /\{totalScore\}점/.test(section), true);
check('{totalScore}점 은 정확히 1곳', (section.match(/\{totalScore\}점/g) ?? []).length, 1);
check('최종 Buy Score 라벨', /최종 Buy Score<\/Text>/.test(section), true);
// 2-3) 모순 유발 과거 흔적 제거: rawSum 절대 점수·'(가중 전)' 라벨·DEV 경고·옛 안내문
check('rawSum 점수 노출 제거', /\{rawSum\}점/.test(section), false);
check("'(가중 전)' 라벨 제거", /가중 전\)/.test(section), false);
check('isScoreSumMismatch 미사용', /isScoreSumMismatch/.test(section), false);
check('console.warn 제거', /console\.warn/.test(section), false);
check('옛 안내문(가중·정규화를 적용한 값) 제거', /가중·정규화를 적용한 값입니다/.test(section), false);
check('과거 경고 문구(≠ 헤더) 제거', /≠ 헤더/.test(section), false);
// 2-4) B10: 섹션 카드 제목 ASCII divider 제거
check('ScoreBreakdown ASCII divider 제거', /──/.test(section), false);
check("'Score 근거' 평문 라벨", /<Text[^>]*>\s*Score 근거\s*<\/Text>/.test(section), true);

// ── 3) signals/[id].tsx 소스 바인딩(B2 헤더 중복 제거 + B10 ASCII divider 제거) ──
const screen = readFileSync(join(__dirname, '../app/signals/[id].tsx'), 'utf8');
// 3-1) B2: 'Buy Score: N' 텍스트 헤드라인 제거(ScoreGauge 하나로 통합)
check("B2: 'Buy Score: {buyScore}' 텍스트 제거", /Buy Score: \{signal\.buyScore\}/.test(screen), false);
check('B2: ScoreGauge 단일 점수 헤드라인 유지', /<ScoreGauge/.test(screen), true);
check('B2: scoreColor(텍스트 점수 색) 미사용', /scoreColor/.test(screen), false);
// 3-2) B2: 만료일은 별도 메타 행으로 노출
check('B2: 만료일 별도 메타 행', /styles\.metaRow/.test(screen), true);
check('B2: 만료일 문구 유지', /유효: \{new Date\(signal\.expiresAt\)\.toLocaleDateString\('ko-KR'\)\} 까지/.test(screen), true);
// 3-3) B10: 모든 ASCII '── X ──' divider 제거
check('B10: signals 화면 ASCII divider 0건', /──/.test(screen), false);
check('진입 조건 평문 라벨', /진입 조건\s*<\/Text>/.test(screen), true);
check('리스크 평문 라벨', /리스크\s*<\/Text>/.test(screen), true);
check('AI 매수 근거 평문 라벨', /AI 매수 근거\s*<\/Text>/.test(screen), true);
check('관련 공시 평문 라벨', /관련 공시\s*<\/Text>/.test(screen), true);

console.log(failed === 0 ? '\nALL PASS' : `\n${failed} FAILED`);
process.exit(failed === 0 ? 0 : 1);
