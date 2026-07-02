/**
 * DAR-456 결정론적 검증: 공시 목록(app/disclosures/index.tsx) 필터 chrome 축약 + 디바운스 훅 통일.
 *
 * 문제(UI/UX 감사 2026-06-27):
 *  - E10: 헤더+검색바+유형 필터행+기간/정렬 필터행+비로그인 배너까지 고정 chrome 이 세로로 누적 →
 *         좁은 기기에서 첫 공시 카드가 화면 하단에서 시작.
 *  - E11: 디바운스를 useState 타이머(setTimeout/handleSearchChange)로 수동 구현 → 키 입력마다
 *         핸들러 재생성·추가 렌더. 타 화면(search/index.tsx)은 공통 useDebounce 훅 사용.
 *
 * 수정(이 파일만):
 *  - E11: 수동 타이머 제거 → 공통 useDebounce 훅으로 파생. onChangeText 는 setSearchQuery 직결.
 *  - E10: 기간·정렬 보조 필터행을 접이 토글(showMoreFilters, 기본 접힘)로 숨겨 고정 chrome 1행 축소.
 *         비로그인 배너는 고정 chrome 에서 빼 FlatList ListHeaderComponent(스크롤 영역)로 이동.
 *
 * 정적 분석으로 시각을 직접 못 보므로 소스 바인딩으로 위 구조 불변식을 고정한다.
 * 실행: node scripts/check-disclosure-filter-chrome.ts  (실패 시 exit 1)
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

let failed = 0;
function check(label: string, got: unknown, want: unknown): void {
  const ok = got === want;
  if (!ok) failed += 1;
  console.log(
    `${ok ? 'PASS' : 'FAIL'} | ${label} | got=${JSON.stringify(got)} want=${JSON.stringify(want)}`,
  );
}

const src = readFileSync(
  join(__dirname, '..', 'app', 'disclosures', 'index.tsx'),
  'utf8',
);

// ───────────────────────────── E11: 디바운스 훅 통일 ─────────────────────────────
// UXR-20/E-8: 지연도 SSOT 상수 SEARCH_DEBOUNCE_MS(useDebounce 모듈)로 통일 — 인라인 300 잔존 금지
// (통합검색·관심기업 검색과 동일 규약, check-search-convention.ts ① 정렬).
check('공통 useDebounce+SEARCH_DEBOUNCE_MS import', /import \{[^}]*\buseDebounce\b[^}]*\bSEARCH_DEBOUNCE_MS\b[^}]*\} from '@hooks\/useDebounce'/.test(src), true);
check('useDebounce(searchQuery, SEARCH_DEBOUNCE_MS) 파생 사용', /useDebounce\(searchQuery,\s*SEARCH_DEBOUNCE_MS\)\.trim\(\)/.test(src), true);
check('인라인 300 디바운스 잔존 없음', /useDebounce\(searchQuery,\s*300\)/.test(src), false);
// 수동 타이머/추가 상태/핸들러 제거 — 음성 대조
check('수동 setTimeout 디바운스 제거', /setTimeout\(\(\)\s*=>\s*setDebouncedQuery/.test(src), false);
check('debouncedQuery useState 제거', /useState[^\n]*\bsetDebouncedQuery\b/.test(src), false);
check('timer useState 제거', /const \[timer, setTimer\]/.test(src), false);
check('handleSearchChange 핸들러 제거', /const handleSearchChange\s*=/.test(src), false);
check('입력은 setSearchQuery 직결(onChangeText)', /onChangeText=\{setSearchQuery\}/.test(src), true);
check('검색어 지우기도 setSearchQuery 직결', /onPress=\{\(\)\s*=>\s*setSearchQuery\(''\)\}/.test(src), true);

// ───────────────────────── E10-a: 보조 필터행 접이 축약 ─────────────────────────
check('접이 상태 showMoreFilters 도입', /const \[showMoreFilters, setShowMoreFilters\] = useState\(false\)/.test(src), true);
check('보조 필터행 접이 게이트 렌더', /\{showMoreFilters && \(/.test(src), true);
// 접이 토글 칩: 접근성 role/expanded + 한국어 라벨
check('토글 칩 accessibilityRole button', /accessibilityState=\{\{ expanded: showMoreFilters \}\}/.test(src), true);
check('토글 칩 펼치기/접기 한국어 라벨', /기간·정렬 필터 \$\{showMoreFilters \? '접기' : '펼치기'\}/.test(src), true);
// 적용된 보조 필터가 있으면 토글 칩에 활성 표시(숨은 필터 신호 보존)
check('적용 신호 moreFiltersApplied 계산', /const moreFiltersApplied = period !== 'all' \|\| \(isSearching && sort !== 'latest'\)/.test(src), true);
check('Feather/Ionicons 토글 아이콘(options) 사용', /name="options-outline"/.test(src), true);

// ───────────────────── E10-b: 비로그인 배너 → 리스트 헤더로 이동 ─────────────────────
check('배너 useMemo(listHeader) 도입', /const listHeader = useMemo\(\(\)\s*=>\s*\{/.test(src), true);
check('인증 시 배너 미렌더(게스트 전용)', /if \(isAuthenticated\) return null;/.test(src), true);
check('FlatList ListHeaderComponent 로 배너 연결', /ListHeaderComponent=\{listHeader\}/.test(src), true);
check('배너 진입점(로그인) 유지', /router\.push\('\/auth\/sign-in'\)/.test(src), true);
check('배너 안내문 한국어 유지', /로그인하고 시작하기/.test(src) && /관심기업 공시만 모아볼 수 있어요/.test(src), true);
// 종전 고정 chrome 배너(검색·필터 아래 고정)가 제거되었는지 음성 대조
check('고정 chrome 위치의 배너 블록 제거', /\{!isAuthenticated && \(\s*<TouchableOpacity\s+style=\{\{ paddingHorizontal: spacing\.lg/.test(src), false);

// ───────────────────────── 회귀: 리스트 안정성·크로스플랫폼 가드 ─────────────────────────
check('keyExtractor rcpNo 자연키 유지', /const keyExtractor = \(item: Disclosure\) => item\.rcpNo/.test(src), true);
check('refreshing/onRefresh props 유지(커스텀 refreshControl 금지)', /refreshing=\{activeQuery\.isRefetching/.test(src) && /onRefresh=\{handleRefresh\}/.test(src), true);
check('refreshControl 커스텀 래퍼 미사용', /refreshControl=/.test(src), false);
check('placeholder 한국어 유지', /placeholder="기업명·보고서명 검색"/.test(src), true);
// 색상은 theme 토큰만 — 인라인 #hex 금지(음성 대조)
check('하드코딩 #hex 색상 없음', /#[0-9a-fA-F]{3,8}\b/.test(src), false);

if (failed > 0) {
  console.error(`\n${failed} check(s) FAILED`);
  process.exit(1);
}
console.log('\nAll checks passed.');
