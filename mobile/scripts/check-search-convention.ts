/**
 * DAR-457 결정론적 검증: 통합검색(app/search/index.tsx)과 관심기업 검색
 * (components/common/SearchOverlay.tsx)의 placeholder·빈상태·디바운스 규약 통일(E12).
 *
 * 문제(감사 E12): 두 검색이 placeholder("기업명·종목코드·공시명" vs "종목명 또는 종목코드"),
 * 빈상태(공통 EmptyState vs 손수 만든 View), 에러(공통 ApiErrorState vs 손수 만든 wifi-off+재시도)로
 * 제각각이라 "어느 검색이 무엇을 찾는지" 예측이 어렵고 멘탈모델이 파편화됐다.
 *
 * 공통 규약(이 PR):
 *  ① 디바운스: 두 화면 모두 useDebounce(query, SEARCH_DEBOUNCE_MS=300) — 동일 지연.
 *  ② placeholder: "<검색대상 ·로 나열> 검색" 형식 + 공유 토큰(종목코드). 통합은 공시명 포함(공시도 검색),
 *     관심기업은 공시명 제외(기업만) → 카피만 봐도 무엇을 찾는지 예측 가능.
 *  ③ 빈상태(결과 없음): 공통 EmptyState(icon="search", 동일 제목) 1종.
 *  ④ 에러: 공통 ApiErrorState(연결/일반 에러 분기·재시도) 1종.
 *
 * 정적 분석으로 화면을 직접 못 보므로 소스 바인딩으로 위 규약 불변식을 고정한다.
 * 실행: npx tsx scripts/check-search-convention.ts  (실패 시 exit 1)
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

const unified = readFileSync(join(__dirname, '..', 'app', 'search', 'index.tsx'), 'utf8');
const overlay = readFileSync(join(__dirname, '..', 'components', 'common', 'SearchOverlay.tsx'), 'utf8');
const debounceHook = readFileSync(join(__dirname, '..', 'hooks', 'useDebounce.ts'), 'utf8');

// ── ① 디바운스 규약 통일 ─────────────────────────────────────────────
// DAR-472: 두 화면에 복제돼 있던 `const SEARCH_DEBOUNCE_MS = 300` 을 useDebounce 모듈의 단일
// export 로 통일(SSOT) → 두 화면은 import 만 한다. 매직넘버/로컬 재정의 잔존 금지.
check('공통 모듈: SEARCH_DEBOUNCE_MS=300 단일 정의(useDebounce)', /export const SEARCH_DEBOUNCE_MS = 300;/.test(debounceHook), true);
check('통합검색: 공통 SEARCH_DEBOUNCE_MS import', /import \{[^}]*\bSEARCH_DEBOUNCE_MS\b[^}]*\} from '@hooks\/useDebounce'/.test(unified), true);
check('관심기업: 공통 SEARCH_DEBOUNCE_MS import', /import \{[^}]*\bSEARCH_DEBOUNCE_MS\b[^}]*\} from '@hooks\/useDebounce'/.test(overlay), true);
check('통합검색: 로컬 SEARCH_DEBOUNCE_MS 재정의 없음', /const SEARCH_DEBOUNCE_MS = 300;/.test(unified), false);
check('관심기업: 로컬 SEARCH_DEBOUNCE_MS 재정의 없음', /const SEARCH_DEBOUNCE_MS = 300;/.test(overlay), false);
check('통합검색: useDebounce가 공통 상수 사용', /useDebounce\(query, SEARCH_DEBOUNCE_MS\)/.test(unified), true);
check('관심기업: useDebounce가 공통 상수 사용', /useDebounce\(query, SEARCH_DEBOUNCE_MS\)/.test(overlay), true);
check('두 화면 디바운스 지연 동일(매직넘버 잔존 없음)', /useDebounce\(query, 300\)/.test(unified) || /useDebounce\(query, 300\)/.test(overlay), false);

// ── ② placeholder 규약 통일 ──────────────────────────────────────────
check('통합검색 placeholder = "기업명·종목코드·공시명 검색"', /placeholder="기업명·종목코드·공시명 검색"/.test(unified), true);
check('관심기업 placeholder = "기업명·종목코드 검색"', /placeholder="기업명·종목코드 검색"/.test(overlay), true);
// 형식 규약: ·로 나열 + "검색" 접미사 + 공유 토큰(종목코드)
for (const [name, ph] of [
  ['통합검색', '기업명·종목코드·공시명 검색'],
  ['관심기업', '기업명·종목코드 검색'],
] as const) {
  check(`${name} placeholder가 "검색" 접미사`, ph.endsWith(' 검색'), true);
  check(`${name} placeholder가 · 구분자 사용`, ph.includes('·'), true);
  check(`${name} placeholder가 공유 토큰 "종목코드" 포함`, ph.includes('종목코드'), true);
}
// 예측 가능성: 통합만 공시명 검색 → placeholder에 공시명 포함, 관심기업은 미포함
check('통합검색 placeholder에 공시명 포함(공시 검색 가능 명시)', /placeholder="[^"]*공시명[^"]*"/.test(unified), true);
check('관심기업 placeholder에 공시명 미포함(기업만 검색 명시)', /placeholder="[^"]*공시명[^"]*"/.test(overlay), false);
// 종전 분기 카피("종목명 또는 종목코드") 제거 확인
check('관심기업: 종전 "종목명 또는 종목코드" 카피 제거', /종목명 또는 종목코드/.test(overlay), false);

// ── ③ 빈상태(결과 없음) — 공통 EmptyState 1종 ────────────────────────
check('통합검색: 공통 EmptyState import', /import \{[^}]*\bEmptyState\b[^}]*\} from '@components\/common\/StateView'/.test(unified), true);
check('관심기업: 공통 EmptyState import', /import \{[^}]*\bEmptyState\b[^}]*\} from '@components\/common\/StateView'/.test(overlay), true);
check('통합검색: 결과없음 EmptyState 제목 일치', /title="검색 결과가 없습니다"/.test(unified), true);
check('관심기업: 결과없음 EmptyState 제목 일치', /title="검색 결과가 없습니다"/.test(overlay), true);
check('통합검색: 결과없음 EmptyState icon="search"', /icon="search"/.test(unified), true);
check('관심기업: 결과없음 EmptyState icon="search"', /icon="search"/.test(overlay), true);
// 관심기업: 종전 손수 만든 결과없음 View(josa 카피) 제거
check('관심기업: 종전 josa 빈상태 카피 제거', /josa/.test(overlay), false);

// ── ④ 에러 — 공통 ApiErrorState 1종 ─────────────────────────────────
check('통합검색: 공통 ApiErrorState import', /import \{[^}]*\bApiErrorState\b[^}]*\} from '@components\/common\/StateView'/.test(unified), true);
check('관심기업: 공통 ApiErrorState import', /import \{[^}]*\bApiErrorState\b[^}]*\} from '@components\/common\/StateView'/.test(overlay), true);
check('통합검색: 에러 시 ApiErrorState 렌더', /<ApiErrorState\b/.test(unified), true);
check('관심기업: 에러 시 ApiErrorState 렌더', /<ApiErrorState error=\{error\} onRetry=\{\(\) => refetch\(\)\} \/>/.test(overlay), true);
// 관심기업: 종전 손수 만든 wifi-off + "재시도" 버튼 제거
check('관심기업: 종전 "검색에 실패했습니다" 손수 카피 제거', /검색에 실패했습니다/.test(overlay), false);
check('관심기업: 종전 손수 "재시도" 버튼 제거', /재시도<\/Text>/.test(overlay), false);
check('관심기업: 종전 retryBtn 스타일 제거', /retryBtn:/.test(overlay), false);

// ── 회귀: 로딩(E17 별도 이슈 소관)·브라우즈(최근/인기)는 보존 ───────────
check('관심기업: 로딩 스피너(ActivityIndicator) 유지(E17 스코프 외)', /<ActivityIndicator\b/.test(overlay), true);
check('관심기업: 최근 검색 브라우즈 유지', /최근 검색/.test(overlay), true);
check('관심기업: 인기 종목 브라우즈 유지', /인기 종목/.test(overlay), true);
// 회귀: 리스트 안정성(커스텀 refreshControl 금지 가드)
check('관심기업: keyExtractor corpCode 유지', /keyExtractor=\{\(item\) => item\.corpCode\}/.test(overlay), true);
check('통합검색: keyExtractor key 유지', /keyExtractor=\{\(item\) => item\.key\}/.test(unified), true);

if (failed > 0) {
  console.error(`\n${failed} check(s) FAILED`);
  process.exit(1);
}
console.log('\nAll checks passed.');
