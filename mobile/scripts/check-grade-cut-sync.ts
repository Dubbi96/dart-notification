/**
 * UXR-2 deterministic check — 등급 컷 SSOT 정합(B-1) + 음수 buyScore 표시 규칙(B-3).
 *
 * 세 축으로 입증한다.
 *  (A) 컷 동기화: 백엔드 buy-signal.config.ts 의 SIGNAL_GRADE_THRESHOLDS(강한매수 50 ·
 *      매수 45 · 관망 30 · 중립 -29)와 mobile/utils/signalDisplay.ts 의 BUY_GRADE_THRESHOLDS
 *      를 **양쪽 소스를 직접 파싱**해 수치 일치를 단언한다 — 한쪽만 재보정되는 드리프트를
 *      이 스크립트가 영구 차단한다(F9 재발 방지).
 *  (B) 동작 모델: buyScoreColor(밴드)·mapScoreToGrade(등급)를 재현해 -100~100 전 구간에서
 *      게이지 밴드 색과 등급 칩이 같은 구간을 가리키는지 스윕. nextCutGap 이 실제 등급
 *      경계(NEUTRAL -29 포함) 기준으로 '다음 등급까지 +N'을 산정하는지 단언(B-1).
 *      음수 점수는 표시값(-100~100 그대로) ≠ 막대(0 바닥)로 분리돼 헤더 '0' vs 근거
 *      '-N점' 수치 모순이 없는지 단언(B-3).
 *  (C) 소스 바인딩: BUY_SCORE_CUTS 가 임계값에서 파생되고(임의 컷 30/60/80 폐기),
 *      ScoreGauge/SignalMiniGauge 가 shownScore(참값)·barPercent(지오메트리)를 분리 사용하며,
 *      InfoSheet 구간 카피가 실제 등급 라벨·-100~100 스케일을 서술하는지 단언.
 *
 * Run: npx tsx scripts/check-grade-cut-sync.ts
 */
import { readFileSync } from 'fs';
import { join } from 'path';

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean) {
  if (cond) {
    pass++;
    console.log(`  ok  ${name}`);
  } else {
    fail++;
    console.error(`FAIL  ${name}`);
  }
}

const ROOT = join(__dirname, '..');
const backendSrc = readFileSync(
  join(ROOT, '../backend/src/engine3-quant-market/buy-signal/config/buy-signal.config.ts'),
  'utf8',
);
const displaySrc = readFileSync(join(ROOT, 'utils/signalDisplay.ts'), 'utf8');
const gaugeSrc = readFileSync(join(ROOT, 'components/common/ScoreGauge.tsx'), 'utf8');
const miniSrc = readFileSync(join(ROOT, 'components/signals/SignalMiniGauge.tsx'), 'utf8');

// ---------- (A) 컷 동기화: 양쪽 소스 파싱 후 수치 일치 ----------
// 객체 블록만 잘라 키를 파싱한다(VIEW_SCORE.WATCH 등 동명 키 오염 방지).
function parseObjectNumbers(src: string, objectName: string): Record<string, number> {
  const block = src.match(new RegExp(`${objectName}\\s*=\\s*\\{([\\s\\S]*?)\\}`));
  if (!block) return {};
  const out: Record<string, number> = {};
  for (const m of block[1].matchAll(/([A-Z_]+):\s*(-?\d+)/g)) {
    out[m[1]] = Number(m[2]);
  }
  return out;
}

const be = parseObjectNumbers(backendSrc, 'SIGNAL_GRADE_THRESHOLDS');
const fe = parseObjectNumbers(displaySrc, 'BUY_GRADE_THRESHOLDS');

check('백엔드 SIGNAL_GRADE_THRESHOLDS 파싱(4개 컷)', Object.keys(be).length >= 4);
check('모바일 BUY_GRADE_THRESHOLDS 파싱(4개 컷)', Object.keys(fe).length === 4);
check(
  `강한매수 컷 동기: BE STRONG_BUY_CANDIDATE(${be.STRONG_BUY_CANDIDATE}) === FE STRONG_BUY(${fe.STRONG_BUY})`,
  be.STRONG_BUY_CANDIDATE === fe.STRONG_BUY && typeof fe.STRONG_BUY === 'number',
);
check(
  `매수 컷 동기: BE BUY_CANDIDATE(${be.BUY_CANDIDATE}) === FE BUY(${fe.BUY})`,
  be.BUY_CANDIDATE === fe.BUY && typeof fe.BUY === 'number',
);
check(
  `관망 컷 동기: BE WATCH(${be.WATCH}) === FE WATCH(${fe.WATCH})`,
  be.WATCH === fe.WATCH && typeof fe.WATCH === 'number',
);
check(
  `중립 컷 동기: BE NEUTRAL(${be.NEUTRAL}) === FE NEUTRAL(${fe.NEUTRAL})`,
  be.NEUTRAL === fe.NEUTRAL && typeof fe.NEUTRAL === 'number',
);

// ---------- (B) 동작 모델 ----------
// 백엔드 mapScoreToGrade 재현(buy-signal.service.ts와 동일 구조).
type Grade = 'STRONG_BUY' | 'BUY' | 'WATCH' | 'NEUTRAL' | 'AVOID';
function gradeOf(score: number): Grade {
  if (score >= be.STRONG_BUY_CANDIDATE) return 'STRONG_BUY';
  if (score >= be.BUY_CANDIDATE) return 'BUY';
  if (score >= be.WATCH) return 'WATCH';
  if (score >= be.NEUTRAL) return 'NEUTRAL';
  return 'AVOID';
}
// 모바일 buyScoreColor 재현(signalDisplay.ts와 동일 구조) — 밴드를 등급명으로 표현.
function bandOf(score: number): Grade {
  if (score >= fe.STRONG_BUY) return 'STRONG_BUY'; // success
  if (score >= fe.BUY) return 'BUY'; // primary
  if (score >= fe.WATCH) return 'WATCH'; // warning
  if (score >= fe.NEUTRAL) return 'NEUTRAL'; // textSecondary
  return 'AVOID'; // error
}
// B-1 핵심 DoD: -100~100 전 구간(백엔드 buyScore는 정수)에서 밴드 == 등급. 교차 모순 0.
{
  let mismatches = 0;
  for (let s = -100; s <= 100; s++) {
    if (gradeOf(s) !== bandOf(s)) mismatches++;
  }
  check('B-1: -100~100 전 구간 스윕 — 게이지 밴드 == 등급 칩(모순 0)', mismatches === 0);
  // 이슈 재현 케이스: buyScore 50 '강한매수'가 더는 warning 밴드('주의')로 그려지지 않는다.
  check('B-1: score 50 → 강한매수 밴드(success)', bandOf(50) === 'STRONG_BUY');
  check('B-1: score 45 → 매수 밴드(primary)', bandOf(45) === 'BUY');
  check('B-1: score 44 → 관망 밴드(warning)', bandOf(44) === 'WATCH');
  check('B-1: score 0 → 중립 밴드(textSecondary)', bandOf(0) === 'NEUTRAL');
  check('B-1: score -30 → 회피 밴드(error)', bandOf(-30) === 'AVOID');
}
// nextCutGap 재현(signalDisplay.ts와 동일 구조) — NEUTRAL(-29) 경계 포함 실제 등급 경계.
function nextCutGapModel(score: number): string | null {
  const cuts = [fe.NEUTRAL, fe.WATCH, fe.BUY, fe.STRONG_BUY];
  const next = cuts.find((c) => c > score);
  if (next === undefined) return null;
  return `+${next - score}`;
}
{
  check('B-1: score 50(최상위 등급) → 다음 등급 없음(null)', nextCutGapModel(50) === null);
  check("B-1: score 45(매수) → '+5'(강한매수 50까지)", nextCutGapModel(45) === '+5');
  check("B-1: score 44(관망) → '+1'(매수 45까지)", nextCutGapModel(44) === '+1');
  check("B-1: score 0(중립) → '+30'(관망 30까지)", nextCutGapModel(0) === '+30');
  check("B-1: score -50(회피) → '+21'(중립 -29까지)", nextCutGapModel(-50) === '+21');
}
// B-3 표시 규칙 재현: 숫자는 -100~100 그대로, 막대만 0 바닥.
function clampBuyScoreForDisplay(score: number): number {
  return Math.max(-100, Math.min(100, score));
}
function scoreBarPercent(score: number): number {
  return Math.max(0, Math.min(100, score));
}
{
  check('B-3: 음수 점수 표시값 보존(-10 → -10, 0 아님)', clampBuyScoreForDisplay(-10) === -10);
  check('B-3: 음수 점수 막대는 0 바닥(-10 → 0%)', scoreBarPercent(-10) === 0);
  check('B-3: 백엔드 하한 -100 보존', clampBuyScoreForDisplay(-999) === -100);
  check('B-3: 상한 100 보존(표시·막대 동일)', clampBuyScoreForDisplay(150) === 100 && scoreBarPercent(150) === 100);
  check('B-3: 양수 구간은 표시값 == 막대(기존 동작 불변)', clampBuyScoreForDisplay(78) === scoreBarPercent(78));
}

// ---------- (C) 소스 바인딩 ----------
// signalDisplay.ts — 컷 파생·음수 규칙이 소스에 실재하는지.
check(
  'src: BUY_SCORE_CUTS 가 BUY_GRADE_THRESHOLDS 에서 파생',
  /BUY_SCORE_CUTS\s*=\s*\[\s*BUY_GRADE_THRESHOLDS\.WATCH,\s*BUY_GRADE_THRESHOLDS\.BUY,\s*BUY_GRADE_THRESHOLDS\.STRONG_BUY,\s*\]\s*as const/.test(
    displaySrc,
  ),
);
check('src: 임의 컷 [30, 60, 80] 잔존 0', !/\[30,\s*60,\s*80\]/.test(displaySrc));
check(
  'src: nextCutGap 이 NEUTRAL 경계 포함 전체 컷(BUY_GRADE_CUTS_ALL) 사용',
  /BUY_GRADE_CUTS_ALL\s*=\s*\[BUY_GRADE_THRESHOLDS\.NEUTRAL,\s*\.\.\.BUY_SCORE_CUTS\]/.test(displaySrc) &&
    /kind === 'buy' \? BUY_GRADE_CUTS_ALL : EXIT_SCORE_CUTS/.test(displaySrc),
);
check(
  'src: buyScoreColor 4개 분기 전부 BUY_GRADE_THRESHOLDS 참조',
  (displaySrc.match(/if \(score >= BUY_GRADE_THRESHOLDS\.[A-Z_]+\) return colors\./g) ?? []).length === 4,
);
check(
  'src: 표시 스케일 상수 BUY_SCORE_MIN/-100 · BUY_SCORE_MAX/100',
  /BUY_SCORE_MIN = -100/.test(displaySrc) && /BUY_SCORE_MAX = 100/.test(displaySrc),
);
check(
  'src: clampBuyScoreForDisplay·scoreBarPercent 분리 export',
  /export function clampBuyScoreForDisplay\(/.test(displaySrc) &&
    /export function scoreBarPercent\(/.test(displaySrc),
);
check(
  'src: scoreOneLiner 폴백 컷도 BUY_GRADE_THRESHOLDS 참조',
  /if \(score >= BUY_GRADE_THRESHOLDS\.STRONG_BUY\) return SCORE_ONE_LINER/.test(displaySrc),
);

// ScoreGauge.tsx — 숫자(참값) vs 막대(0 바닥) 분리 + InfoSheet 카피 재산정.
check(
  'gauge: shownScore = buy 참값(clampBuyScoreForDisplay) / exit 0~100',
  /const shownScore = kind === 'exit' \? scoreBarPercent\(score\) : clampBuyScoreForDisplay\(score\)/.test(
    gaugeSrc,
  ),
);
check('gauge: 막대 지오메트리 = scoreBarPercent(0 바닥)', /const clamped = scoreBarPercent\(score\)/.test(gaugeSrc));
check(
  'gauge: Math.max(0, Math.min(100, score)) 단독 클램프 제거(B-3)',
  !/Math\.max\(0,\s*Math\.min\(100,\s*score\)\)/.test(gaugeSrc),
);
check(
  'gauge: 헤드라인 숫자 = 음수면 참값 정적 표기(headlineScore)',
  /const headlineScore = shownScore < 0 \? shownScore : displayScore/.test(gaugeSrc) &&
    /\{headlineScore\}<\/Text>/.test(gaugeSrc),
);
check('gauge: 색·다음등급 산정이 shownScore(참값) 기준', /buyScoreColor\(shownScore, colors\)/.test(gaugeSrc) && /nextCutGap\(shownScore, kind\)/.test(gaugeSrc));
check('gauge: a11y 라벨도 참값(shownScore) 낭독', /\$\{label \?\? title\} \$\{shownScore\}점/.test(gaugeSrc));
check('gauge: InfoSheet — Buy Score 스케일 -100~100 서술', /매수 매력도를 -100~100으로/.test(gaugeSrc));
check(
  'gauge: InfoSheet — 구간 카피가 실제 등급 라벨(강한매수/매수/관망/중립/회피) 서술',
  /강한매수 구간/.test(gaugeSrc) &&
    /매수 구간/.test(gaugeSrc) &&
    /관망 구간/.test(gaugeSrc) &&
    /중립 구간/.test(gaugeSrc) &&
    /회피 구간입니다/.test(gaugeSrc),
);
check('gauge: InfoSheet — 구 임의 구간 카피(강세/양호/주의/약세) 제거', !/양호 구간/.test(gaugeSrc) && !/주의 구간/.test(gaugeSrc));
check('gauge: InfoSheet — 차단(BLOCKED) 등급 예외를 명시(거짓 단언 방지)', /차단 등급 표기가 우선/.test(gaugeSrc));
check('gauge: NEUTRAL 경계 카피가 SSOT(BUY_GRADE_THRESHOLDS.NEUTRAL) 참조', /BUY_GRADE_THRESHOLDS\.NEUTRAL/.test(gaugeSrc));

// SignalMiniGauge.tsx — 동일 규칙(참값 숫자 + 0 바닥 막대) 사용.
check(
  'mini: clampBuyScoreForDisplay·scoreBarPercent 재사용(동일 규칙)',
  /clampBuyScoreForDisplay\(score\)/.test(miniSrc) && /scoreBarPercent\(score\)/.test(miniSrc),
);
check('mini: Math.max(0, Math.min(100, score)) 단독 클램프 제거(B-3)', !/Math\.max\(0,\s*Math\.min\(100,\s*score\)\)/.test(miniSrc));
check('mini: 숫자 라벨 = 참값(shownScore)', /\{shownScore\}/.test(miniSrc));
check('mini: 막대 폭 = barPercent(0 바닥)', /width: `\$\{barPercent\}%`/.test(miniSrc));
check('mini: 색 = 참값 기준 buyScoreColor(shownScore)', /buyScoreColor\(shownScore, colors\)/.test(miniSrc));

console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail === 0 ? 0 : 1);
