/**
 * DAR-547 deterministic check — 신호탭 에디션 뷰 상단 '에디션 알림 옵트인' 배너.
 *
 * 에디션 푸시(DAR-523)는 기본 OFF 옵트인 — 발견성이 0이면 기능이 죽는다. 배너로 1탭 ON 동선을
 * 제공하되 dismiss 는 SecureStore 로 영속하고 이미 켠 사용자에겐 재노출하지 않는다(재강요 금지).
 *
 * 두 축으로 입증한다.
 *  (A) 동작 모델: dismiss 상태머신(SecureStore 단일키)과 노출 매트릭스(dismiss·설정로드·이미ON)를
 *      RN 없이 재현해 — 로딩 미노출 → 첫 노출 → 닫기 영속(다음 세션 재노출 없음) → 켜기 후 미노출을 단언.
 *  (B) 소스 바인딩: 훅이 코치마크와 상이한 단일키를 쓰고, 순수 util(shouldShow…·카피)이 컴포넌트/
 *      테스트/가드 공통 SSOT 이며, 컴포넌트가 editionPushEnabled=true 인라인 토글·닫기 a11y(44pt)·
 *      테마 토큰만·Feather 를 지키고, BuyEditionView 에디션 뷰 상단에 장착됐는지 단언.
 *
 * Run: npx tsx scripts/check-edition-optin-banner.ts
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
// dismiss 상태머신: null=로딩 / false=노출 가능 / true=숨김. 저장값은 'true' 문자열 단일키.
function createBanner(store: Map<string, string>, key: string, opts?: { persistFails?: boolean }) {
  let dismissed: boolean | null = null;
  return {
    load() {
      dismissed = store.get(key) === 'true';
    },
    dismiss() {
      dismissed = true;
      if (!opts?.persistFails) store.set(key, 'true');
    },
    getDismissed() {
      return dismissed;
    },
  };
}

// 컴포넌트 노출 조건 재현(shouldShowEditionOptInBanner 와 동일 3축 AND).
function shouldShow(state: {
  dismissed: boolean | null;
  settingsLoaded: boolean;
  editionPushEnabled: boolean;
}) {
  return state.dismissed === false && state.settingsLoaded && !state.editionPushEnabled;
}

// 첫 진입: 로딩 동안 미노출 → 저장값 없고 설정 로드·에디션 OFF 면 노출.
{
  const store = new Map<string, string>();
  const b = createBanner(store, 'editionOptInBannerDismissed');
  check(
    '첫 진입: 로딩(null) 동안 미노출',
    shouldShow({ dismissed: b.getDismissed(), settingsLoaded: true, editionPushEnabled: false }) === false,
  );
  b.load();
  check(
    '첫 진입: 미해제 + 설정 로드 + 에디션 OFF → 노출',
    shouldShow({ dismissed: b.getDismissed(), settingsLoaded: true, editionPushEnabled: false }) === true,
  );
  check(
    '설정 미로드 시 미노출(이미 ON 여부 확정 전 깜빡임 방지)',
    shouldShow({ dismissed: b.getDismissed(), settingsLoaded: false, editionPushEnabled: false }) === false,
  );
  check(
    '이미 에디션 푸시 ON 이면 미노출(재권유 금지)',
    shouldShow({ dismissed: b.getDismissed(), settingsLoaded: true, editionPushEnabled: true }) === false,
  );
}
// 닫기: 낙관적 즉시 숨김 + 영속화 → 다음 세션 재노출 없음.
{
  const store = new Map<string, string>();
  const b = createBanner(store, 'editionOptInBannerDismissed');
  b.load();
  b.dismiss();
  check('닫기: 즉시 숨김(낙관적)', shouldShow({ dismissed: b.getDismissed(), settingsLoaded: true, editionPushEnabled: false }) === false);
  check("닫기: SecureStore 에 'true' 영속화", store.get('editionOptInBannerDismissed') === 'true');
  const next = createBanner(store, 'editionOptInBannerDismissed');
  next.load();
  check('재진입(다음 세션): 재노출 없음', shouldShow({ dismissed: next.getDismissed(), settingsLoaded: true, editionPushEnabled: false }) === false);
}
// 영속화 실패: 이번 세션 노출은 차단(비차단 폴백) — 다음 세션 재노출은 허용.
{
  const store = new Map<string, string>();
  const b = createBanner(store, 'editionOptInBannerDismissed', { persistFails: true });
  b.load();
  b.dismiss();
  check('영속화 실패: 이번 세션은 숨김 유지', shouldShow({ dismissed: b.getDismissed(), settingsLoaded: true, editionPushEnabled: false }) === false);
  const next = createBanner(store, 'editionOptInBannerDismissed');
  next.load();
  check('영속화 실패: 다음 세션 재노출 허용(데이터 정직)', shouldShow({ dismissed: next.getDismissed(), settingsLoaded: true, editionPushEnabled: false }) === true);
}
// 키 독립: 신호 코치마크 해제가 옵트인 배너에 전파되지 않음.
{
  const store = new Map<string, string>();
  const coach = createBanner(store, 'signalsCoachDismissed');
  const banner = createBanner(store, 'editionOptInBannerDismissed');
  coach.load();
  banner.load();
  coach.dismiss();
  banner.load();
  check('키 독립: 코치마크 해제 후에도 옵트인 배너는 노출', shouldShow({ dismissed: banner.getDismissed(), settingsLoaded: true, editionPushEnabled: false }) === true);
}

// ---------- (B) 소스 바인딩 ----------
const ROOT = join(__dirname, '..');
const hookSrc = readFileSync(join(ROOT, 'hooks/useEditionOptInBanner.ts'), 'utf8');
const coachHookSrc = readFileSync(join(ROOT, 'hooks/useSignalsCoachmark.ts'), 'utf8');
const utilSrc = readFileSync(join(ROOT, 'utils/editionOptInBanner.ts'), 'utf8');
const compSrc = readFileSync(join(ROOT, 'components/signals/EditionOptInBanner.tsx'), 'utf8');
const mountSrc = readFileSync(join(ROOT, 'components/signals/BuyEditionView.tsx'), 'utf8');

// 훅 — SecureStore 단일키 패턴(코치마크 복제, 키만 교체).
check('hook: expo-secure-store 사용', /from 'expo-secure-store'/.test(hookSrc));
check('hook: AsyncStorage 미사용(Expo Go 제약)', !/AsyncStorage/.test(hookSrc));
check("hook: 단일키 KEY = 'editionOptInBannerDismissed'", /const KEY = 'editionOptInBannerDismissed'/.test(hookSrc));
{
  const coachKey = coachHookSrc.match(/const KEY = '([^']+)'/)?.[1];
  const bannerKey = hookSrc.match(/const KEY = '([^']+)'/)?.[1];
  check(`hook: 코치마크 키(${coachKey})와 상이한 키(${bannerKey})`, !!coachKey && !!bannerKey && coachKey !== bannerKey);
}
check("hook: 저장값 'true' 문자열 해석(v === 'true')", /v === 'true'/.test(hookSrc));
check('hook: 낙관적 즉시 숨김(setDismissed(true) 선행)', /setDismissed\(true\); \/\/ 낙관적 즉시 숨김/.test(hookSrc));
check('hook: 영속화 실패 비차단(catch)', /setItemAsync\(KEY, 'true'\)\.catch/.test(hookSrc));
check('hook: 언마운트 가드(active 플래그)', /let active = true/.test(hookSrc) && /active = false/.test(hookSrc));
check('hook: null=로딩 3상태(boolean | null)', /useState<boolean \| null>\(null\)/.test(hookSrc));

// util — 노출 로직/카피 SSOT(컴포넌트·테스트·가드 공용).
check('util: shouldShowEditionOptInBanner export', /export function shouldShowEditionOptInBanner/.test(utilSrc));
check('util: 3축 AND(dismissed===false & settingsLoaded & !editionPushEnabled)', /state\.dismissed === false && state\.settingsLoaded && !state\.editionPushEnabled/.test(utilSrc));
check('util: EDITION_OPT_IN_BANNER 카피 상수 export', /export const EDITION_OPT_IN_BANNER/.test(utilSrc));
check("util: 발행 시각(저녁 7시)·에디션 어휘 명시", /저녁 7시/.test(utilSrc) && /에디션/.test(utilSrc));
check('util: 지시형·과신 문구 부재(사세요/파세요/추천)', !/사세요|파세요|추천/.test(utilSrc));

// 컴포넌트 — 노출 조건·인라인 토글·a11y·테마 규약.
check('comp: useEditionOptInBanner 훅 사용', /useEditionOptInBanner\(\)/.test(compSrc));
check('comp: shouldShowEditionOptInBanner SSOT 사용', /shouldShowEditionOptInBanner\(/.test(compSrc));
check('comp: 미노출 조건 → null 반환', /if \(!show\) return null/.test(compSrc));
check('comp: 알림 설정 훅 구독(useNotificationSettings)', /useNotificationSettings\(\)/.test(compSrc));
check(
  'comp: 인라인 토글 = editionPushEnabled true 저장(useUpdateNotificationSettings)',
  /useUpdateNotificationSettings\(\)/.test(compSrc) && /editionPushEnabled: true/.test(compSrc),
);
check('comp: 켜기 성공 시 배너 영구 숨김(dismiss 호출)', /onSuccess:[\s\S]*dismiss\(\)/.test(compSrc));
check('comp: 켜짐 확인 다이얼로그(EDITION_OPT_IN_BANNER.confirmTitle)', /EDITION_OPT_IN_BANNER\.confirmTitle/.test(compSrc));
check('comp: 닫기 accessibilityRole="button"', /accessibilityRole="button"/.test(compSrc));
check('comp: 닫기 한국어 a11y 라벨(dismissA11yLabel)', /accessibilityLabel=\{EDITION_OPT_IN_BANNER\.dismissA11yLabel\}/.test(compSrc));
check(
  'comp: 닫기 44pt 터치영역 = sizing.minTouchTarget 파생 hitSlop',
  /\(sizing\.minTouchTarget - sizing\.icon\.md\) \/ 2/.test(compSrc) && /hitSlop=\{CLOSE_HIT_SLOP\}/.test(compSrc),
);
check('comp: 제목 accessibilityRole="header"', /accessibilityRole="header"/.test(compSrc));
{
  // 스크린리더 순서: 제목 → 설명 → CTA → 닫기(트리 마지막). 소스 등장 순서로 단언.
  const idxTitle = compSrc.indexOf('EDITION_OPT_IN_BANNER.title');
  const idxDesc = compSrc.indexOf('EDITION_OPT_IN_BANNER.description');
  const idxCta = compSrc.indexOf('EDITION_OPT_IN_BANNER.enableLabel');
  const idxClose = compSrc.indexOf('EDITION_OPT_IN_BANNER.dismissA11yLabel');
  check(
    'comp: SR 순서 = 제목 → 설명 → CTA → 닫기(트리 마지막)',
    idxTitle > -1 && idxDesc > idxTitle && idxCta > idxDesc && idxClose > idxCta,
  );
}
check('comp: 닫기 시각 위치 = 우상단 고정(position absolute)', /position: 'absolute'/.test(compSrc));
check('comp: Feather 아이콘(Ionicons 미사용)', /from '@expo\/vector-icons'/.test(compSrc) && !/Ionicons/.test(compSrc));
check('comp: 하드코딩 hex 색상 0(테마 토큰만)', !/#[0-9a-fA-F]{3,8}/.test(compSrc));
check(
  'comp: 카드 톤 = primaryLight 배경 + primary 보더(코치마크 동일)',
  /backgroundColor: colors\.primaryLight/.test(compSrc) && /borderColor: colors\.primary/.test(compSrc),
);
check('comp: React.memo export', /export const EditionOptInBanner = React\.memo/.test(compSrc));

// 장착부 — BuyEditionView 에디션 뷰 상단(스트립 위) 장착.
check(
  "mount: import EditionOptInBanner",
  /import \{ EditionOptInBanner \} from '@components\/signals\/EditionOptInBanner'/.test(mountSrc),
);
check('mount: <EditionOptInBanner /> 렌더', /<EditionOptInBanner \/>/.test(mountSrc));
{
  const idxBanner = mountSrc.indexOf('<EditionOptInBanner />');
  const idxStrip = mountSrc.indexOf('<EditionDateStrip');
  check('mount: 에디션 뷰 상단(날짜 스트립 위) 장착', idxBanner > -1 && idxStrip > idxBanner);
}

console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail === 0 ? 0 : 1);
