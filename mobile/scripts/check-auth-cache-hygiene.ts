/**
 * DAR-262 결정론적 검증: 계정 전환 시 이전 유저 서버 캐시 교차 노출 차단.
 * 실행: npx tsx scripts/check-auth-cache-hygiene.ts  (실패 시 exit 1)
 *
 * 배경: 로그아웃(clearAuth)·로그인(setAuth)이 Zustand 만 비우고 React Query 캐시를 두면,
 *   같은 기기에서 계정이 바뀔 때 gcTime(5분) 내 이전 사용자의 [users,me]·[watchlist]·
 *   [positions]·[portfolio,summary]·[saved-disclosures] 등 금융/개인정보가 다음 사용자에게
 *   노출된다. 해결: 인증 주체가 바뀌는 경계(로그인/로그아웃/401·403)에서 purgeServerCache 로
 *   캐시를 전량 제거한다. 단, 토큰 회전(refresh)은 같은 사용자이므로 캐시를 보존한다.
 *
 * 여기서는 실제 QueryClient 를 시드해 (1) 로그아웃 purge 후 전량 제거, (2) 게스트→로그인
 *   purge 후 전량 제거 + 신규 유저 데이터만 잔존, (3) 토큰 회전은 purge 미호출로 캐시 보존,
 *   (4) 빈 캐시 purge 무해(no-op), (5) purge 후 캐시 재사용 가능 을 단정한다.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { QueryClient } from '@tanstack/react-query';

import { purgeServerCache } from '../utils/authCache.ts';

// 이슈에 명시된 민감 키 전부 — 계정 단위 서버 데이터.
const SENSITIVE_KEYS: readonly unknown[][] = [
  ['users', 'me'],
  ['watchlist'],
  ['positions'],
  ['portfolio', 'summary'],
  ['saved-disclosures'],
];

function seedUser(client: QueryClient, label: string): void {
  for (const key of SENSITIVE_KEYS) {
    client.setQueryData(key, { owner: label });
  }
}

function cacheCount(client: QueryClient): number {
  return client.getQueryCache().getAll().length;
}

interface Case {
  name: string;
  got: unknown;
  expected: unknown;
}
const cases: Case[] = [];

// (1) 로그아웃 경로: A 데이터 시드 → purge → 캐시 0.
{
  const client = new QueryClient();
  seedUser(client, 'A');
  const before = cacheCount(client);
  purgeServerCache(client);
  cases.push({ name: '시드 후 캐시 존재', got: before, expected: SENSITIVE_KEYS.length });
  cases.push({ name: '로그아웃 purge → 캐시 전량 제거', got: cacheCount(client), expected: 0 });
  cases.push({
    name: '로그아웃 purge → [users,me] 조회 불가',
    got: client.getQueryData(['users', 'me']),
    expected: undefined,
  });
}

// (2) 게스트→로그인 경로: 게스트(또는 직전 유저 A) 캐시가 있는 채로 B 로그인 → purge 후 B 만.
{
  const client = new QueryClient();
  seedUser(client, 'A'); // 직전 세션 잔여
  purgeServerCache(client); // 로그인 setAuth 직후
  seedUser(client, 'B'); // 신규 세션이 다시 적재
  const meOwner = (client.getQueryData(['users', 'me']) as { owner?: string } | undefined)?.owner;
  cases.push({ name: '로그인 purge 후 신규 유저 데이터만(owner=B)', got: meOwner, expected: 'B' });
  cases.push({
    name: '로그인 purge → 이전 유저 잔여 0(B 적재분만 카운트)',
    got: cacheCount(client),
    expected: SENSITIVE_KEYS.length,
  });
}

// (3) 토큰 회전(refresh): 같은 사용자 → purge 미호출 → 캐시 보존(updateTokens 의 정책).
{
  const client = new QueryClient();
  seedUser(client, 'A');
  // 토큰 회전은 purgeServerCache 를 호출하지 않는다(updateTokens 경로).
  const meOwner = (client.getQueryData(['users', 'me']) as { owner?: string } | undefined)?.owner;
  cases.push({ name: '토큰 회전 → 캐시 보존(owner=A)', got: meOwner, expected: 'A' });
  cases.push({ name: '토큰 회전 → 캐시 카운트 불변', got: cacheCount(client), expected: SENSITIVE_KEYS.length });
}

// (4) 빈 캐시 purge 는 예외 없이 no-op.
{
  const client = new QueryClient();
  let threw = false;
  try {
    purgeServerCache(client);
  } catch {
    threw = true;
  }
  cases.push({ name: '빈 캐시 purge 무예외', got: threw, expected: false });
  cases.push({ name: '빈 캐시 purge 후 카운트 0', got: cacheCount(client), expected: 0 });
}

// (5) purge 후에도 캐시는 정상 동작(재적재 가능).
{
  const client = new QueryClient();
  seedUser(client, 'A');
  purgeServerCache(client);
  client.setQueryData(['users', 'me'], { owner: 'C' });
  const meOwner = (client.getQueryData(['users', 'me']) as { owner?: string } | undefined)?.owner;
  cases.push({ name: 'purge 후 재적재 가능(owner=C)', got: meOwner, expected: 'C' });
}

// ── 정적 배선 가드 ── 위 런타임 테스트는 purge "메커니즘"을 증명한다. 아래는 스토어/훅이
//    실제로 그 메커니즘을 올바른 경계에만 배선했는지(회귀 잠금) 소스에서 단정한다.
const here = dirname(fileURLToPath(import.meta.url));
const read = (rel: string): string => readFileSync(join(here, '..', rel), 'utf8');

const authStoreSrc = read('stores/authStore.ts');
const useAuthSrc = read('hooks/useAuth.ts');
const apiSrc = read('services/api.ts');

// 구현부(인터페이스 선언이 아닌 액션 본문)만 슬라이스. 인터페이스 선언은 타입 주석이 있어
//   `setAuth: (accessToken: string,` 형태라 구별된다(구현은 `setAuth: (accessToken, refreshToken) => {`).
const setAuthBody = authStoreSrc.slice(authStoreSrc.indexOf('setAuth: (accessToken, refreshToken) => {'), authStoreSrc.indexOf('updateTokens: (accessToken, refreshToken) =>'));
const updateTokensBody = authStoreSrc.slice(authStoreSrc.indexOf('updateTokens: (accessToken, refreshToken) =>'), authStoreSrc.indexOf('clearAuth: () => {'));
const clearAuthStart = authStoreSrc.indexOf('clearAuth: () => {');
const clearAuthBody = authStoreSrc.slice(clearAuthStart, authStoreSrc.indexOf('enterGuest: () =>', clearAuthStart));

cases.push({ name: '[wiring] setAuth 가 purgeServerCache 호출', got: setAuthBody.includes('purgeServerCache(queryClient)'), expected: true });
cases.push({ name: '[wiring] clearAuth 가 purgeServerCache 호출', got: clearAuthBody.includes('purgeServerCache(queryClient)'), expected: true });
cases.push({ name: '[wiring] updateTokens(토큰 회전) 는 purge 미호출', got: updateTokensBody.includes('purgeServerCache'), expected: false });

// authStore 에 서버 User 복제본이 없어야 한다(인증 플래그·토큰만).
cases.push({ name: '[wiring] authStore 인터페이스에 user 필드 없음', got: /\buser\s*:/.test(authStoreSrc.slice(authStoreSrc.indexOf('interface AuthState'), authStoreSrc.indexOf('}'))), expected: false });

// useMe queryFn 은 순수 조회(토큰 재기록/복제용 setAuth 호출 없음 — 주석의 'setAuth 로' 언급과 구별 위해 '(' 포함).
cases.push({ name: '[wiring] useMe 가 setAuth() 미호출(순수 조회)', got: useAuthSrc.slice(useAuthSrc.indexOf('export function useMe')).includes('setAuth('), expected: false });

// 토큰 회전 인터셉터는 updateTokens 사용(캐시 보존), setAuth 미사용.
const refreshBody = apiSrc.slice(apiSrc.indexOf('performTokenRefresh'), apiSrc.indexOf('Response interceptor'));
cases.push({ name: '[wiring] performTokenRefresh 가 updateTokens 사용', got: refreshBody.includes('updateTokens('), expected: true });
cases.push({ name: '[wiring] performTokenRefresh 가 setAuth 미사용', got: refreshBody.includes('setAuth('), expected: false });

let failed = 0;
for (const c of cases) {
  const ok = JSON.stringify(c.got) === JSON.stringify(c.expected);
  if (!ok) failed += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${c.name}  (got=${JSON.stringify(c.got)}, expected=${JSON.stringify(c.expected)})`);
}
console.log(`\n${cases.length - failed}/${cases.length} passed`);
if (failed > 0) process.exit(1);
