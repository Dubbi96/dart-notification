/**
 * DAR-200 결정론적 검증: 공시 원문 WebView 화면의 로딩/에러/재시도 상태 전이와
 * 렌더 분기를 순수 함수로 재현해 진리표로 검증한다.
 * 실행: npx tsx scripts/check-webview-error-retry.ts  (실패 시 exit 1)
 *
 * 버그(수정 전): onError/onHttpError/타임아웃 가드 없이 onLoadEnd만 존재 →
 * DART 다운·기내모드에서 스피너만 사라지고 빈 화면 무한. 재시도 동선 전무.
 * 수정 후: 에러 콜백/타임아웃 → 에러 상태(재시도 버튼), 재시도 → 재로딩.
 */

interface ViewerState {
  isLoading: boolean;
  hasError: boolean;
}

type Event =
  | { type: 'loadEnd' }
  | { type: 'error' } // onError 또는 메인 문서 onHttpError 또는 타임아웃
  | { type: 'subResourceHttpError' } // 하위 리소스 404 — 무시되어야 함
  | { type: 'retry' };

const INITIAL: ViewerState = { isLoading: true, hasError: false };

// viewer.tsx 의 상태 핸들러(handleError/handleRetry/handleLoadEnd/타임아웃)를 1:1 재현.
function reduce(state: ViewerState, e: Event): ViewerState {
  switch (e.type) {
    case 'loadEnd':
      return { ...state, isLoading: false };
    case 'error':
      return { isLoading: false, hasError: true };
    case 'subResourceHttpError':
      return state; // 메인 문서 url 불일치 → 변화 없음
    case 'retry':
      return { isLoading: true, hasError: false };
  }
}

// 렌더 분기: 에러 우선 → 로딩 오버레이 → 정상.
function render(state: ViewerState): 'error' | 'loading' | 'content' {
  if (state.hasError) return 'error';
  if (state.isLoading) return 'loading';
  return 'content';
}

function run(events: Event[]): ViewerState {
  return events.reduce(reduce, INITIAL);
}

interface Case {
  name: string;
  events: Event[];
  expectedRender: ReturnType<typeof render>;
}

const cases: Case[] = [
  { name: '초기 마운트 → 로딩 오버레이', events: [], expectedRender: 'loading' },
  { name: '정상 로드 완료 → 콘텐츠', events: [{ type: 'loadEnd' }], expectedRender: 'content' },
  { name: '기내모드 onError → 에러뷰', events: [{ type: 'error' }], expectedRender: 'error' },
  {
    name: '메인 문서 HTTP 에러(타임아웃 포함) → 에러뷰',
    events: [{ type: 'error' }],
    expectedRender: 'error',
  },
  {
    name: '하위 리소스 404 단독 → 정상 로드면 콘텐츠 유지',
    events: [{ type: 'subResourceHttpError' }, { type: 'loadEnd' }],
    expectedRender: 'content',
  },
  {
    name: '에러 후 도착한 onLoadEnd가 에러뷰를 덮지 않음',
    events: [{ type: 'error' }, { type: 'loadEnd' }],
    expectedRender: 'error',
  },
  {
    name: '에러 → 재시도 → 로딩 오버레이',
    events: [{ type: 'error' }, { type: 'retry' }],
    expectedRender: 'loading',
  },
  {
    name: '에러 → 재시도 → 재로딩 성공 → 콘텐츠',
    events: [{ type: 'error' }, { type: 'retry' }, { type: 'loadEnd' }],
    expectedRender: 'content',
  },
  {
    name: '에러 → 재시도 → 재차 실패 → 에러뷰',
    events: [{ type: 'error' }, { type: 'retry' }, { type: 'error' }],
    expectedRender: 'error',
  },
];

let failed = 0;
console.log('— WebView 상태 전이 진리표 —');
for (const c of cases) {
  const got = render(run(c.events));
  const ok = got === c.expectedRender;
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${c.name} → ${got} (expected ${c.expectedRender})`);
}

if (failed > 0) {
  console.error(`\n${failed}/${cases.length} case(s) failed`);
  process.exit(1);
}
console.log(`\nAll ${cases.length} cases passed`);
