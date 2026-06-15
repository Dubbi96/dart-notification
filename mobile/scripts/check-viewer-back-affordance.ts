// DAR-316 결정론 검증: 공시 원문 뷰어(app/disclosure/viewer.tsx) 복귀 어포던스를
// 앱 표준 좌상단 < 뒤로가기로 통일(DAR-294/295/303). 기존 우상단 X(닫기) 모달 패턴 제거.
// 판정 축:
//   (A) 헤더바에 chevron-back 백버튼 + accessibilityLabel '뒤로 가기' + role button
//   (B) 백버튼이 제목 Text 보다 먼저(좌측) 배치 — 좌상단 어포던스
//   (C) 닫기 동작 보존: onPress={() => router.back()}
//   (D) X 닫기 패턴 소거: 'close' 아이콘 없음, accessibilityLabel '닫기' 없음
//   (E) 제목 Text accessibilityRole='header'(헤더 시맨틱)
//   (F) 제목 중앙정렬(textAlign:'center') — 좌측 < 와 우측 스페이서 대칭
import { readFileSync } from 'fs';
import { join } from 'path';

const root = join(__dirname, '..');
const rel = 'app/disclosure/viewer.tsx';
const src = readFileSync(join(root, rel), 'utf8');

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

// 헤더바 블록 추출: {/* Header ... */} 주석 직후의 <View style={[styles.header...> 컨테이너.
const headerStart = src.indexOf('styles.header');
ok(`${rel}: 헤더바(styles.header) 존재`, headerStart !== -1);
// 헤더 컨테이너 닫힘까지(다음 styles.webviewContainer 직전)를 헤더 영역으로 본다.
const headerEnd = src.indexOf('webviewContainer', headerStart);
const header = src.slice(headerStart, headerEnd === -1 ? src.length : headerEnd);

// (A) 백버튼 어포던스
ok('(A) chevron-back 아이콘 사용', /name="chevron-back"/.test(header));
ok("(A) accessibilityLabel '뒤로 가기'", /accessibilityLabel="뒤로 가기"/.test(header));
ok('(A) accessibilityRole="button"', /accessibilityRole="button"/.test(header));

// (B) 백버튼이 제목보다 먼저(좌측) 등장
const backIdx = header.indexOf('chevron-back');
const titleIdx = header.search(/typo\.bodyMedium/);
ok('(B) 백버튼 < 이 제목보다 좌측(먼저) 배치', backIdx !== -1 && titleIdx !== -1 && backIdx < titleIdx);

// (C) 닫기 동작 보존
ok('(C) onPress router.back() 보존', /onPress=\{\(\)\s*=>\s*router\.back\(\)\}/.test(header));

// (D) X 닫기 패턴 소거(우상단 X)
ok("(D) 'close' 아이콘 미사용", !/name="close"/.test(header));
ok("(D) accessibilityLabel '닫기' 미사용", !/accessibilityLabel="닫기"/.test(header));

// (E) 제목 헤더 시맨틱
ok('(E) 제목 Text accessibilityRole="header"', /accessibilityRole="header"/.test(header));

// (F) 제목 중앙정렬(좌 < / 우 스페이서 대칭)
ok("(F) headerTitle textAlign:'center'", /headerTitle:\s*\{[^}]*textAlign:\s*'center'/.test(src));
// 회귀: 좌측정렬용 paddingLeft 잔존 금지(이전 좌측 제목 레이아웃 유물)
ok('(F) headerTitle paddingLeft 제거', !/headerTitle:\s*\{[^}]*paddingLeft/.test(src));

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
