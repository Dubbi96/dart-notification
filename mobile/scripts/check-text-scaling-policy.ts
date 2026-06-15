/**
 * DAR-304 결정론 검증: 시스템 폰트 배율 더블 적용 제거.
 *
 * react-native 를 import 하면 tsx 가 죽으므로(네이티브 모듈), 패치의 핵심 의미를
 * 독립적으로 재현하는 동작 모델 + 소스 바인딩으로 검증한다.
 *
 * 검증 대상:
 *  A) 래퍼가 allowFontScaling 기본값을 false 로 주입한다.
 *  B) 명시적 per-instance allowFontScaling 은 그대로 우선한다(spread 순서).
 *  C) 그 외 props(style/children/numberOfLines 등)는 보존된다.
 *  D) 멱등 가드 — 2회 호출돼도 1회만 적용.
 *  E) 소스 바인딩 — textScaling.ts / _layout.tsx 의 핵심 구조.
 *  F) 음성 대조 — React 19 에서 죽은 Text.defaultProps 패턴에 의존하지 않는다.
 */
import { readFileSync } from 'fs';
import { join } from 'path';

let passed = 0;
let failed = 0;
function assert(name: string, cond: boolean): void {
  if (cond) {
    passed++;
    console.log(`  ✓ ${name}`);
  } else {
    failed++;
    console.log(`  ✗ ${name}`);
  }
}

const root = join(__dirname, '..');
const textScalingSrc = readFileSync(join(root, 'utils/textScaling.ts'), 'utf8');
const layoutSrc = readFileSync(join(root, 'app/_layout.tsx'), 'utf8');

// ── A~C) 동작 모델: 소스의 래퍼 구성을 그대로 재현 ─────────────────────────
// 소스: const Patched = (props) => createElement(Original, { allowFontScaling: false, ...props })
type Props = { allowFontScaling?: boolean; [k: string]: unknown };
const Original = () => null;
const recordedCreateElement = (type: unknown, props: Props): Props => {
  void type;
  return props;
};
const Patched = (props: Props): Props =>
  recordedCreateElement(Original, { allowFontScaling: false, ...props });

console.log('A) 기본 allowFontScaling=false 주입');
assert('props 미지정 → allowFontScaling === false', Patched({}).allowFontScaling === false);
assert(
  'children 만 전달해도 allowFontScaling === false',
  Patched({ children: '전체' }).allowFontScaling === false,
);

console.log('B) 명시적 allowFontScaling 우선(spread 순서)');
assert('allowFontScaling=true 명시 → true 보존', Patched({ allowFontScaling: true }).allowFontScaling === true);
assert(
  'allowFontScaling=false 명시 → false 유지',
  Patched({ allowFontScaling: false }).allowFontScaling === false,
);

console.log('C) 그 외 props 보존');
{
  const out = Patched({ children: '공시', numberOfLines: 1, style: { fontSize: 16 } });
  assert('children 보존', out.children === '공시');
  assert('numberOfLines 보존', out.numberOfLines === 1);
  assert('style 보존', (out.style as { fontSize: number }).fontSize === 16);
  assert('동시에 allowFontScaling=false', out.allowFontScaling === false);
}

// ── D) 멱등 가드 모델 ──────────────────────────────────────────────────────
console.log('D) 멱등(applied 가드)');
{
  let applied = false;
  let runs = 0;
  const apply = () => {
    if (applied) return;
    applied = true;
    runs++;
  };
  apply();
  apply();
  apply();
  assert('3회 호출 → 본문 1회만 실행', runs === 1);
}

// ── E) 소스 바인딩 ─────────────────────────────────────────────────────────
console.log('E) 소스 바인딩 — utils/textScaling.ts');
assert('applyGlobalTextScalingPolicy export', /export function applyGlobalTextScalingPolicy/.test(textScalingSrc));
assert("Text·TextInput 양쪽 패치", /\[\s*'Text'\s*,\s*'TextInput'\s*\]/.test(textScalingSrc));
assert(
  '기본값 주입 + props spread(순서)',
  /allowFontScaling:\s*false\s*,\s*\.\.\.props/.test(textScalingSrc),
);
assert('react-native 공개 진입점 require', /require\(\s*'react-native'\s*\)/.test(textScalingSrc));
assert('getter 교체(Object.defineProperty)', /Object\.defineProperty\(\s*RN\s*,\s*key/.test(textScalingSrc));
assert('교체된 getter 는 Patched 반환', /get:\s*\(\)\s*=>\s*Patched/.test(textScalingSrc));
assert('멱등 가드 존재', /if\s*\(applied\)\s*return/.test(textScalingSrc));

console.log('E) 소스 바인딩 — app/_layout.tsx');
assert(
  "@utils/textScaling 에서 import",
  /import\s*\{\s*applyGlobalTextScalingPolicy\s*\}\s*from\s*'@utils\/textScaling'/.test(layoutSrc),
);
assert('모듈 스코프에서 호출', /\napplyGlobalTextScalingPolicy\(\);/.test(layoutSrc));
{
  const callIdx = layoutSrc.indexOf('applyGlobalTextScalingPolicy();');
  const appContentIdx = layoutSrc.indexOf('function AppContent');
  assert('호출이 AppContent 정의보다 먼저(첫 렌더 전 적용)', callIdx > 0 && callIdx < appContentIdx);
}

// ── F) 음성 대조 — 죽은 패턴 미사용 ────────────────────────────────────────
console.log('F) 음성 대조 — React 19 에서 무시되는 defaultProps 패턴 미의존');
// 죽은 패턴은 `X.defaultProps = ...` 직접 할당. prose 의 설명 언급(`defaultProps.`)은 무관.
assert(
  'textScaling.ts 가 defaultProps 를 할당하지 않음',
  !/defaultProps\s*=[^=]/.test(textScalingSrc),
);

console.log(`\n${passed}/${passed + failed} passed`);
if (failed > 0) process.exit(1);
