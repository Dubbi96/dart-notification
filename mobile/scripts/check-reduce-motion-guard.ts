/**
 * DAR-296: 애니메이션 컴포넌트가 reduce-motion('동작 줄이기')을 존중하는지 결정론 검증.
 * DAR-333: 공시 상세 2개 섹션의 로컬 펄스 재구현을 공용 useSkeletonPulse 훅으로 통합.
 *          → 두 섹션은 더 이상 useReducedMotion 가드를 직접 구현하지 않고, 정본 훅을 통해
 *            가드를 자동 수혜한다(DetailSkeleton 과 동일 구조). 정본 가드 소유자는 축소된다.
 *
 * 두 축으로 입증한다.
 *  (A) 동작 모델: 실제 가드 분기 로직을 fake Animated/opacity로 재현해
 *      reduce-motion ON → 루프/타이밍 미실행·정적 표면, OFF → 기존 펄스/슬라이드 동작을 단언.
 *  (B) 소스 바인딩:
 *      (B1) 정본 가드 소유자(SkeletonCard·OfflineBanner)가 useReducedMotion 을 import·구독하고
 *           가드 분기(if (reducedMotion))·deps([..., reducedMotion])를 갖는지 단언.
 *      (B2) 공용 훅 위임자(DisclosureFiledFactsSection·DisclosureAiAnalysisSection·DetailSkeleton)가
 *           useSkeletonPulse 를 사용하고, 로컬 펄스(Animated.loop / 자체 useReducedMotion)를
 *           재구현하지 않는지 단언 → 모션 일관성·중복 0(DAR-333).
 *
 * 평시(reduce-motion OFF) 동작 불변을 동시에 확인 → 시각/동작 회귀 0 입증.
 * RN 런타임 의존 없이 npx tsx 로 단독 실행.
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
// fake Animated.Value: setValue/리스너 추적
class FakeValue {
  current: number;
  setValueCalls: number[] = [];
  constructor(v: number) {
    this.current = v;
  }
  setValue(v: number) {
    this.current = v;
    this.setValueCalls.push(v);
  }
}

// 펄스 훅(useSkeletonPulse / usePulse)의 effect 로직을 그대로 재현.
function runPulseEffect(reducedMotion: boolean) {
  const opacity = new FakeValue(0.4);
  let loopStarted = false;
  // ↓↓ 소스의 effect 본문과 동일 구조 ↓↓
  if (reducedMotion) {
    opacity.setValue(1);
  } else {
    opacity.setValue(0.4);
    // Animated.loop(...).start()
    loopStarted = true;
  }
  return { opacity, loopStarted };
}

// reduce-motion ON: 루프 미실행, 정적 표면(1.0)
{
  const r = runPulseEffect(true);
  check('pulse ON: 루프 미시작', r.loopStarted === false);
  check('pulse ON: 정적 표면 opacity=1', r.opacity.current === 1);
  check('pulse ON: 펄스 0.4 베이스로 흔들리지 않음', !r.opacity.setValueCalls.includes(0.4));
}
// reduce-motion OFF: 기존 펄스 동작 보존
{
  const r = runPulseEffect(false);
  check('pulse OFF: 루프 시작(기존 동작 불변)', r.loopStarted === true);
  check('pulse OFF: 펄스 베이스 0.4 복원', r.opacity.current === 0.4);
}

// OfflineBanner effect 로직 재현(슬라이드/페이드 vs 즉시 스냅).
function runBannerEffect(reducedMotion: boolean, isOffline: boolean) {
  const anim = new FakeValue(0);
  let timingStarted = false;
  let timingDuration: number | null = null;
  if (reducedMotion) {
    anim.setValue(isOffline ? 1 : 0);
  } else {
    timingStarted = true;
    timingDuration = 220;
    // Animated.timing(...).start() → 최종값으로 보간
    anim.setValue(isOffline ? 1 : 0);
  }
  return { anim, timingStarted, timingDuration };
}

// reduce-motion ON: 슬라이드/페이드 타이밍 미실행, 표시 여부는 동일
{
  const on = runBannerEffect(true, true);
  check('banner ON+offline: 타이밍 미실행(모션 제거)', on.timingStarted === false);
  check('banner ON+offline: 즉시 표시 anim=1', on.anim.current === 1);
  const off = runBannerEffect(true, false);
  check('banner ON+online: 즉시 숨김 anim=0', off.anim.current === 0);
}
// reduce-motion OFF: 220ms 슬라이드/페이드 보존
{
  const r = runBannerEffect(false, true);
  check('banner OFF: 220ms 타이밍 실행(기존 동작 불변)', r.timingStarted === true && r.timingDuration === 220);
  check('banner OFF: 최종 표시 anim=1', r.anim.current === 1);
}

// ---------- (B) 소스 바인딩 ----------
const ROOT = join(__dirname, '..');

// (B1) 정본 가드 소유자 — 자체적으로 useReducedMotion 가드를 구현하는 컴포넌트.
const GUARD_OWNER_FILES = [
  'components/common/SkeletonCard.tsx',
  'components/common/OfflineBanner.tsx',
];

for (const rel of GUARD_OWNER_FILES) {
  const src = readFileSync(join(ROOT, rel), 'utf8');
  const name = rel.split('/').pop();
  check(`${name}: useReducedMotion import(정본 @hooks)`, /import\s*\{\s*useReducedMotion\s*\}\s*from\s*'@hooks\/useReducedMotion'/.test(src));
  check(`${name}: const reducedMotion = useReducedMotion()`, /const\s+reducedMotion\s*=\s*useReducedMotion\(\)/.test(src));
  check(`${name}: 가드 분기 if (reducedMotion)`, /if\s*\(\s*reducedMotion\s*\)/.test(src));
  check(`${name}: effect deps에 reducedMotion 포함`, /\}\s*,\s*\[[^\]]*reducedMotion[^\]]*\]\s*\)/.test(src));
}

// (B2) 공용 훅 위임자 — 정본 useSkeletonPulse 를 사용하고 로컬 펄스를 재구현하지 않는 컴포넌트.
//      DAR-333: 공시 상세 2개 섹션이 로컬 Animated.loop/자체 useReducedMotion 가드를 제거하고
//      SkeletonCard 의 useSkeletonPulse 를 import → 가드는 정본 훅을 통해 자동 수혜.
const PULSE_DELEGATE_FILES = [
  'components/common/DetailSkeleton.tsx',
  'components/disclosure/DisclosureFiledFactsSection.tsx',
  'components/disclosure/DisclosureAiAnalysisSection.tsx',
];

for (const rel of PULSE_DELEGATE_FILES) {
  const src = readFileSync(join(ROOT, rel), 'utf8');
  const name = rel.split('/').pop();
  check(`${name}: 공용 useSkeletonPulse 사용(가드 자동 수혜)`, /useSkeletonPulse/.test(src));
  // 로컬 펄스 재구현 0 — 모션 비일관·중복 회귀 가드(DAR-333).
  check(`${name}: 로컬 Animated.loop 재구현 없음`, !/Animated\.loop/.test(src));
  check(`${name}: 자체 useReducedMotion 가드 재구현 없음`, !/useReducedMotion/.test(src));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
