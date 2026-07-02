/**
 * W1 잔여(6/27 UI/UX 감사) deterministic check — 신호 탭 첫 진입 코치마크.
 *
 * 두 축으로 입증한다.
 *  (A) 동작 모델: useSignalsCoachmark 의 SecureStore 단일키 상태머신을 RN 없이 재현해
 *      - 로딩(null) 동안 미노출 → 저장값 없으면 첫 진입 노출
 *      - dismiss(닫기) 즉시 숨김(낙관적) + 영속화 → 재진입(다음 세션)에도 재노출 없음
 *      - 영속화 실패 시에도 이번 세션 노출은 차단(비차단 폴백)
 *      - 홈 firstWatch 키와 저장소가 독립(한쪽 해제가 다른 쪽에 전파되지 않음) 을 단언.
 *  (B) 소스 바인딩: 훅이 expo-secure-store 단일키('signalsCoachDismissed', firstWatch 와 상이)를
 *      쓰고, SignalsCoachmark 가 3포인트(①점수 게이지 -100~100·등급 경계 ②등급 칩 의미
 *      ③'표본 N건' 의미)를 SSOT(signalDisplay 상수·gradeLabel) 보간으로 서술하며, 과신 금지
 *      각주·지시 금지 카피·닫기 a11y(한국어 라벨 + 44pt) ·스크린리더 순서(제목→포인트→각주→닫기)
 *      를 지키고, signals/index.tsx 에 인증 게이트로 장착됐는지 단언.
 *
 * Run: npx tsx scripts/check-signals-coachmark.ts
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
// 훅과 동일 구조의 상태머신: null=로딩 / false=노출 가능 / true=숨김. 저장값은 'true' 문자열 단일키.
function createCoachmark(store: Map<string, string>, key: string, opts?: { persistFails?: boolean }) {
  let dismissed: boolean | null = null; // 마운트 직후(로딩)
  return {
    /** SecureStore.getItemAsync 완료 시점 재현 */
    load() {
      dismissed = store.get(key) === 'true';
    },
    /** 닫기 탭 재현 — 낙관적 즉시 숨김 + 영속화(실패해도 비차단) */
    dismiss() {
      dismissed = true;
      if (!opts?.persistFails) store.set(key, 'true');
    },
    /** 컴포넌트 노출 조건 재현: dismissed !== false 면 null 반환 */
    visible() {
      return dismissed === false;
    },
  };
}

// 첫 진입: 로딩 동안 미노출 → 저장값 없으면 노출.
{
  const store = new Map<string, string>();
  const c = createCoachmark(store, 'signalsCoachDismissed');
  check('첫 진입: 로딩(null) 동안 미노출', c.visible() === false);
  c.load();
  check('첫 진입: 저장값 없음 → 노출', c.visible() === true);
}
// 닫기: 낙관적 즉시 숨김 + 영속화 → 다음 세션 재노출 없음.
{
  const store = new Map<string, string>();
  const c = createCoachmark(store, 'signalsCoachDismissed');
  c.load();
  c.dismiss();
  check('닫기: 즉시 숨김(낙관적)', c.visible() === false);
  check("닫기: SecureStore 에 'true' 영속화", store.get('signalsCoachDismissed') === 'true');
  const next = createCoachmark(store, 'signalsCoachDismissed');
  next.load();
  check('재진입(다음 세션): 재노출 없음', next.visible() === false);
}
// 영속화 실패: 이번 세션 노출은 차단(비차단 폴백) — 다음 세션 재노출은 허용.
{
  const store = new Map<string, string>();
  const c = createCoachmark(store, 'signalsCoachDismissed', { persistFails: true });
  c.load();
  c.dismiss();
  check('영속화 실패: 이번 세션은 숨김 유지', c.visible() === false);
  const next = createCoachmark(store, 'signalsCoachDismissed');
  next.load();
  check('영속화 실패: 다음 세션 재노출 허용(데이터 정직)', next.visible() === true);
}
// 키 독립: 홈 firstWatch 해제가 신호 코치마크에 전파되지 않음(역방향 동일).
{
  const store = new Map<string, string>();
  const home = createCoachmark(store, 'firstWatchCoachDismissed');
  const signals = createCoachmark(store, 'signalsCoachDismissed');
  home.load();
  signals.load();
  home.dismiss();
  signals.load();
  check('키 독립: 홈 코치마크 해제 후에도 신호 코치마크는 노출', signals.visible() === true);
}

// ---------- (B) 소스 바인딩 ----------
const ROOT = join(__dirname, '..');
const hookSrc = readFileSync(join(ROOT, 'hooks/useSignalsCoachmark.ts'), 'utf8');
const firstWatchSrc = readFileSync(join(ROOT, 'hooks/useFirstWatchCoachmark.ts'), 'utf8');
const compSrc = readFileSync(join(ROOT, 'components/signals/SignalsCoachmark.tsx'), 'utf8');
const screenSrc = readFileSync(join(ROOT, 'app/(tabs)/signals/index.tsx'), 'utf8');

// 훅 — SecureStore 단일키 패턴(useFirstWatchCoachmark 복제, 키만 교체).
check('hook: expo-secure-store 사용', /from 'expo-secure-store'/.test(hookSrc));
check('hook: AsyncStorage 미사용(Expo Go 제약)', !/AsyncStorage/.test(hookSrc));
check("hook: 단일키 KEY = 'signalsCoachDismissed'", /const KEY = 'signalsCoachDismissed'/.test(hookSrc));
{
  const fwKey = firstWatchSrc.match(/const KEY = '([^']+)'/)?.[1];
  const sgKey = hookSrc.match(/const KEY = '([^']+)'/)?.[1];
  check(`hook: firstWatch 키(${fwKey})와 상이한 키(${sgKey})`, !!fwKey && !!sgKey && fwKey !== sgKey);
}
check("hook: 저장값 'true' 문자열 해석(v === 'true')", /v === 'true'/.test(hookSrc));
check('hook: 낙관적 즉시 숨김(setDismissed(true) 선행)', /setDismissed\(true\); \/\/ 낙관적 즉시 숨김/.test(hookSrc));
check('hook: 영속화 실패 비차단(catch)', /setItemAsync\(KEY, 'true'\)\.catch/.test(hookSrc));
check('hook: 언마운트 가드(active 플래그)', /let active = true/.test(hookSrc) && /active = false/.test(hookSrc));
check('hook: null=로딩 3상태(boolean | null)', /useState<boolean \| null>\(null\)/.test(hookSrc));

// 컴포넌트 — 노출 조건·3포인트·SSOT 보간.
check('comp: useSignalsCoachmark 훅 사용', /useSignalsCoachmark\(\)/.test(compSrc));
check('comp: 로딩/해제 시 미노출(dismissed !== false → null)', /if \(dismissed !== false\) return null/.test(compSrc));
check(
  'comp: SSOT import(BUY_GRADE_THRESHOLDS·BUY_SCORE_MIN/MAX·gradeLabel from @utils/signalDisplay)',
  /BUY_GRADE_THRESHOLDS/.test(compSrc) &&
    /BUY_SCORE_MIN/.test(compSrc) &&
    /BUY_SCORE_MAX/.test(compSrc) &&
    /gradeLabel/.test(compSrc) &&
    /from '@utils\/signalDisplay'/.test(compSrc),
);
// ① 점수 게이지 읽는 법 — 스케일·등급 경계를 SSOT 보간으로 서술(숫자 하드코딩 드리프트 차단).
check(
  'comp: ① 게이지 스케일 = ${BUY_SCORE_MIN}~${BUY_SCORE_MAX} 보간(하드코딩 아님)',
  /\$\{BUY_SCORE_MIN\}~\$\{BUY_SCORE_MAX\} 스케일/.test(compSrc),
);
check(
  'comp: ① 등급 경계 = THRESHOLDS.WATCH·BUY·STRONG_BUY 보간',
  /\$\{BUY_GRADE_THRESHOLDS\.WATCH\}·\$\{BUY_GRADE_THRESHOLDS\.BUY\}·\$\{BUY_GRADE_THRESHOLDS\.STRONG_BUY\}점이 등급 경계/.test(compSrc),
);
check('comp: ① 음수도 정상 값 서술(B-3 정직 표기와 정합)', /음수도 정상 값/.test(compSrc));
// ② 등급 칩 의미 — 라벨 SSOT(gradeLabel) 재사용 + 지시 금지 카피.
check(
  'comp: ② 등급 칩 라벨 5종 = gradeLabel SSOT 보간',
  /\$\{gradeLabel\('STRONG_BUY'\)\}·\$\{gradeLabel\('BUY'\)\}·\$\{gradeLabel\('WATCH'\)\}·\$\{gradeLabel\('NEUTRAL'\)\}·\$\{gradeLabel\('AVOID'\)\}/.test(compSrc),
);
check('comp: ② 등급 칩 = 점수 구간의 이름표 서술', /점수 구간의 이름표/.test(compSrc));
check('comp: ② 매수·매도 지시 아님 명시(정책: 지시형 금지)', /매수·매도 지시가 아니에요/.test(compSrc));
// ③ '표본 N건' 의미 — 과신 방지 서술.
check("comp: ③ '표본 N건' 정의(과거 사례 수)", /'표본 N건'은 통계를 계산한 과거 사례 수/.test(compSrc));
check('comp: ③ 저표본 = 신뢰도 제한 서술(과신 방지)', /표본이 적을수록/.test(compSrc) && /신뢰도가 제한적/.test(compSrc));
// 과신 금지 각주 — ScoreGauge InfoSheet 각주와 동일 취지.
check('comp: 각주 = 참고 정보·투자 권유 아님', /참고 정보이며 투자 권유가 아닙니다/.test(compSrc));
// 지시·과신 카피 금지(전수) — '지금 사세요/파세요' 류 지시형 문구 부재.
check('comp: 지시형 문구 부재(사세요/파세요/추천)', !/사세요|파세요|추천/.test(compSrc));

// 컴포넌트 — a11y(닫기 라벨·44pt·스크린리더 순서)·스타일 규약.
check('comp: 닫기 accessibilityRole="button"', /accessibilityRole="button"/.test(compSrc));
check('comp: 닫기 한국어 accessibilityLabel', /accessibilityLabel="신호 읽는 법 안내 닫기"/.test(compSrc));
check(
  'comp: 닫기 44pt 터치영역 = sizing.minTouchTarget 파생 hitSlop',
  /\(sizing\.minTouchTarget - sizing\.icon\.md\) \/ 2/.test(compSrc) && /hitSlop=\{CLOSE_HIT_SLOP\}/.test(compSrc),
);
check('comp: 제목 accessibilityRole="header"', /accessibilityRole="header"/.test(compSrc));
{
  // 스크린리더 순서: 제목 → 포인트 → 각주 → 닫기(트리 마지막). 소스 등장 순서로 단언.
  const idxTitle = compSrc.indexOf('신호 읽는 법 3가지');
  const idxPoints = compSrc.indexOf('COACH_POINTS.map');
  const idxFootnote = compSrc.indexOf('참고 정보이며 투자 권유가 아닙니다');
  const idxClose = compSrc.indexOf('accessibilityLabel="신호 읽는 법 안내 닫기"');
  check(
    'comp: SR 순서 = 제목 → 3포인트 → 각주 → 닫기(트리 마지막)',
    idxTitle > -1 && idxPoints > idxTitle && idxFootnote > idxPoints && idxClose > idxFootnote,
  );
}
check('comp: 닫기 시각 위치 = 우상단 고정(position absolute)', /position: 'absolute'/.test(compSrc));
check('comp: Feather 아이콘(Ionicons 미사용)', /from '@expo\/vector-icons'/.test(compSrc) && !/Ionicons/.test(compSrc));
check('comp: 하드코딩 hex 색상 0(테마 토큰만)', !/#[0-9a-fA-F]{3,8}/.test(compSrc));
check(
  'comp: FirstWatchCoachmark 카드 스타일 재사용(radius.lg·borderWidth 1·padding spacing.base)',
  /borderRadius: radius\.lg/.test(compSrc) && /borderWidth: 1/.test(compSrc) && /padding: spacing\.base/.test(compSrc),
);
check('comp: 카드 톤 = primaryLight 배경 + primary 보더(홈 코치마크 동일)', /backgroundColor: colors\.primaryLight/.test(compSrc) && /borderColor: colors\.primary/.test(compSrc));
check('comp: 함수형 컴포넌트 export', /export function SignalsCoachmark\(\)/.test(compSrc));

// 장착부 — signals/index.tsx 최소 hunk(인증 게이트·헤더 아래·본문 위).
check("mount: import SignalsCoachmark from '@components/signals/SignalsCoachmark'", /import \{ SignalsCoachmark \} from '@components\/signals\/SignalsCoachmark'/.test(screenSrc));
check('mount: 인증 게이트(게스트 미노출 — 1회성 소모 방지)', /\{isAuthenticated && <SignalsCoachmark \/>\}/.test(screenSrc));
{
  const idxMount = screenSrc.indexOf('<SignalsCoachmark />');
  const idxBody = screenSrc.indexOf('{renderBody()}');
  check('mount: 헤더 아래·본문(renderBody) 위 장착', idxMount > -1 && idxBody > idxMount);
}

console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail === 0 ? 0 : 1);
