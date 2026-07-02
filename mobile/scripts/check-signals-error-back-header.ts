// DAR-311 결정론 검증: signals/[id] 에러 상태에 좌상단 < 뒤로가기 헤더 노출.
//   push 상세는 하단 GNB 가 없으므로 헤더의 back 이 유일한 복귀 동선이다.
//   기존 isLoading·!signal 분기는 헤더를 렌더했으나 isError 분기만 ErrorState 만 렌더해
//   복귀 버튼이 사라졌다(QA 배치48). 세 상태(로딩/에러/없음) + 본문 헤더 일관을 소스에서 입증.
// UXR-12(B-4) 갱신: 수제 헤더 4벌(arrow-left 22pt, hitSlop 없음)을 공용 ScreenHeader
//   (44pt 터치 + hitSlop + 중앙 타이틀)로 통일 — 바인딩 패턴을 ScreenHeader 채택으로 갱신.
// UXR-12(B-7) 갱신: 에러 분기는 generic ErrorState → ApiErrorState(연결 실패 구분)로 승격.
// 헤드리스 환경에서 에뮬 스샷이 생성되지 않으므로 소스 바인딩으로 회귀를 차단한다.
import { readFileSync } from 'fs';
import { join } from 'path';

const root = join(__dirname, '..');
const read = (rel: string) => readFileSync(join(root, rel), 'utf8');

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

const src = read('app/signals/[id].tsx');

// 분기 블록 추출 모델: `if (<guard>) {` 부터 다음 분기/return 의 시작 직전까지를 본문으로 본다.
// 단순 슬라이스로 각 조기반환(early-return) 분기 본문을 분리한다.
function sliceBlock(startMarker: string, endMarker: string): string {
  const s = src.indexOf(startMarker);
  if (s < 0) return '';
  const e = src.indexOf(endMarker, s + startMarker.length);
  return e < 0 ? src.slice(s) : src.slice(s, e);
}

const loadingBlock = sliceBlock('if (isLoading) {', 'if (isError) {');
const errorBlock = sliceBlock('if (isError) {', 'if (!signal) {');
const emptyBlock = sliceBlock('if (!signal) {', 'const isExpired');
// 본문(정상) 헤더: 마지막 return 의 헤더. emptyBlock 이후 ~ ScrollView 직전.
const mainHeaderBlock = sliceBlock('const isExpired', '<ScrollView');

ok('blocks 분리: 4개 모두 비어있지 않음',
  Boolean(loadingBlock && errorBlock && emptyBlock && mainHeaderBlock));

// 헤더 패턴(UXR-12 B-4): 공용 ScreenHeader + 타이틀 + router.back 핸들러 배선.
function hasBackHeader(block: string): boolean {
  return /<ScreenHeader\s+title="매수 후보 상세"\s+onBack=\{handleBack\}\s*\/>/.test(block);
}

ok('로딩 분기: 공용 ScreenHeader 뒤로가기 헤더 렌더', hasBackHeader(loadingBlock));
ok('에러 분기: 공용 ScreenHeader 뒤로가기 헤더 렌더 (DAR-311 핵심 수정)', hasBackHeader(errorBlock));
ok('없음 분기: 공용 ScreenHeader 뒤로가기 헤더 렌더', hasBackHeader(emptyBlock));
ok('본문(정상) 분기: 공용 ScreenHeader 뒤로가기 헤더 렌더', hasBackHeader(mainHeaderBlock));

// onBack 핸들러가 실제 router.back 으로 배선돼 있는지(복귀 동선 실효성).
ok('handleBack = router.back 배선',
  /const handleBack = useCallback\(\(\) => router\.back\(\), \[\]\);/.test(src));

// 공용 ScreenHeader 가 44pt 터치영역 + hitSlop + a11y(role/label)를 제공하는지(스펙 근거).
const screenHeader = read('components/common/ScreenHeader.tsx');
ok('ScreenHeader: 44pt 사이드(터치영역) 정의', /const SIDE = 44/.test(screenHeader));
ok('ScreenHeader: hitSlop 확보', /hitSlop=\{8\}/.test(screenHeader));
ok('ScreenHeader: a11y role/label(뒤로 가기)',
  /accessibilityRole="button"/.test(screenHeader) &&
    /accessibilityLabel="뒤로 가기"/.test(screenHeader));

// 에러 분기는 헤더 아래 ApiErrorState 를 error·retry 와 함께 배치(UXR-12 B-7: 연결 실패 구분).
ok('에러 분기: ApiErrorState error={error} + onRetry={refetch} 유지',
  /<ApiErrorState\b[\s\S]*error=\{error\}[\s\S]*onRetry=\{refetch\}/.test(errorBlock));
ok('에러 분기: 헤더가 ApiErrorState 보다 먼저 렌더(상단 노출)',
  errorBlock.indexOf('<ScreenHeader') < errorBlock.indexOf('<ApiErrorState'));

// 헤더 일관(UXR-12 B-4): 수제 헤더 복제(드리프트 원인) 완전 제거 — ScreenHeader 로만 렌더.
ok('수제 헤더 잔존 없음: arrow-left 직접 렌더 0건', !/name="arrow-left"/.test(src));
ok('수제 헤더 잔존 없음: styles.header 미사용', !/styles\.header\b/.test(src));
ok('4개 분기 모두 ScreenHeader 사용(정확히 4회)',
  (src.match(/<ScreenHeader\b/g) ?? []).length === 4);

// 대조군(수정 전 재현): 에러 상태 컴포넌트만 있고 헤더가 없는 분기는 회귀로 간주한다.
const errorHasOnlyState =
  /<ApiErrorState/.test(errorBlock) && !/<ScreenHeader/.test(errorBlock);
ok('회귀 가드: 에러 분기에 헤더 없이 에러 상태 단독 렌더는 실패로 판정', !errorHasOnlyState);

// 회귀(권장 점검): disclosure/[id] 는 로딩/에러/없음을 공유 셸에서 처리해 헤더 상시 노출.
const disclosure = read('app/disclosure/[id].tsx');
ok('disclosure/[id]: 로딩/에러/없음 공유 셸이 router.back 헤더 상시 렌더',
  /if \(isLoading \|\| isError \|\| !disclosure\)/.test(disclosure) &&
    /onPress=\{\(\) => router\.back\(\)\}/.test(disclosure));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
