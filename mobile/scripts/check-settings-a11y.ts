// DAR-445 결정론 검증: app/(tabs)/settings/index.tsx 설정 화면 종합
// (MenuItem 접근성 + 안전장치 + 타이틀/진입점). 정본: docs/roadmap/cc-ui-ux-audit-2026-06-27.md
//
// 검증 대상 6건:
//  D1 헤더 타이틀 "프로필"→"설정"(탭 정체성 정합)
//  D2 MenuItem accessibilityRole="button" + accessibilityLabel(subtitle/현재값 합성)
//  D3 로그아웃 확인 다이얼로그("로그아웃하시겠어요?") 게이트(즉시 logout 금지)
//  D8 cycle 행(화면 설정/글자 크기) 현재값 칩 + accessibilityHint
//  D9 "앱 정보" dead tap(onPress={() => {}}) 제거 → 비터치(View) 행
//  D12 "저장된 공시" 진입점을 계정 관리 섹션에 추가(라우팅 /settings-detail/saved-disclosures)
import { readFileSync } from 'fs';
import { join } from 'path';

const root = join(__dirname, '..');
const src = readFileSync(join(root, 'app/(tabs)/settings/index.tsx'), 'utf8');

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

// MenuItem 헬퍼 영역(컴포넌트 정의) 슬라이스
const menuItemDef = src.slice(src.indexOf('function MenuItem('), src.indexOf('export default function SettingsScreen'));

// --- D2: MenuItem 접근성 ---
ok('D2: MenuItem accessibilityRole="button"', /accessibilityRole="button"/.test(menuItemDef));
ok('D2: accessibilityLabel={a11yLabel} 바인딩', /accessibilityLabel=\{a11yLabel\}/.test(menuItemDef));
ok('D2: accessibilityHint 패스스루', /accessibilityHint=\{accessibilityHint\}/.test(menuItemDef));
ok(
  'D2: a11yLabel 합성(title/subtitle/현재값 join)',
  /\[title,\s*subtitle,\s*valueChip\s*\?\s*`현재 \$\{valueChip\}`\s*:\s*null\]/.test(menuItemDef) &&
    /\.filter\(Boolean\)\s*\.join\(', '\)/.test(menuItemDef),
);

// D2 동작 재현: 소스의 a11yLabel 빌더를 그대로 모델링해 결정론적 출력을 증명.
const buildLabel = (title: string, subtitle?: string, valueChip?: string) =>
  [title, subtitle, valueChip ? `현재 ${valueChip}` : null].filter(Boolean).join(', ');
ok(
  "D2 재현: subtitle 있음 → 'title, subtitle'",
  buildLabel('관심목록', '관심 기업 관리') === '관심목록, 관심 기업 관리',
);
ok("D2 재현: subtitle 없음 → 'title'", buildLabel('이용약관') === '이용약관');
ok(
  "D2 재현: cycle 행 → 'title, subtitle, 현재 값'",
  buildLabel('화면 설정', '테마 모드 전환', '라이트') === '화면 설정, 테마 모드 전환, 현재 라이트',
);

// --- D1: 헤더 타이틀 ---
const profileRow = src.slice(src.indexOf('styles.profileRow'), src.indexOf('isAuthenticated ? ('));
ok('D1: 헤더 h2 타이틀 "설정"', /\]\}>설정<\/Text>/.test(profileRow));
ok('D1: 헤더에 "프로필" 하드코딩 잔존 없음', !/\]\}>프로필<\/Text>/.test(profileRow));

// --- D3: 로그아웃 확인 게이트 ---
const logoutFn = src.slice(src.indexOf('const handleLogout'), src.indexOf('return (', src.indexOf('const handleLogout')));
ok('D3: handleLogout 이 showDialog 호출', /showDialog\(\{/.test(logoutFn));
ok('D3: 확인 문구 "로그아웃하시겠어요?"', /로그아웃하시겠어요\?/.test(logoutFn));
ok('D3: destructive 버튼에서만 logout 실행', /style:\s*'destructive',\s*onPress:\s*\(\)\s*=>\s*logout\(\)/.test(logoutFn));
ok('D3: 취소(cancel) 버튼 존재', /style:\s*'cancel'/.test(logoutFn));
ok('D3: 탭 즉시 logout() 직접호출 제거', !/const handleLogout = \(\) => \{\s*logout\(\);\s*\};/.test(src));
ok('D3: useDialog 훅 사용', /const \{ showDialog \} = useDialog\(\);/.test(src) && /from '@components\/common\/DialogProvider'/.test(src));

// --- D8: cycle 행 affordance + hint ---
const themeRow = src.slice(src.indexOf('title="화면 설정"'), src.indexOf('title="글자 크기"'));
const fontRow = src.slice(src.indexOf('title="글자 크기"'), src.indexOf('title="수집 현황"'));
ok('D8: 화면 설정 valueChip={themeLabel}', /valueChip=\{themeLabel\}/.test(themeRow));
ok('D8: 화면 설정 hint="탭하면 다음 옵션으로 전환"', /accessibilityHint="탭하면 다음 옵션으로 전환"/.test(themeRow));
ok('D8: 글자 크기 valueChip={textScaleLabel}', /valueChip=\{textScaleLabel\}/.test(fontRow));
ok('D8: 글자 크기 hint="탭하면 다음 옵션으로 전환"', /accessibilityHint="탭하면 다음 옵션으로 전환"/.test(fontRow));
ok('D8: valueChip 칩 + 순환 아이콘(sync-outline) 렌더', /styles\.valueChip/.test(menuItemDef) && /name="sync-outline"/.test(menuItemDef));
ok('D8: nonInteractive 분기는 View 로 렌더(button 아님)', /if \(nonInteractive\)/.test(menuItemDef) && /<View style=\{styles\.menuItem\} accessible accessibilityLabel=\{a11yLabel\}>/.test(menuItemDef));

// --- D9: 앱 정보 dead tap 제거 ---
const appInfoRow = src.slice(src.indexOf('title="앱 정보"'), src.indexOf('title="앱 정보"') + 260);
ok('D9: 앱 정보 nonInteractive 행', /nonInteractive/.test(appInfoRow));
ok('D9: 앱 정보 빈 onPress(dead tap) 제거', !/onPress=\{\(\) => \{\}\}/.test(src));

// --- D12: 저장된 공시 진입점 ---
ok('D12: 저장된 공시 MenuItem 존재', /title="저장된 공시"/.test(src));
ok('D12: 라우팅 /settings-detail/saved-disclosures', /router\.push\('\/settings-detail\/saved-disclosures'\)/.test(src));
// 계정 관리(인증 섹션) 안 — '일반' 섹션 타이틀보다 앞에 위치
const idxSaved = src.indexOf('title="저장된 공시"');
const idxAccount = src.indexOf('계정 관리');
const idxGeneral = src.indexOf('>\n              일반');
ok('D12: 계정 관리 섹션 내부(일반 섹션보다 앞)', idxSaved > idxAccount && idxSaved < (idxGeneral === -1 ? src.indexOf('title="화면 설정"') : idxGeneral));

// --- 회귀: 기존 행/패턴 유지 ---
ok('회귀: 관심목록 badgeCount 유지', /title="관심목록"[\s\S]*?badgeCount=\{watchlistCount\}/.test(src));
ok('회귀: 일반 상호작용 행은 TouchableOpacity 유지', /<TouchableOpacity\s+style=\{styles\.menuItem\}/.test(menuItemDef));
ok('회귀: showChevron 기본값 true 유지', /showChevron = true/.test(menuItemDef));
ok('회귀: refreshControl 커스텀 래퍼 미도입(크로스플랫폼 가드)', !/refreshControl=\{/.test(src));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
