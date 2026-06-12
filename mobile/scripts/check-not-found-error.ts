/**
 * DAR-187 결정론적 검증: isNotFoundError 가 "진짜 미존재(서버 404)"를
 * 네트워크/타임아웃/5xx·비-axios 에러와 정확히 분기하는지 확인한다.
 * 추가로, 기업 상세 루트 화면의 에러 라우팅(스켈레톤/재시도/미존재) 결정 진리표를 검증한다.
 * 실행: node scripts/check-not-found-error.ts  (실패 시 exit 1)
 *
 * 버그(수정 전): if(!company) 가 네트워크 에러와 404 를 한 분기로 합쳐 "기업 정보 없음"만 표시,
 * 재시도 버튼 없음. 수정 후: 네트워크/5xx → ApiErrorState(재시도), 404 → not-found 문구 유지.
 */
import { AxiosError } from 'axios';
import { isNotFoundError } from '../services/connectionError.ts';

interface Case {
  name: string;
  error: unknown;
  expected: boolean;
}

function axiosErr(opts: { code?: string; message?: string; status?: number }): AxiosError {
  const e = new AxiosError(opts.message ?? 'err', opts.code);
  if (opts.status != null) {
    e.response = {
      status: opts.status,
      statusText: '',
      data: {},
      headers: {},
      config: {} as never,
    };
  }
  return e;
}

const notFoundCases: Case[] = [
  { name: '서버 404(진짜 미존재)', error: axiosErr({ code: 'ERR_BAD_REQUEST', status: 404 }), expected: true },
  { name: '서버 500(일시적 실패)', error: axiosErr({ status: 500 }), expected: false },
  { name: '서버 401(인증)', error: axiosErr({ status: 401 }), expected: false },
  { name: 'no response(네트워크 실패)', error: axiosErr({ code: 'ERR_NETWORK', message: 'Network Error' }), expected: false },
  { name: 'timeout(ECONNABORTED)', error: axiosErr({ code: 'ECONNABORTED' }), expected: false },
  { name: '비-axios 에러', error: new Error('boom'), expected: false },
  { name: 'null', error: null, expected: false },
];

// 화면 렌더 결정: 'skeleton' | 'retry' | 'notFound' | 'content'
// 수정된 [corpCode].tsx 의 early-return 순서를 순수 함수로 재현한다.
function routeRender(input: {
  isLoading: boolean;
  isError: boolean;
  error: unknown;
  company: unknown;
}): 'skeleton' | 'retry' | 'notFound' | 'content' {
  if (input.isLoading) return 'skeleton';
  if (input.isError && !isNotFoundError(input.error)) return 'retry';
  if (!input.company) return 'notFound';
  return 'content';
}

interface RouteCase {
  name: string;
  input: Parameters<typeof routeRender>[0];
  expected: ReturnType<typeof routeRender>;
}

const company = { corpCode: '00126380', corpName: '삼성전자' };
const routeCases: RouteCase[] = [
  { name: '로딩 중', input: { isLoading: true, isError: false, error: null, company: undefined }, expected: 'skeleton' },
  {
    name: '네트워크 실패 → 재시도',
    input: { isLoading: false, isError: true, error: axiosErr({ code: 'ERR_NETWORK' }), company: undefined },
    expected: 'retry',
  },
  {
    name: '서버 500 → 재시도',
    input: { isLoading: false, isError: true, error: axiosErr({ status: 500 }), company: undefined },
    expected: 'retry',
  },
  {
    name: '서버 404 → 미존재 유지',
    input: { isLoading: false, isError: true, error: axiosErr({ status: 404 }), company: undefined },
    expected: 'notFound',
  },
  {
    name: '200+빈데이터 → 미존재',
    input: { isLoading: false, isError: false, error: null, company: undefined },
    expected: 'notFound',
  },
  {
    name: '정상 데이터 → 콘텐츠',
    input: { isLoading: false, isError: false, error: null, company },
    expected: 'content',
  },
];

let failed = 0;

console.log('— isNotFoundError —');
for (const c of notFoundCases) {
  const got = isNotFoundError(c.error);
  const ok = got === c.expected;
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${c.name} → ${got} (expected ${c.expected})`);
}

console.log('\n— routeRender 진리표 —');
for (const c of routeCases) {
  const got = routeRender(c.input);
  const ok = got === c.expected;
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${c.name} → ${got} (expected ${c.expected})`);
}

const total = notFoundCases.length + routeCases.length;
if (failed > 0) {
  console.error(`\n${failed}/${total} case(s) failed`);
  process.exit(1);
}
console.log(`\nAll ${total} cases passed`);
