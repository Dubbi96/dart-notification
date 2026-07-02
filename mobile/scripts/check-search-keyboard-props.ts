/**
 * DAR-284 결정론 검증: 종목/공시 검색 입력 3곳의 키보드 속성 일관성.
 *
 * 정본 SignalSearchInput(returnKeyType='search'+autoCapitalize='none'+autoCorrect={false})에
 * 맞춰, 같은 성격의 검색 TextInput 3곳이 자동대문자/자동수정을 끄고 검색 키를 지정하는지
 * 소스 바인딩으로 입증한다. (티커 'aapl'→'Aapl' 변형·한글 오수정·검색키 미지정 방지)
 *
 * 실행: npx tsx scripts/check-search-keyboard-props.ts
 */
import { readFileSync } from 'fs';
import { join } from 'path';

const ROOT = join(__dirname, '..');

interface Target {
  file: string;
  /** TextInput 블록을 특정하기 위한 placeholder 앵커 */
  anchor: string;
  /** 이 입력에서 요구되는 props (정본 패턴 정렬) */
  required: string[];
}

const TARGETS: Target[] = [
  {
    file: 'components/portfolio/PositionSearchBar.tsx',
    anchor: '종목명·티커 검색',
    required: ['returnKeyType="search"', 'autoCapitalize="none"', 'autoCorrect={false}'],
  },
  {
    // 앵커 갱신 2026-07-02(E-8): placeholder 카피 통일 '종목명 또는 종목코드 검색' → '기업명·종목코드 검색'
    file: 'components/common/SearchOverlay.tsx',
    anchor: '기업명·종목코드 검색',
    required: ['returnKeyType="search"', 'autoCapitalize="none"', 'autoCorrect={false}'],
  },
  {
    // 앵커 갱신 2026-07-02(E-8): placeholder 카피 통일 '기업명, 보고서명 검색' → '기업명·보고서명 검색'
    file: 'app/disclosures/index.tsx',
    anchor: '기업명·보고서명 검색',
    required: ['returnKeyType="search"', 'autoCapitalize="none"', 'autoCorrect={false}'],
  },
];

/** placeholder 앵커가 포함된 <TextInput ...> ... </ 블록(자기닫힘 포함)을 추출 */
function extractInputBlock(src: string, anchor: string): string {
  const anchorIdx = src.indexOf(anchor);
  if (anchorIdx < 0) throw new Error(`anchor not found: ${anchor}`);
  // 앵커 이전의 가장 가까운 <TextInput 부터, 이후 첫 '/>' 또는 '</TextInput>' 까지
  const openIdx = src.lastIndexOf('<TextInput', anchorIdx);
  if (openIdx < 0) throw new Error(`<TextInput not found before anchor: ${anchor}`);
  const selfClose = src.indexOf('/>', anchorIdx);
  const tagClose = src.indexOf('</TextInput>', anchorIdx);
  const end =
    tagClose >= 0 && (selfClose < 0 || tagClose < selfClose) ? tagClose : selfClose;
  if (end < 0) throw new Error(`TextInput close not found: ${anchor}`);
  return src.slice(openIdx, end);
}

let pass = 0;
let fail = 0;
const log = (ok: boolean, msg: string) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}`);
  if (ok) pass++;
  else fail++;
};

for (const t of TARGETS) {
  const src = readFileSync(join(ROOT, t.file), 'utf8');
  let block: string;
  try {
    block = extractInputBlock(src, t.anchor);
  } catch (e) {
    log(false, `${t.file} — 블록 추출 실패: ${(e as Error).message}`);
    continue;
  }
  for (const prop of t.required) {
    log(block.includes(prop), `${t.file} [${t.anchor}] 에 ${prop} 존재`);
  }
}

// 음성 대조: 정본이 실제로 동일 패턴을 갖는지(드리프트 방지 기준선)
const canon = readFileSync(join(ROOT, 'components/signals/SignalSearchInput.tsx'), 'utf8');
for (const prop of ['returnKeyType="search"', 'autoCapitalize="none"', 'autoCorrect={false}']) {
  log(canon.includes(prop), `정본 SignalSearchInput 에 ${prop} 존재(기준선)`);
}

console.log(`\n${pass}/${pass + fail} passed`);
if (fail > 0) process.exit(1);
