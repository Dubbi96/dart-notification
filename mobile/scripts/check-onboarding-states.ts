// DAR-462 결정론 검증: 온보딩(app/onboarding/index.tsx) 상태처리·접근성·뒤로가기.
// UI/UX 전수 감사 2026-06-27(cc-ui-ux-audit) A-ONB-1~4.
// 판정 축:
//   (1) A-ONB-1: 인기 기업 목록 빈/에러 상태 — ListEmptyComponent + 재시도(refetch).
//   (2) A-ONB-2: 알림 권한 거부 시 무음 실패 금지 — 인라인 안내 + 설정 열기 + 단계 진행 보류.
//   (3) A-ONB-3: companyItem 접근성 — role=button + selected state + label.
//   (4) A-ONB-4: 단계 뒤로가기 — handleBack(step 감소) + 하드웨어 백 + 좌상단 < 헤더.
//   (5) 공통: 색상 토큰만(#hex/rgba 직접 사용 금지), 한국어 UI.
import { readFileSync } from 'fs';
import { join } from 'path';

const root = join(__dirname, '..');
const rel = 'app/onboarding/index.tsx';
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

// ───────── (1) A-ONB-1: 빈/에러 상태 + 재시도 ─────────
ok('(1) usePopularCompanies isError/error/refetch 구조분해', /isError,\s*\n?\s*error,\s*\n?\s*refetch/.test(src) || (/isError/.test(src) && /\brefetch\b/.test(src) && /\berror,/.test(src)));
ok('(1) StateView EmptyState/ApiErrorState import', /import\s*\{\s*EmptyState,\s*ApiErrorState\s*\}\s*from\s*'@components\/common\/StateView'/.test(src));
ok('(1) FlatList ListEmptyComponent 제공', /ListEmptyComponent=/.test(src));
ok('(1) 에러 분기 ApiErrorState 렌더', /<ApiErrorState\b/.test(src));
ok('(1) 빈 분기 EmptyState 렌더', /<EmptyState\b/.test(src));
ok('(1) 재시도 경로 refetch 연결', /onRetry=\{\(\)\s*=>\s*refetch\(\)\}/.test(src) && /onAction=\{\(\)\s*=>\s*refetch\(\)\}/.test(src));
ok('(1) 빈 상태 콘텐츠 flexGrow(세로 중앙)', /listEmptyContent:\s*\{[^}]*flexGrow:\s*1/.test(src));

// ───────── (2) A-ONB-2: 권한 거부 무음 실패 금지 ─────────
ok('(2) permissionDenied 상태 존재', /const\s*\[permissionDenied,\s*setPermissionDenied\]\s*=\s*useState\(false\)/.test(src));
const denialBranch = src.match(/if\s*\(status\s*!==\s*'granted'\)\s*\{[\s\S]*?\}/);
ok("(2) status!=='granted' 분기 존재", !!denialBranch);
ok('(2) 거부 시 setPermissionDenied(true)', !!denialBranch && /setPermissionDenied\(true\)/.test(denialBranch[0]));
// 거부 분기는 setStep을 호출하지 않고 보류(return)해야 한다(무음 자동진행 금지).
ok('(2) 거부 분기에서 자동 단계진행(setStep) 없음', !!denialBranch && !/setStep/.test(denialBranch[0]) && /return;/.test(denialBranch[0]));
ok('(2) 인라인 안내 Linking.openSettings 경로', /Linking\.openSettings\(\)/.test(src));
ok('(2) 안내 아이콘 Feather bell-off', /<Feather\s+name="bell-off"/.test(src));
ok("(2) 설정 열기 접근성 라벨", /accessibilityLabel="기기 설정 열기"/.test(src));

// ───────── (3) A-ONB-3: companyItem 접근성 ─────────
// companyItem TouchableOpacity 블록 추출(onPress toggleCompany ~ 닫는 태그까지).
const companyStart = src.indexOf('onPress={() => toggleCompany(item.corpCode)}');
ok('(3) companyItem onPress(toggleCompany) 존재', companyStart !== -1);
const companyBlock = src.slice(companyStart - 400, companyStart + 600);
ok('(3) accessibilityRole="button"', /accessibilityRole="button"/.test(companyBlock));
ok('(3) accessibilityState selected', /accessibilityState=\{\{\s*selected:\s*isSelected\s*\}\}/.test(companyBlock));
ok('(3) accessibilityLabel(기업명·종목코드)', /accessibilityLabel=\{`\$\{item\.corpName\}\s*\$\{item\.stockCode\}`\}/.test(companyBlock));
ok('(3) companyItem minHeight=minTouchTarget', /companyItem:\s*\{[\s\S]*?minHeight:\s*sizing\.minTouchTarget/.test(src));

// ───────── (4) A-ONB-4: 단계 뒤로가기 ─────────
ok('(4) handleBack step 감소(Math.max 1 하한)', /setStep\(\(s\)\s*=>\s*Math\.max\(1,\s*s\s*-\s*1\)\)/.test(src));
ok('(4) BackHandler hardwareBackPress 등록', /BackHandler\.addEventListener\(\s*'hardwareBackPress'/.test(src));
ok('(4) 하드웨어 백 구독 해제(sub.remove)', /return\s*\(\)\s*=>\s*sub\.remove\(\)/.test(src));
ok('(4) step>1 일 때만 백 가로채기(return true)', /if\s*\(step\s*>\s*1\)\s*\{[\s\S]*?return true;/.test(src));
ok('(4) StepHeader 컴포넌트 정의', /function\s+StepHeader\(/.test(src));
ok('(4) StepHeader 좌상단 < (Feather arrow-left)', /<Feather\s+name="arrow-left"/.test(src));
ok("(4) 뒤로가기 접근성 라벨", /accessibilityLabel="이전 단계로"/.test(src));
ok('(4) StepHeader 3개 단계 모두 사용', (src.match(/<StepHeader\b/g) || []).length === 3);
ok('(4) 백버튼 step>1 조건 노출', /\{step\s*>\s*1\s*\?\s*\(/.test(src));

// ───────── (5) 공통 제약 ─────────
ok('(5) #hex/rgba 직접 색상 미사용', !/rgba\(/.test(src) && !/['"]#[0-9A-Fa-f]{3,8}['"]/.test(src));
ok('(5) sizing.minTouchTarget 토큰 사용(매직넘버 44 회피)', /sizing\.minTouchTarget/.test(src));
ok('(5) Feather 아이콘 import', /import\s*\{[^}]*Feather[^}]*\}\s*from\s*'@expo\/vector-icons'/.test(src));

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
