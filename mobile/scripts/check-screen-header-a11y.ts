// DAR-294 결정론 검증: 공통 components/common/ScreenHeader.tsx 제목 헤더 시맨틱.
// 1) 제목 Text 가 accessibilityRole='header' 노출(스크린리더 헤더 네비 가능).
// 2) subtitle Text 는 헤더 role 미부여(본문 텍스트로 유지).
// 3) numberOfLines={1} 보존(시각·말줄임 불변), 좌측 백버튼 role='button' 유지.
// 4) ScreenHeader 를 공유하는 4개 화면이 단일 수정으로 헤더 시맨틱 수혜(import 존재 확인).
import { readFileSync } from 'fs';
import { join } from 'path';

const root = join(__dirname, '..');
const src = readFileSync(join(root, 'components/common/ScreenHeader.tsx'), 'utf8');

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

// --- 제목 Text 블록 추출(titleBox 내부 첫 Text) ---
const titleBoxIdx = src.indexOf('styles.titleBox');
ok('titleBox 존재', titleBoxIdx >= 0);
const afterTitleBox = src.slice(titleBoxIdx);
// 첫 Text 시작 ~ 닫힘 사이를 제목 블록으로 본다.
const titleStart = afterTitleBox.indexOf('<Text');
const titleBlock = afterTitleBox.slice(titleStart, afterTitleBox.indexOf('{title}'));

ok('title: accessibilityRole="header" 부여', /accessibilityRole="header"/.test(titleBlock));
ok('title: typo.h3 스타일 보존', /typo\.h3/.test(titleBlock));
ok('title: numberOfLines={1} 보존', /numberOfLines=\{1\}/.test(titleBlock));

// --- subtitle 블록: title 이후 ~ 파일 끝. 헤더 role 미부여 검증 ---
const subtitleIdx = src.indexOf('styles.subtitle');
ok('subtitle 존재', subtitleIdx >= 0);
const subtitleBlock = src.slice(subtitleIdx, src.indexOf('{subtitle}'));
ok('subtitle: 헤더 role 미부여', !/accessibilityRole="header"/.test(subtitleBlock));

// --- accessibilityRole="header" 는 정확히 1곳(제목)만 ---
const headerRoleCount = (src.match(/accessibilityRole="header"/g) || []).length;
ok('헤더 role 정확히 1곳(제목)만', headerRoleCount === 1);

// --- 백버튼 role='button' 회귀 미손상 ---
ok('백버튼 accessibilityRole="button" 유지', /accessibilityRole="button"/.test(src));
ok('백버튼 accessibilityLabel="뒤로 가기" 유지', /accessibilityLabel="뒤로 가기"/.test(src));

// --- 4개 사용 화면이 ScreenHeader 를 import(단일 수정 일괄 수혜) ---
const consumers = [
  'app/settings-detail/notification-settings.tsx',
  'app/settings-detail/watchlist.tsx',
  'app/event-stats/index.tsx',
  'app/portfolio/trade-history.tsx',
];
for (const rel of consumers) {
  const csrc = readFileSync(join(root, rel), 'utf8');
  ok(`사용 화면 ScreenHeader 사용: ${rel}`, /ScreenHeader/.test(csrc));
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
