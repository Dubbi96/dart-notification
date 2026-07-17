/**
 * DAR-537 deterministic check — 관심종목 콜드스타트 온보딩(코치마크 승격형).
 *
 * 두 축으로 입증한다.
 *  (A) 동작 모델:
 *      - useColdStartOnboarding 의 SecureStore 단일키 상태머신(로딩 미노출→미해제 노출→해제 영속)과
 *        firstWatch 키와의 저장소 독립(건너뛰기 시 기존 코치마크 규약 유지 — 수용기준 2).
 *      - 홈 노출 결정 로직 재현: 어떤 상태 조합에서도 온보딩 카드와 코치마크가 동시에
 *        노출되지 않고(중복 유도 금지), 관심 ≥1 이면 어떤 유도도 없다.
 *      - 추천 도출 SSOT(utils/coldStartSuggestions)를 직접 import: 빈도 상위·중복 제거·상한.
 *  (B) 소스 바인딩(readFileSync):
 *      - 훅 단일키('coldStartOnboardingDismissed')가 기존 두 코치마크 키와 상이.
 *      - 홈 장착부: 관심 0 + 미해제 → 카드 / 관심 0 + 해제 → 기존 코치마크(상호배제 ternary 없이
 *        동일 게이트의 명시적 조건 2개), FirstWatchCoachmark 규약 파일 불변.
 *      - 카드: 건너뛰기 a11y·직접 검색 연결·비강요 카피·테마 토큰만·ScrollView 금지·
 *        React Query 훅 경유 쓰기(allSettled+오프라인 센티넬)·칩 폰트 캡·44pt 터치.
 *
 * Run: npx tsx scripts/check-coldstart-onboarding.ts
 */
import { readFileSync } from 'fs';
import { join } from 'path';

import {
  COLD_START_RECOMMEND_MIN,
  COLD_START_RECOMMEND_MAX,
  COLD_START_POPULAR_CAP,
  COLD_START_TOTAL_CAP,
  deriveActiveCompanies,
  mergeSuggestions,
} from '../utils/coldStartSuggestions';

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

// ---------- (A-1) 훅 상태머신 + 키 독립 ----------
// 훅과 동일 구조: null=로딩 / false=노출 가능 / true=숨김. 저장값은 'true' 문자열 단일키.
function createDismissState(store: Map<string, string>, key: string, opts?: { persistFails?: boolean }) {
  let dismissed: boolean | null = null;
  return {
    load() {
      dismissed = store.get(key) === 'true';
    },
    dismiss() {
      dismissed = true;
      if (!opts?.persistFails) store.set(key, 'true');
    },
    get value() {
      return dismissed;
    },
  };
}

const COLD_KEY = 'coldStartOnboardingDismissed';
const FIRST_KEY = 'firstWatchCoachDismissed';

{
  const store = new Map<string, string>();
  const cold = createDismissState(store, COLD_KEY);
  check('model: 로딩(null) 동안 카드 미노출', cold.value === null);
  cold.load();
  check('model: 저장값 없으면 첫 진입 노출 가능(false)', cold.value === false);
  cold.dismiss();
  check('model: 건너뛰기 즉시 숨김 + 영속화', cold.value === true && store.get(COLD_KEY) === 'true');

  const next = createDismissState(store, COLD_KEY);
  next.load();
  check('model: 다음 세션에도 재노출 없음(1회성)', next.value === true);

  // 키 독립 — 콜드스타트 해제가 기존 코치마크 키에 전파되지 않음(수용기준 2의 저장소 축).
  check('model: firstWatch 키 불변(건너뛰기 시 기존 코치마크 규약 유지)', store.get(FIRST_KEY) === undefined);
  const first = createDismissState(store, FIRST_KEY);
  first.load();
  check('model: 건너뛰기 후 기존 코치마크는 자기 규약대로 노출 가능', first.value === false);

  const flaky = createDismissState(new Map(), COLD_KEY, { persistFails: true });
  flaky.load();
  flaky.dismiss();
  check('model: 영속화 실패에도 이번 세션 노출 차단(비차단 폴백)', flaky.value === true);
}

// ---------- (A-2) 홈 노출 결정 — 상호배제 ----------
// home/index.tsx 의 게이트 재현: 카드 = auth·관심0·coldStart===false / 코치마크 = auth·관심0·coldStart===true.
function homePrompt(
  isAuthenticated: boolean,
  watchlistCount: number,
  coldStartDismissed: boolean | null,
): 'coldstart' | 'coachmark' | 'none' {
  if (isAuthenticated && watchlistCount === 0 && coldStartDismissed === false) return 'coldstart';
  if (isAuthenticated && watchlistCount === 0 && coldStartDismissed === true) return 'coachmark';
  return 'none';
}

{
  const states: Array<boolean | null> = [null, false, true];
  let exclusive = true;
  for (const auth of [true, false]) {
    for (const count of [0, 1, 5]) {
      for (const dismissed of states) {
        const results = [
          homePrompt(auth, count, dismissed) === 'coldstart',
          homePrompt(auth, count, dismissed) === 'coachmark',
        ];
        if (results[0] && results[1]) exclusive = false;
      }
    }
  }
  check('model: 어떤 상태에서도 카드·코치마크 동시 노출 불가(중복 유도 금지)', exclusive);
  check('model: 관심 0·미해제 → 온보딩 카드', homePrompt(true, 0, false) === 'coldstart');
  check('model: 관심 0·건너뛰기 후 → 기존 코치마크 폴백', homePrompt(true, 0, true) === 'coachmark');
  check('model: 로딩(null) 동안 어느 유도도 없음(플래시 방지)', homePrompt(true, 0, null) === 'none');
  check('model: 관심 ≥1 이면 유도 없음', homePrompt(true, 3, false) === 'none');
  check('model: 게스트에겐 미노출(1회성 소모 방지)', homePrompt(false, 0, false) === 'none');
}

// ---------- (A-3) 추천 도출 SSOT ----------
{
  const feed = [
    { corpCode: 'B', corpName: '비' },
    { corpCode: 'A', corpName: '에이' },
    { corpCode: 'B', corpName: '비' },
  ];
  const active = deriveActiveCompanies(feed, 2);
  check(
    'model: 활발 종목 = corpCode 빈도 상위(동률은 최신 공시 순)',
    active.length === 2 && active[0].corpCode === 'B' && active[1].corpCode === 'A',
  );

  const merged = mergeSuggestions(
    [{ corpCode: 'P1', corpName: '인기' }],
    [
      { corpCode: 'P1', corpName: '인기' }, // 중복
      { corpCode: 'A1', corpName: '활발' },
    ],
  );
  check(
    'model: 인기·활발 병합은 corpCode 중복 제거(칩 1회)',
    merged.length === 2 && merged.filter((s) => s.corpCode === 'P1').length === 1,
  );
  check(
    'model: 추천 유도 구간 3~5개 · 인기 상한 < 전체 상한',
    COLD_START_RECOMMEND_MIN === 3 &&
      COLD_START_RECOMMEND_MAX === 5 &&
      COLD_START_POPULAR_CAP < COLD_START_TOTAL_CAP,
  );
  const many = Array.from({ length: 30 }, (_, i) => ({ corpCode: `C${i}`, corpName: `기업${i}` }));
  check('model: 전체 상한 초과 불가', mergeSuggestions(many, many).length <= COLD_START_TOTAL_CAP);
}

// ---------- (B) 소스 바인딩 ----------
const root = join(__dirname, '..');
const hookSrc = readFileSync(join(root, 'hooks/useColdStartOnboarding.ts'), 'utf8');
const firstHookSrc = readFileSync(join(root, 'hooks/useFirstWatchCoachmark.ts'), 'utf8');
const cardSrc = readFileSync(join(root, 'components/home/ColdStartOnboarding.tsx'), 'utf8');
const coachSrc = readFileSync(join(root, 'components/home/FirstWatchCoachmark.tsx'), 'utf8');
const homeSrc = readFileSync(join(root, 'app/(tabs)/home/index.tsx'), 'utf8');
const utilSrc = readFileSync(join(root, 'utils/coldStartSuggestions.ts'), 'utf8');

// 훅 — 단일키·독립키·SecureStore.
check("hook: expo-secure-store 단일키 'coldStartOnboardingDismissed'", /expo-secure-store/.test(hookSrc) && new RegExp(`'${COLD_KEY}'`).test(hookSrc));
check(
  'hook: 기존 두 코치마크 키와 상이(독립 저장소)',
  /const KEY = 'coldStartOnboardingDismissed'/.test(hookSrc) &&
    !/const KEY = '(firstWatchCoachDismissed|signalsCoachDismissed)'/.test(hookSrc),
);
check("hook: 기존 코치마크 훅 규약 불변('firstWatchCoachDismissed' 유지)", new RegExp(`'${FIRST_KEY}'`).test(firstHookSrc));
check('coach: FirstWatchCoachmark 자체 노출 규약 불변(dismissed !== false → null)', /dismissed !== false\) return null/.test(coachSrc));

// 홈 장착부 — 상호배제 게이트 2개 + import + 활발 종목 도출.
check("mount: import ColdStartOnboarding", /import \{ ColdStartOnboarding \} from '@components\/home\/ColdStartOnboarding'/.test(homeSrc));
check(
  'mount: 카드 게이트 = 인증·관심 0·coldStart 미해제(false)',
  /isAuthenticated && watchlistCount === 0 && coldStart\.dismissed === false && \(\s*<ColdStartOnboarding/.test(homeSrc),
);
check(
  'mount: 코치마크 게이트 = 인증·관심 0·coldStart 해제(true) — 건너뛰기 후에만 폴백',
  /isAuthenticated && watchlistCount === 0 && coldStart\.dismissed === true && \(\s*<FirstWatchCoachmark/.test(homeSrc),
);
check('mount: 건너뛰기·등록완료 모두 해제 처리(onSkip/onComplete → dismiss)', /onSkip=\{coldStart\.dismiss\}/.test(homeSrc) && /onComplete=\{coldStart\.dismiss\}/.test(homeSrc));
check("mount: 활발 종목은 로드된 피드에서 도출(deriveActiveCompanies(disclosures))", /deriveActiveCompanies\(disclosures\)/.test(homeSrc));
check('mount: listHeader useMemo deps 에 coldStart 상태 포함(파생 헤더 stale 방지)', /coldStart\.dismissed,/.test(homeSrc) && /activeCompanies,/.test(homeSrc));
check('mount: 검색 연결 주입(onSearch=handleSearchOpen)', /onSearch=\{handleSearchOpen\}/.test(homeSrc));

// 카드 — RN 규율·a11y·비강요·오프라인 규약.
check('card: ScrollView 미사용', !/ScrollView/.test(cardSrc));
check('card: 하드코딩 hex 색상 0(테마 토큰만)', !/#[0-9a-fA-F]{3,8}/.test(cardSrc));
check('card: 쓰기는 React Query 훅 경유(useAddToWatchlist) — 직접 fetch/axios 금지', /useAddToWatchlist\(\)/.test(cardSrc) && !/axios|fetch\(/.test(cardSrc));
check('card: allSettled 개별 실패 수집 + 오프라인 센티넬 구분(DAR-226)', /Promise\.allSettled/.test(cardSrc) && /isOfflineMutationBlockedError/.test(cardSrc));
check("card: 건너뛰기 a11y('온보딩 건너뛰기' + role button)", /accessibilityLabel="온보딩 건너뛰기"/.test(cardSrc));
check("card: 검색 연결('기업 직접 검색' → onSearch)", /accessibilityLabel="기업 직접 검색"/.test(cardSrc) && /onPress=\{onSearch\}/.test(cardSrc));
check('card: 비강요 카피(지금 선택하지 않아도 언제든 추가)', /지금 선택하지 않아도 언제든 추가할 수 있어요/.test(cardSrc));
check('card: 추천 3~5개 카피는 SSOT 보간(COLD_START_RECOMMEND_MIN/MAX)', /\{COLD_START_RECOMMEND_MIN\}~\{COLD_START_RECOMMEND_MAX\}개/.test(cardSrc));
check('card: 칩 라벨 폰트 캡(MAX_CHIP_FONT_SCALE) + 한 줄 보장', /maxFontSizeMultiplier=\{MAX_CHIP_FONT_SCALE\}/.test(cardSrc) && /numberOfLines=\{1\}/.test(cardSrc));
check('card: 칩·CTA·검색 링크 44pt 터치(minTouchTarget)', (cardSrc.match(/minHeight: sizing\.minTouchTarget/g) ?? []).length >= 3);
check('card: 칩 선택 상태 a11y(accessibilityState selected)', /accessibilityState=\{\{ selected: isSelected \}\}/.test(cardSrc));
check('card: 추천 빈 풀 폴백(검색 경로 안내 — 온보딩 비차단)', /추천 종목을 불러오지 못했어요/.test(cardSrc));

// 유틸 — 순수 로직(SSOT) RN 무의존.
check(
  'util: coldStartSuggestions 는 RN 무의존 순수 로직(import 0)',
  !/from '(react-native|expo|@expo)/.test(utilSrc) && !/\bimport\b.*from/.test(utilSrc),
);
check('util: 카드가 SSOT(mergeSuggestions)를 import', /from '@utils\/coldStartSuggestions'/.test(cardSrc));

console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail === 0 ? 0 : 1);
