// DAR-316 결정론 검증: 공시 원문 뷰어(app/disclosure/viewer.tsx) 복귀 어포던스를
// 앱 표준 좌상단 < 뒤로가기로 통일(DAR-294/295/303). 기존 우상단 X(닫기) 모달 패턴 제거.
// 앵커 갱신 2026-07-02(L-5a A-1): 자체 헤더바(styles.header)가 공용 ScreenHeader 로 이관 —
// 각 축을 '화면의 ScreenHeader(onBack) 바인딩' + 'ScreenHeader 소스' 전이 검증으로 재바인딩(축 전부 보존).
// 판정 축:
//   (A) 백버튼: chevron 아이콘 + accessibilityLabel '뒤로 가기' + role button (ScreenHeader onBack 블록)
//   (B) 백버튼이 제목 Text 보다 먼저(좌측) 배치 — 좌상단 어포던스 (ScreenHeader 레이아웃)
//   (C) 닫기 동작 보존: onBack={() => router.back()}
//   (D) X 닫기 패턴 소거: 'close' 아이콘 없음, accessibilityLabel '닫기' 없음 (화면 전체)
//   (E) 제목 Text accessibilityRole='header'(헤더 시맨틱, ScreenHeader title)
//   (F) 제목 중앙정렬(textAlign:'center') — 좌/우 동폭 SIDE 대칭
import { readFileSync } from 'fs';
import { join } from 'path';

const root = join(__dirname, '..');
const rel = 'app/disclosure/viewer.tsx';
const src = readFileSync(join(root, rel), 'utf8');
const hdrSrc = readFileSync(join(root, 'components/common/ScreenHeader.tsx'), 'utf8');

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

// 화면이 공용 ScreenHeader 를 헤더로 사용(자체 헤더바 유물 없음).
ok(
  `${rel}: 공용 ScreenHeader 사용(자체 styles.header 유물 없음)`,
  /from '@components\/common\/ScreenHeader'/.test(src) &&
    /<ScreenHeader\b/.test(src) &&
    !/styles\.header\b/.test(src),
);

// ScreenHeader onBack 버튼 블록 추출(전이 검증 대상 특정).
const backBtnStart = hdrSrc.indexOf('onPress={onBack}');
const backBtn =
  backBtnStart >= 0
    ? hdrSrc.slice(backBtnStart, hdrSrc.indexOf('</TouchableOpacity>', backBtnStart))
    : '';
ok('ScreenHeader: onBack 버튼 블록 존재', backBtn.length > 0);

// (A) 백버튼 어포던스 — Feather chevron-left(표준 <)
ok('(A) chevron-left 아이콘 사용', /name="chevron-left"/.test(backBtn));
ok("(A) accessibilityLabel '뒤로 가기'", /accessibilityLabel="뒤로 가기"/.test(backBtn));
ok('(A) accessibilityRole="button"', /accessibilityRole="button"/.test(backBtn));

// (B) 백버튼(onBack 분기)이 제목({title})보다 먼저(좌측) 등장 — ScreenHeader JSX 순서
const backIdx = hdrSrc.indexOf('onPress={onBack}');
const titleIdx = hdrSrc.indexOf('{title}');
ok('(B) 백버튼 < 이 제목보다 좌측(먼저) 배치', backIdx !== -1 && titleIdx !== -1 && backIdx < titleIdx);

// (C) 닫기 동작 보존 — 화면이 onBack 에 router.back() 바인딩
ok('(C) onBack router.back() 보존', /<ScreenHeader[^>]*onBack=\{\(\)\s*=>\s*router\.back\(\)\}/.test(src));

// (D) X 닫기 패턴 소거(우상단 X) — 화면 전체에서 부재
ok("(D) 'close' 아이콘 미사용", !/name="close"/.test(src));
ok("(D) accessibilityLabel '닫기' 미사용", !/accessibilityLabel="닫기"/.test(src));

// (E) 제목 헤더 시맨틱 — ScreenHeader title Text 에 role=header
ok(
  '(E) 제목 Text accessibilityRole="header"',
  /<Text\b[\s\S]*?accessibilityRole="header"[\s\S]*?>\s*\{title\}/.test(hdrSrc),
);

// (F) 제목 중앙정렬(좌/우 동폭 SIDE 대칭) — ScreenHeader title 스타일
ok("(F) ScreenHeader title textAlign:'center'", /title:\s*\{[^}]*textAlign:\s*'center'/.test(hdrSrc));
// 회귀: 좌측정렬용 headerTitle paddingLeft 유물이 화면에 잔존 금지(이전 자체 헤더 유물)
ok('(F) 화면 headerTitle 유물 제거', !/headerTitle/.test(src));

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
