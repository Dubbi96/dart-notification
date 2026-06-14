/**
 * DAR-274 결정론적 검증: 한국어 조사 자동선택 유틸 josa() + 6곳 '을(를)' 폼체 제거.
 *
 * 종전엔 동적 기업명·검색어 뒤에 받침 판별 없이 '을(를)' 폼체를 붙였다
 * (삼성전'자'→'를', 한국전'력'→'을'인데 둘 다 '을(를)'). 상용앱 품질 저하.
 *
 * 해결: utils/josa.ts josa(word, pair) 순수함수가 한글 종성 유무로 자연 조사를
 * 고르고(한글 외는 발음 기준 폴백), snackbarCopy 정본 + 6 호출부가 이를 경유한다.
 *
 * 이 스크립트는 ① josa() 동작(받침 있음/없음/영문·숫자 폴백/으로·로 예외/안전 폴백)과
 * ② 6 호출부 소스에 '을(를)' 리터럴이 0이고 josa/정본 카피를 경유함을 단언한다.
 *
 * 실행: npx tsx scripts/check-josa.ts  (실패 시 exit 1)
 */
import { readFileSync } from 'fs';
import { join } from 'path';

import { josa } from '../utils/josa';

let failed = 0;
function check(label: string, got: unknown, want: unknown): void {
  const ok = got === want;
  if (!ok) failed += 1;
  console.log(
    `${ok ? 'PASS' : 'FAIL'} | ${label} | got=${JSON.stringify(got)} want=${JSON.stringify(want)}`,
  );
}

// ── 1) 을/를 — 받침 유무로 갈림(DoD 핵심) ───────────────────────────────
check('한국전력 → 을(ㄱ 받침)', josa('한국전력', '을/를'), '을');
check('삼성전자 → 를(받침 없음)', josa('삼성전자', '을/를'), '를');
check('카카오 → 를(오, 받침 없음)', josa('카카오', '을/를'), '를');
check('한국 → 을(ㄱ 받침)', josa('한국', '을/를'), '을');
check('현대차 → 를(차, 받침 없음)', josa('현대차', '을/를'), '를');

// ── 2) 다른 조사 쌍도 동일 규칙 ────────────────────────────────────────
check('한국전력 → 이(이/가)', josa('한국전력', '이/가'), '이');
check('삼성전자 → 가(이/가)', josa('삼성전자', '이/가'), '가');
check('한국전력 → 은(은/는)', josa('한국전력', '은/는'), '은');
check('삼성전자 → 는(은/는)', josa('삼성전자', '은/는'), '는');
// 와/과 는 받침있는 형태가 '과' — 정의 규약(받침있을때/받침없을때)대로 '과/와' 순으로 전달
check('한국전력 → 과(과/와)', josa('한국전력', '과/와'), '과');
check('삼성전자 → 와(과/와)', josa('삼성전자', '과/와'), '와');

// ── 3) '으로/로' 예외 — ㄹ 받침은 받침 없음처럼 '로' ──────────────────
check('한국 → 으로(ㄱ 받침)', josa('한국', '으로/로'), '으로');
check('서울 → 로(ㄹ 받침 예외)', josa('서울', '으로/로'), '로');
check('카카오 → 로(받침 없음)', josa('카카오', '으로/로'), '로');

// ── 4) 한글 외 폴백 — 영문 알파벳 끝소리 발음 기준 ─────────────────────
check('SK → 를(K=케이, 받침 없음)', josa('SK', '을/를'), '를'); // DoD 명시
check('LG → 를(G=지, 받침 없음)', josa('LG', '을/를'), '를');
check('XL → 을(L=엘, 받침)', josa('XL', '을/를'), '을');
check('3M → 을(M=엠, 받침)', josa('3M', '을/를'), '을');

// ── 5) 한글 외 폴백 — 숫자 끝소리 발음 기준 ───────────────────────────
check('2 → 를(이, 받침 없음)', josa('2', '을/를'), '를');
check('7 → 을(칠, ㄹ 받침)', josa('7', '을/를'), '을');
check('7 → 로(칠, ㄹ 예외)', josa('7', '으로/로'), '로');

// ── 6) 안전 폴백 — 빈값·판별 불가는 받침 없는 형태(크래시 없음) ───────
check('빈 문자열 → 를', josa('', '을/를'), '를');
check('null → 를', josa(null, '을/를'), '를');
check('undefined → 를', josa(undefined, '을/를'), '를');
check('기호(?) → 를', josa('?', '을/를'), '를');
check('공백 트림 후 판별(한국전력 ) → 을', josa('한국전력 ', '을/를'), '을');

// ── 7) 소스 바인딩 — 6 호출부에 '을(를)' 리터럴 0 + josa/정본 경유 ────
const root = join(__dirname, '..');
function src(rel: string): string {
  return readFileSync(join(root, rel), 'utf8');
}
const FORM_LITERAL = '을(를)';
const SITES = [
  'components/common/snackbarCopy.ts',
  'components/common/SearchOverlay.tsx',
  'components/company/CompanyHubLink.tsx',
  'app/settings-detail/watchlist.tsx',
];
for (const rel of SITES) {
  check(`${rel}: '을(를)' 리터럴 0`, src(rel).includes(FORM_LITERAL), false);
}
// 정본/유틸 경유 바인딩
const snackbar = src('components/common/snackbarCopy.ts');
check('snackbarCopy: josa import', snackbar.includes("from '@utils/josa'"), true);
check('snackbarCopy.watchlistAdded josa 경유', /watchlistAdded:.*josa\(name, '을\/를'\)/.test(snackbar), true);
check('snackbarCopy.watchlistRemoved josa 경유', /watchlistRemoved:.*josa\(name, '을\/를'\)/.test(snackbar), true);

const overlay = src('components/common/SearchOverlay.tsx');
check('SearchOverlay: 정본 watchlistAdded 호출', overlay.includes('snackbarCopy.watchlistAdded(company.corpName)'), true);
check('SearchOverlay: 정본 watchlistRemoved 호출', overlay.includes('snackbarCopy.watchlistRemoved(company.corpName)'), true);
check('SearchOverlay: term josa 경유', overlay.includes("josa(term, '을/를')"), true);

const hub = src('components/company/CompanyHubLink.tsx');
check('CompanyHubLink: 정본 watchlistAdded 호출', hub.includes('snackbarCopy.watchlistAdded(corpName)'), true);

const wl = src('app/settings-detail/watchlist.tsx');
check('watchlist: item.corpName josa 경유', wl.includes("josa(item.corpName, '을/를')"), true);

if (failed > 0) {
  console.error(`\n${failed} check(s) FAILED`);
  process.exit(1);
}
console.log('\nAll checks passed.');
