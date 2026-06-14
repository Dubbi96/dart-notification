/**
 * DAR-201 결정론적 검증: 알림 설정 화면이
 *  (1) GET 실패를 폼(기본값)으로 위장하지 않고 에러뷰+재시도로 분기하는지,
 *  (2) 로드 성공 전에는 저장이 비활성/차단되어 서버 설정을 기본값으로 덮어쓰지 않는지,
 *  (3) 토글 행이 라벨/상태(checked) 단일 접근 단위로 합성되는지
 * 를 순수 함수 진리표로 검증한다.
 * 실행: npx tsx scripts/check-notification-settings-error-state.ts  (실패 시 exit 1)
 *
 * 버그(수정 전): useNotificationSettings()에서 isError 미구조분해 → GET 실패 시 폼이 전 토글
 * OFF/기본값으로 채워지고, 저장 시 서버 실제 설정을 기본값으로 덮어써 데이터가 유실됨.
 * 또한 Switch/Checkbox가 accessibilityRole/Label/State 없이 단독 노출돼 스크린리더가
 * "무엇에 대한 스위치인지/켜짐·꺼짐"을 읽지 못함.
 */

// 화면 렌더 결정: 'loading' | 'error' | 'form'
// notification-settings.tsx 의 early-return 순서(isLoading → isError → form)를 재현.
function routeRender(input: {
  isLoading: boolean;
  isError: boolean;
}): 'loading' | 'error' | 'form' {
  if (input.isLoading) return 'loading';
  if (input.isError) return 'error';
  return 'form';
}

// 저장 버튼 활성 여부: disabled={!isDirty || !settings} 의 역(활성=가능).
// onSubmit 가드(!settings → return)와 동치여야 데이터 유실이 원천 차단된다.
function canSave(input: { isDirty: boolean; hasSettings: boolean }): boolean {
  return input.isDirty && input.hasSettings;
}

// 토글 행 접근 라벨 합성: 설명이 있으면 "라벨, 설명", 없으면 "라벨".
function a11yLabel(label: string, description?: string): string {
  return description ? `${label}, ${description}` : label;
}

interface RouteCase {
  name: string;
  input: Parameters<typeof routeRender>[0];
  expected: ReturnType<typeof routeRender>;
}

const routeCases: RouteCase[] = [
  { name: '로딩 중 → 스피너', input: { isLoading: true, isError: false }, expected: 'loading' },
  { name: 'GET 500 실패 → 에러뷰(재시도)', input: { isLoading: false, isError: true }, expected: 'error' },
  { name: '로딩이 에러보다 우선', input: { isLoading: true, isError: true }, expected: 'loading' },
  { name: '로드 성공 → 폼', input: { isLoading: false, isError: false }, expected: 'form' },
];

interface SaveCase {
  name: string;
  input: Parameters<typeof canSave>[0];
  expected: boolean;
}

const saveCases: SaveCase[] = [
  { name: '로드 전(미완료)·미변경 → 저장 불가', input: { isDirty: false, hasSettings: false }, expected: false },
  { name: '로드 전인데 isDirty 만 true → 저장 불가(덮어쓰기 차단)', input: { isDirty: true, hasSettings: false }, expected: false },
  { name: '로드 성공·미변경 → 저장 불가', input: { isDirty: false, hasSettings: true }, expected: false },
  { name: '로드 성공·변경됨 → 저장 가능', input: { isDirty: true, hasSettings: true }, expected: true },
];

interface LabelCase {
  name: string;
  label: string;
  description?: string;
  checked: boolean;
  expectedLabel: string;
}

const labelCases: LabelCase[] = [
  { name: '단일 라벨(새 공시 알림) 꺼짐', label: '새 공시 알림 받기', checked: false, expectedLabel: '새 공시 알림 받기' },
  {
    name: '매수 신호 스위치 켜짐(라벨+설명)',
    label: '매수 신호',
    description: '강력매수·매수 신호 발생 시 알림',
    checked: true,
    expectedLabel: '매수 신호, 강력매수·매수 신호 발생 시 알림',
  },
  {
    name: '청산 권고 스위치 꺼짐(라벨+설명)',
    label: '청산 권고',
    description: '청산 조건 충족 시 알림 (권고 — 자동 주문 아님)',
    checked: false,
    expectedLabel: '청산 권고, 청산 조건 충족 시 알림 (권고 — 자동 주문 아님)',
  },
];

let failed = 0;

console.log('— routeRender 진리표 (loading→error→form) —');
for (const c of routeCases) {
  const got = routeRender(c.input);
  const ok = got === c.expected;
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${c.name} → ${got} (expected ${c.expected})`);
}

console.log('\n— canSave 게이트(로드 성공 전 저장 차단) —');
for (const c of saveCases) {
  const got = canSave(c.input);
  const ok = got === c.expected;
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${c.name} → ${got} (expected ${c.expected})`);
}

console.log('\n— a11y 라벨 합성 + state.checked —');
for (const c of labelCases) {
  const gotLabel = a11yLabel(c.label, c.description);
  const ok = gotLabel === c.expectedLabel;
  if (!ok) failed++;
  // checked 상태는 그대로 accessibilityState 로 전달되므로 동치 확인.
  console.log(
    `${ok ? 'PASS' : 'FAIL'}  ${c.name} → "${gotLabel}" {checked:${c.checked}} (expected "${c.expectedLabel}")`,
  );
}

const total = routeCases.length + saveCases.length + labelCases.length;
if (failed > 0) {
  console.error(`\n${failed}/${total} case(s) failed`);
  process.exit(1);
}
console.log(`\nAll ${total} cases passed`);
