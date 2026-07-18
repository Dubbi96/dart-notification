/**
 * DAR-43 §1 결정론적 검증: isConnectionError 가 연결 실패(네트워크/타임아웃)와
 * 서버 도달 후 에러(4xx/5xx)·비-axios 에러를 정확히 분기하는지 확인한다.
 * 실행: node scripts/check-connection-error.ts  (실패 시 exit 1)
 *
 * 잘못된 API_BASE_URL 로 호출하면 axios 가 ERR_NETWORK/ECONNABORTED/response 없음 에러를 던지고,
 * 이때 isConnectionError === true → 화면이 "일시적으로 연결할 수 없어요" 안내(ApiErrorState)를 렌더한다(크래시 없음).
 */
import { AxiosError } from 'axios';
import { isConnectionError } from '../services/connectionError.ts';

interface Case {
  name: string;
  error: unknown;
  expected: boolean;
}

function axiosErr(opts: { code?: string; message?: string; hasResponse?: boolean }): AxiosError {
  const e = new AxiosError(opts.message ?? 'err', opts.code);
  if (opts.hasResponse) {
    // 서버 도달 O — 상태코드 응답 존재.
    e.response = { status: 404, statusText: 'Not Found', data: {}, headers: {}, config: {} as never };
  }
  return e;
}

const cases: Case[] = [
  { name: 'timeout(ECONNABORTED)', error: axiosErr({ code: 'ECONNABORTED', message: 'timeout of 10000ms exceeded' }), expected: true },
  { name: 'network fail(ERR_NETWORK)', error: axiosErr({ code: 'ERR_NETWORK', message: 'Network Error' }), expected: true },
  { name: 'no response (서버 미도달)', error: axiosErr({ message: 'connect ECONNREFUSED' }), expected: true },
  { name: '"Network Error" 메시지', error: axiosErr({ message: 'Network Error' }), expected: true },
  { name: '서버 도달 후 404', error: axiosErr({ code: 'ERR_BAD_REQUEST', hasResponse: true }), expected: false },
  { name: '비-axios 에러', error: new Error('boom'), expected: false },
  { name: 'null', error: null, expected: false },
];

let failed = 0;
for (const c of cases) {
  const got = isConnectionError(c.error);
  const ok = got === c.expected;
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${c.name} → ${got} (expected ${c.expected})`);
}

if (failed > 0) {
  console.error(`\n${failed} case(s) failed`);
  process.exit(1);
}
console.log(`\nAll ${cases.length} cases passed`);
