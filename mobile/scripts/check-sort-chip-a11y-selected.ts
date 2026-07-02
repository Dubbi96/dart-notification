// DAR-285 결정론 검증: components/portfolio/PositionSearchBar.tsx 정렬 칩 선택 상태 a11y.
// 1) 정렬 <Chip> 이 accessibilityState={{ selected }} 로 선택 상태를 스크린리더에 노출.
// 2) accessibilityRole='button' + accessibilityLabel 에 정렬명 포함.
// 3) 시각·동작 불변: mode/배경/textStyle/onPress 바인딩 보존(paper selected prop 미도입).
import { readFileSync } from 'fs';
import { join } from 'path';

const root = join(__dirname, '..');
const src = readFileSync(join(root, 'components/portfolio/PositionSearchBar.tsx'), 'utf8');

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

// 정렬 Chip 블록 추출
const chipStart = src.indexOf('<Chip');
ok('정렬 <Chip> 존재', chipStart >= 0);
const chipBlock = src.slice(chipStart, src.indexOf('</Chip>', chipStart));

// --- a11y 추가분 ---
ok('accessibilityState={{ selected }} 노출', /accessibilityState=\{\{\s*selected\s*\}\}/.test(chipBlock));
ok("accessibilityRole='button' 지정", /accessibilityRole="button"/.test(chipBlock));
// DAR-472: 라벨 구조가 `${opt.label}, ${opt.a11ySortDirection}` 로 진화(DAR-470 ▼방향 표기 +
// DAR-472 시급도순 실제 정렬기준 분기). 정렬명(opt.label)이 라벨 머리에 포함되는지로 검증한다.
ok('accessibilityLabel 에 정렬명(opt.label) 포함', /accessibilityLabel=\{`\$\{opt\.label\},\s*\$\{opt\.a11ySortDirection\}`\}/.test(chipBlock));

// --- 시각·동작 불변(회귀) ---
ok('mode 토글 보존(flat/outlined)', /mode=\{selected \? 'flat' : 'outlined'\}/.test(chipBlock));
ok('선택 배경색 보존(colors.primary)', /selected && \{ backgroundColor: colors\.primary \}/.test(chipBlock));
ok('textStyle 선택색 분기 보존', /color: selected \? colors\.primaryForeground : colors\.textSecondary/.test(chipBlock));
ok('onPress 핸들러 바인딩 보존', /onPress=\{makeSortHandler\(opt\.key\)\}/.test(chipBlock));
// paper selected prop 미도입(체크마크 아이콘 등 시각 변경 방지)
ok('paper selected prop 미도입(시각 불변)', !/\bselected=\{/.test(chipBlock));

// --- 부정 대조: 세 a11y 속성이 정확히 정렬 Chip 1곳에만 ---
ok('accessibilityState 전체 1회', (src.match(/accessibilityState=/g) || []).length === 1);
ok('정렬 옵션 3개 정의(SORT_OPTIONS)', (src.match(/key:\s*'(pnl|urgency|weight)'/g) || []).length === 3);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
