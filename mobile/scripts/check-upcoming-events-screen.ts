/**
 * DAR-541 결정론적 검증: 예정 이벤트 캘린더 전체 화면(app/upcoming-events/index.tsx)과
 * 홈 섹션의 '전체 보기' 진입·공유 행(UpcomingEventRow) 단일 정의를 정적 소스 바인딩으로 증명한다.
 *
 * 판정 축:
 *  (A) 전체 화면: ScreenHeader('예정 이벤트')·전체 목록 FlatList(자르지 않음)·로딩/에러/빈 상태·
 *      정직 빈 카피(발명 금지)·게스트 로그인 유도·근거 공시 딥링크(공유 행)·테마 토큰만·
 *      크로스플랫폼 가드(커스텀 refreshControl 금지·keyExtractor 고유).
 *  (B) 발견성: 라우트가 _layout 에 등록되고, 홈 섹션 헤딩이 라우트 SSOT 상수로 '전체 보기' 진입.
 *  (C) 공유 행 SSOT: UpcomingEventRow 단일 정의(홈 섹션·전체 화면 공용)·D-day 칩/임박 강조·
 *      dDay 재계산 금지(서버 값 그대로)·행 자체 딥링크.
 *
 * 실행: npx tsx scripts/check-upcoming-events-screen.ts  (실패 시 exit 1)
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(__dirname, '..');
const read = (...p: string[]) => readFileSync(join(root, ...p), 'utf8');

let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean) {
  if (cond) {
    pass++;
    console.log(`  ok  ${name}`);
  } else {
    fail++;
    console.error(`FAIL  ${name}`);
  }
}

// ───────── (A) 전체 화면 ─────────
const screen = read('app', 'upcoming-events', 'index.tsx');
ok('(A) ScreenHeader 로 제목 "예정 이벤트" 표기', /<ScreenHeader\b[\s\S]*?title="예정 이벤트"/.test(screen));
ok('(A) 뒤로가기 onBack={() => router.back()}', /onBack=\{\(\)\s*=>\s*router\.back\(\)\}/.test(screen));
ok('(A) 전체 목록 FlatList 렌더(잘림 없음 — data={items})', /<FlatList\b[\s\S]*?data=\{items\}/.test(screen));
ok('(A) .slice( 로 목록을 자르지 않음(홈 섹션과 달리 전체 표시)', !/items\.slice\(/.test(screen));
ok('(A) 로딩 스켈레톤(SkeletonList)', /<SkeletonList\b/.test(screen) && /isLoading/.test(screen));
ok('(A) 에러 상태 ApiErrorState + 재시도(onRetry refetch)', /<ApiErrorState\b[\s\S]*?onRetry=\{\(\)\s*=>\s*refetch\(\)\}/.test(screen));
ok('(A) 빈 상태 정직 카피 키(upcomingEventsEmpty) 사용', /emptyStateCopy\.upcomingEventsEmpty/.test(screen));
ok('(A) 게스트 로그인 유도(upcomingEventsGuest + /auth/sign-in)', /emptyStateCopy\.upcomingEventsGuest/.test(screen) && /router\.push\('\/auth\/sign-in'\)/.test(screen));
ok('(A) 근거 공시 딥링크는 공유 행(UpcomingEventRow) 경유', /<UpcomingEventRow\b/.test(screen));
ok('(A) 커스텀 refreshControl prop 금지(코어 refreshing/onRefresh 만)', !/refreshControl=/.test(screen) && /refreshing=\{isRefetching\}/.test(screen) && /onRefresh=\{\(\)\s*=>\s*refetch\(\)\}/.test(screen));
ok('(A) keyExtractor 고유키(rcpNo|kind|date 조합)', /const keyExtractor = \(item: UpcomingEventItem\)\s*=>\s*`\$\{item\.rcpNo\}\|\$\{item\.kind\}\|\$\{item\.date\}`/.test(screen));
ok('(A) #hex/rgba 직접 색상 미사용(테마 토큰만)', !/rgba\(/.test(screen) && !/['"]#[0-9A-Fa-f]{3,8}['"]/.test(screen));

// ───────── (B) 발견성(라우트 등록 + 홈 진입) ─────────
const layout = read('app', '_layout.tsx');
ok('(B) _layout 에 upcoming-events/index 라우트 등록', /<Stack\.Screen name="upcoming-events\/index"/.test(layout));

const routeSsot = read('components', 'upcomingEvents', 'route.ts');
ok('(B) 라우트 SSOT 상수 정의(UPCOMING_EVENTS_ROUTE=/upcoming-events)', /export const UPCOMING_EVENTS_ROUTE = '\/upcoming-events'/.test(routeSsot));

const section = read('components', 'home', 'UpcomingEventsSection.tsx');
ok('(B) 홈 섹션: 라우트 SSOT import', /import \{ UPCOMING_EVENTS_ROUTE \} from '@components\/upcomingEvents\/route'/.test(section));
ok('(B) 홈 섹션: 헤딩 "전체 보기" → router.push(SSOT)', /전체 보기/.test(section) && /router\.push\(UPCOMING_EVENTS_ROUTE\)/.test(section));
ok('(B) 홈 섹션: 진입 접근성 라벨', /accessibilityLabel="예정 이벤트 전체 보기"/.test(section));
ok('(B) 홈 섹션: 공유 행(UpcomingEventRow) 사용(로컬 행 재정의 제거)', /import \{ UpcomingEventRow \} from '@components\/upcomingEvents\/UpcomingEventRow'/.test(section) && !/function UpcomingEventRow\(/.test(section));

// ───────── (C) 공유 행 SSOT ─────────
const row = read('components', 'upcomingEvents', 'UpcomingEventRow.tsx');
ok('(C) 행: 근거 공시 딥링크 router.push(/disclosure/:rcpNo)', /router\.push\(`\/disclosure\/\$\{item\.rcpNo\}`\)/.test(row));
ok('(C) 행: D-day 칩(formatDday) + 임박 강조(isImminentDday→warning)', /formatDday\(item\.dDay\)/.test(row) && /isImminentDday\(item\.dDay\)/.test(row) && /colors\.warning/.test(row));
ok('(C) 행: dDay 재계산 금지(서버 값 그대로 — diffDays/Date 없음)', !/new Date\(/.test(row) && !/diffDays/.test(row));
ok('(C) 행: a11y 라벨(오늘/임박 자연어 ddayA11yLabel)', /ddayA11yLabel\(item\.dDay\)/.test(row));
ok('(C) 행: 큰 글꼴 캡(maxFontSizeMultiplier)', /maxFontSizeMultiplier=\{MAX_CHIP_FONT_SCALE\}/.test(row));
ok('(C) 행: #hex/rgba 직접 색상 미사용', !/rgba\(/.test(row) && !/['"]#[0-9A-Fa-f]{3,8}['"]/.test(row));

// ───────── 정직 빈 카피 SSOT ─────────
const copy = read('components', 'common', 'emptyStateCopy.ts');
ok('(공통) upcomingEventsEmpty 정직 카피(없음 — 발명 금지)', /upcomingEventsEmpty:\s*\{[\s\S]*?title:\s*'예정된 이벤트가 없어요'/.test(copy));
ok('(공통) upcomingEventsGuest 로그인 유도 카피', /upcomingEventsGuest:\s*\{[\s\S]*?actionLabel:\s*'로그인'/.test(copy));

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
