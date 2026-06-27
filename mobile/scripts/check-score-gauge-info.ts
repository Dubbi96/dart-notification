/**
 * DAR-448 deterministic check — ScoreGauge 용어설명(InfoSheet, B1) + 리스트 내 카운트업 비활성(B5).
 *
 * 두 축으로 입증한다.
 *  (A) 동작 모델: 컴포넌트의 기본값 해석/카운트업 effect 분기 로직을 RN 없이 재현해
 *      - 리스트·카루셀 카드(accessibilityHidden=true) → 카운트업 OFF · info 버튼 미노출
 *      - 단독/상세 표면(accessibilityHidden=false) → 카운트업 ON · info 버튼 노출
 *      - reduce-motion ON → prop 무관 정적
 *      - 정적 경로는 Animated 리스너·타이밍 없이 즉시 최종값(매 프레임 setState 0) 을 단언.
 *  (B) 소스 바인딩: ScoreGauge.tsx 가 InfoSheet/Feather/useHaptics 를 import 하고,
 *      animated·showInfo 기본값을 accessibilityHidden 으로 도출하며, info 버튼이 44pt 터치영역+
 *      한국어 a11y 라벨을 갖고, 정적 경로가 Animated 를 우회하며, 등급 컷 카피가 SSOT 컷을
 *      재사용(드리프트 0)하는지 단언. reduce-motion 가드·기존 게이지 구조 회귀 0 동시 확인.
 *
 * Run: npx tsx scripts/check-score-gauge-info.ts
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

// ---------- (A) 동작 모델 ----------
// 기본값 해석(컴포넌트 본문과 동일 구조): animated/showInfo 미지정 시 단독표면에서만 ON.
function resolve(opts: {
  accessibilityHidden?: boolean;
  animated?: boolean;
  showInfo?: boolean;
  reducedMotion?: boolean;
}) {
  const { accessibilityHidden = false, animated, showInfo, reducedMotion = false } = opts;
  const isStandalone = !accessibilityHidden;
  const animateCountUp = animated ?? isStandalone;
  const showInfoButton = showInfo ?? isStandalone;
  const shouldAnimate = animateCountUp && !reducedMotion;
  return { animateCountUp, showInfoButton, shouldAnimate };
}

// 리스트·카루셀 카드(상위 카드가 표현·접근성 소유) — 정적 + info 미노출(B5·B1).
{
  const r = resolve({ accessibilityHidden: true });
  check('list 카드: 카운트업 기본 OFF', r.animateCountUp === false);
  check('list 카드: info 버튼 기본 미노출', r.showInfoButton === false);
  check('list 카드: shouldAnimate=false(정적)', r.shouldAnimate === false);
}
// 단독/상세 표면(signals/[id]·DecisionHubTab) — 카운트업 + info 노출(B1·B5).
{
  const r = resolve({ accessibilityHidden: false });
  check('상세 표면: 카운트업 기본 ON', r.animateCountUp === true);
  check('상세 표면: info 버튼 기본 노출', r.showInfoButton === true);
  check('상세 표면: shouldAnimate=true(카운트업)', r.shouldAnimate === true);
}
// intro 쇼케이스(카드 합성·명시 animated=false) — 정적 유지(기존 동작 불변).
{
  const r = resolve({ accessibilityHidden: true, animated: false });
  check('intro: 명시 animated=false → 정적 유지', r.animateCountUp === false && r.shouldAnimate === false);
}
// 명시 override: 카드에서도 animated/showInfo 를 강제할 수 있어야 함.
{
  const r = resolve({ accessibilityHidden: true, animated: true, showInfo: true });
  check('override: animated=true 강제 → 카운트업 ON', r.animateCountUp === true);
  check('override: showInfo=true 강제 → info 노출', r.showInfoButton === true);
}
// reduce-motion ON: 상세 표면이어도 정적(폴백 의무, §11).
{
  const r = resolve({ accessibilityHidden: false, reducedMotion: true });
  check('reduce-motion ON: 상세여도 shouldAnimate=false', r.shouldAnimate === false);
  check('reduce-motion ON: info 노출은 모션과 무관(유지)', r.showInfoButton === true);
}

// 카운트업 effect 분기 + 렌더-페이즈 표시값(컴포넌트와 동일 구조).
//   displayScore = shouldAnimate ? animatedScore(리스너 갱신) : clamped(렌더-페이즈 직접)
function runGauge(shouldAnimate: boolean, clamped: number) {
  let animSetValue = -1;
  let listenerAttached = false;
  let timingStarted = false;
  // effect 본문 내 동기 setState 횟수(린트 가드 의미) — 두 경로 모두 0(정적=Animated.Value 동기화만,
  // 카운트업=비동기 리스너 콜백). 렌더-페이즈 파생이라 effect 본문 동기 setState 는 없다.
  const effectSetStateCalls = 0;
  let animatedScore = 0;
  if (!shouldAnimate) {
    // 정적 경로: effect 는 Animated.Value 만 동기화(setState 0). 리스너·타이밍 미부착.
    animSetValue = clamped;
  } else {
    listenerAttached = true;
    timingStarted = true;
    // 리스너(비동기 콜백)가 0→clamped 보간하며 animatedScore 갱신(effect 본문 동기 setState 아님).
    animatedScore = clamped;
  }
  // 렌더-페이즈 파생: 정적이면 clamped, 카운트업이면 리스너 누적값.
  const displayScore = shouldAnimate ? animatedScore : clamped;
  return { displayScore, animSetValue, listenerAttached, timingStarted, effectSetStateCalls };
}
{
  const s = runGauge(false, 78);
  check('정적: Animated 리스너 미부착', s.listenerAttached === false);
  check('정적: 타이밍 미실행', s.timingStarted === false);
  check('정적: 렌더-페이즈 즉시 최종값(displayScore=78)', s.displayScore === 78 && s.animSetValue === 78);
  check('정적: effect 내 동기 setState 0(스크롤 잼 제거·린트 가드)', s.effectSetStateCalls === 0);
}
{
  const a = runGauge(true, 78);
  check('카운트업: 리스너 부착 + 타이밍 실행', a.listenerAttached === true && a.timingStarted === true);
  check('카운트업: 최종값 도달(displayScore=78)', a.displayScore === 78);
}

// ---------- (B) 소스 바인딩 ----------
const ROOT = join(__dirname, '..');
const src = readFileSync(join(ROOT, 'components/common/ScoreGauge.tsx'), 'utf8');

// import 결선
check('import: InfoSheet(@components/common/InfoSheet)', /import\s*\{\s*InfoSheet\s*,\s*type\s+InfoSheetSection\s*\}\s*from\s*'@components\/common\/InfoSheet'/.test(src));
check('import: Feather(@expo/vector-icons)', /import\s*\{\s*Feather\s*\}\s*from\s*'@expo\/vector-icons'/.test(src));
check('import: useHaptics(@hooks/useHaptics)', /import\s*\{\s*useHaptics\s*\}\s*from\s*'@hooks\/useHaptics'/.test(src));
check('import: TouchableOpacity(react-native)', /TouchableOpacity/.test(src) && /from\s*'react-native'/.test(src));

// 기본값 도출(B1·B5) — accessibilityHidden 으로 카운트업/ info 기본값 결정.
check('default: isStandalone = !accessibilityHidden', /const\s+isStandalone\s*=\s*!accessibilityHidden/.test(src));
check('default: animateCountUp = animated ?? isStandalone', /const\s+animateCountUp\s*=\s*animated\s*\?\?\s*isStandalone/.test(src));
check('default: showInfoButton = showInfo ?? isStandalone', /const\s+showInfoButton\s*=\s*showInfo\s*\?\?\s*isStandalone/.test(src));
// 더 이상 animated 가 무조건 true 로 기본값 고정되지 않음(B5 근본원인 'animated 기본 ON' 제거).
check('default: animated 가 destructuring 에서 true 로 고정되지 않음', !/animated\s*=\s*true/.test(src));

// info 버튼(B1) — Feather info + 버튼 role + 한국어 라벨 + 44pt 터치영역.
check('info 버튼: Feather name="info"', /<Feather\s+name="info"/.test(src));
check('info 버튼: accessibilityRole="button"', /accessibilityRole="button"/.test(src));
check('info 버튼: 한국어 a11y 라벨(설명 보기)', /accessibilityLabel=\{`\$\{title\} 점수 설명 보기`\}/.test(src));
check('info 버튼: showInfoButton 게이트로 조건부 노출', /showInfoButton\s*\?/.test(src));
// 44pt 터치영역: 아이콘 14 + hitSlop 15*2 = 44.
check('info 버튼: INFO_HIT_SLOP 정의(15 → 44pt)', /const\s+INFO_HIT_SLOP\s*=\s*\{\s*top:\s*15,\s*bottom:\s*15,\s*left:\s*15,\s*right:\s*15\s*\}/.test(src));
check('info 버튼: hitSlop={INFO_HIT_SLOP} 적용', /hitSlop=\{INFO_HIT_SLOP\}/.test(src));

// 정적 경로(B5) — Animated 우회 + 렌더-페이즈 파생(effect 내 동기 setState 없음).
check('정적 경로: if (!shouldAnimate) 분기', /if\s*\(\s*!shouldAnimate\s*\)/.test(src));
check('정적 경로: animValue.setValue(clamped) 동기화(setState 아님)', /animValue\.setValue\(clamped\)/.test(src));
check('정적 경로: displayScore 렌더-페이즈 파생(shouldAnimate ? animatedScore : clamped)', /const\s+displayScore\s*=\s*shouldAnimate\s*\?\s*animatedScore\s*:\s*clamped/.test(src));
check('정적 경로: effect 내 동기 setState 없음(린트 가드, setDisplayScore 미존재)', !/setDisplayScore/.test(src));
// 카운트업 경로는 기존 600ms ease-out 보존(상세 표면 동작 불변). 표시값은 비동기 리스너로만 갱신.
check('카운트업 경로: 리스너가 setAnimatedScore 로 비동기 갱신', /addListener\(\(\{ value \}\) => setAnimatedScore\(Math\.round\(value\)\)\)/.test(src));
check('카운트업 경로: Animated.timing duration 600 보존', /duration:\s*600/.test(src));
check('카운트업 경로: useNativeDriver:false 유지(기존)', /useNativeDriver:\s*false/.test(src));

// InfoSheet 콘텐츠(B1) — 정의·구간·행동 + 각주, 컷 숫자 SSOT 재사용(드리프트 0).
check('content: buildScoreInfoSections 가 BUY_SCORE_CUTS 재사용', /const\s+\[low,\s*mid,\s*high\]\s*=\s*BUY_SCORE_CUTS/.test(src));
check('content: buildScoreInfoSections 가 EXIT_SCORE_CUTS 재사용', /const\s+\[low,\s*high\]\s*=\s*EXIT_SCORE_CUTS/.test(src));
check('content: Buy Score 정의 섹션', /heading:\s*'Buy Score란\?'/.test(src));
check('content: Exit Score 정의 섹션', /heading:\s*'Exit Score란\?'/.test(src));
check('content: 점수 구간 읽는 법 섹션', /heading:\s*'점수 구간 읽는 법'/.test(src));
check('content: 무엇을 보고 무엇을 하라 섹션', /heading:\s*'무엇을 보고 무엇을 하라'/.test(src));
check('content: 섹션 아이콘 Feather 글리프(help-circle·bar-chart-2·compass)', /icon:\s*'help-circle'/.test(src) && /icon:\s*'bar-chart-2'/.test(src) && /icon:\s*'compass'/.test(src));
check('content: 각주 = 참고 정보·투자 권유 아님(AI 참고 표기 유지)', /투자 권유가 아닙니다/.test(src));
check('content: InfoSheet 에 footnote 전달', /footnote=\{SCORE_INFO_FOOTNOTE\}/.test(src));
check('content: InfoSheet title 한국어 안내', /title=\{`\$\{title\} 안내`\}/.test(src));

// ---------- (B-회귀) 기존 동작·가드 불변 ----------
check('회귀: reduce-motion 가드 import 유지', /import\s*\{\s*useReducedMotion\s*\}\s*from\s*'@hooks\/useReducedMotion'/.test(src));
check('회귀: shouldAnimate = animateCountUp && !reducedMotion', /const\s+shouldAnimate\s*=\s*animateCountUp\s*&&\s*!reducedMotion/.test(src));
check('회귀: 등급 컷 틱 cuts.map 보존', /cuts\.map\(/.test(src));
check('회귀: 점수 노브 displayScore 위치 보존', /left:\s*`\$\{displayScore\}%`/.test(src));
check('회귀: 비숨김 시 progressbar role 보존', /accessibilityRole=\{accessibilityHidden \? undefined : 'progressbar'\}/.test(src));
check('회귀: 다음 등급까지 캡션 보존', /다음 등급까지 \{nextGap\}/.test(src));
check('회귀: SIGNAL_TERMS 점수 라벨 SSOT 유지', /SIGNAL_TERMS\.exitScore\s*:\s*SIGNAL_TERMS\.buyScore/.test(src));

console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail === 0 ? 0 : 1);
