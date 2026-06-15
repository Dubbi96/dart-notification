/**
 * DAR-309 런타임 발화 검증: DAR-304 의 전역 allowFontScaling=false 패치가 실제
 * RN <Text> 렌더 경로에 적용되는지 결정론적으로 확증한다.
 *
 * DAR-304 의 기존 check(check-text-scaling-policy)는 소스 구조만 본다. 본 스크립트는
 * 두 축으로 "런타임 실효"를 증명한다:
 *
 *  PART 1 — 컴파일 산출물 측정(실제 babel-preset-expo 사용):
 *    `import { Text } from 'react-native'` 가 무엇으로 컴파일되는지를 직접 트랜스폼해
 *    확인한다. 패치가 발화하려면 `<Text>` 가 **렌더 시점에 읽히는 라이브 멤버 접근**
 *    (`_reactNative.Text`)으로 컴파일돼야 한다. 만약 모듈 평가 시점에 지역 const 로
 *    캡처(`var Text = _reactNative.Text`)되거나 `_interopRequireWildcard` 로 값
 *    스냅샷되면, 진입점 getter 교체가 닿지 못해 패치는 무효가 된다.
 *
 *  PART 2 — 실제 패치 모듈 런타임 실행(end-to-end):
 *    가짜 'react-native' 모듈을 require 캐시 경로에 주입하고 **실제** textScaling.ts 의
 *    applyGlobalTextScalingPolicy() 를 실행한 뒤, PART 1 이 입증한 라이브 멤버 접근
 *    (`_reactNative.Text`)을 그대로 재현해 호출한다. 그 결과 래퍼가 발화하여
 *    allowFontScaling=false 가 주입되는지, 명시값은 우선되는지, 그리고 결정적으로
 *    **패치 전에 캡처해 둔 모듈 참조로도** 발화가 반영되는지를 확인한다.
 */
import Module from 'module';

import { transform } from '@babel/core';
import * as React from 'react';

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

// ── PART 1: 컴파일 산출물 측정 ─────────────────────────────────────────────
console.log('PART 1) babel-preset-expo 컴파일 산출물 — 라이브 멤버 접근 여부');

const SAMPLE = [
  "import { Text, View } from 'react-native';",
  'export function Sample() {',
  '  return <View>',
  '    <Text allowFontScaling style={{ fontSize: 16 }}>받침</Text>',
  '    <Text>전체</Text>',
  '  </View>;',
  '}',
].join('\n');

function compile(env: string): string {
  const prev = process.env.BABEL_ENV;
  process.env.BABEL_ENV = env;
  try {
    const out = transform(SAMPLE, {
      filename: '/tmp/dar309-sample.tsx',
      presets: ['babel-preset-expo'],
      babelrc: false,
      configFile: false,
      cwd: process.cwd(),
    });
    return out?.code ?? '';
  } finally {
    process.env.BABEL_ENV = prev;
  }
}

for (const env of ['development', 'production']) {
  const code = compile(env);
  // 라이브 멤버 접근으로 컴파일돼야 함: jsx(_reactNative.Text, ...)
  assert(
    `[${env}] <Text> 가 라이브 멤버 접근(_reactNative.Text)으로 컴파일`,
    /_reactNative\.Text/.test(code),
  );
  // 패치 무효화 위험 패턴 부재: 지역 const 캡처
  assert(
    `[${env}] Text 를 모듈평가 시점 지역변수로 캡처하지 않음`,
    !/\bvar\s+(?:_?Text|Text\d*)\s*=\s*_reactNative\.Text/.test(code) &&
      !/\bconst\s+Text\s*=/.test(code),
  );
  // 패치 무효화 위험 패턴 부재: 네임스페이스 값 스냅샷(getter 미보존 가능)
  assert(
    `[${env}] _interopRequireWildcard 값 스냅샷 미사용(named import)`,
    !/_interopRequireWildcard\([^)]*react-native/.test(code),
  );
  // require 는 모듈 객체를 그대로 보유(패치 대상과 동일 객체)
  assert(
    `[${env}] _reactNative 는 require('react-native') 모듈 객체 그대로`,
    /var\s+_reactNative\s*=\s*require\(\s*["']react-native["']\s*\)/.test(code),
  );
}

// ── PART 2: 실제 패치 모듈 런타임 실행 ─────────────────────────────────────
console.log('\nPART 2) 실제 textScaling.ts 런타임 발화 — 가짜 react-native 주입');

interface RNTextProps {
  allowFontScaling?: boolean;
  children?: unknown;
  numberOfLines?: number;
  style?: unknown;
}
type RNComp = (props: RNTextProps) => null;

const OriginalText: RNComp = () => null;
(OriginalText as unknown as { displayName: string }).displayName = 'OriginalText';
const OriginalTextInput: RNComp = () => null;
(OriginalTextInput as unknown as { displayName: string }).displayName =
  'OriginalTextInput';

const fakeRN: Record<string, unknown> = {
  Text: OriginalText,
  TextInput: OriginalTextInput,
  View: () => null,
};

// 'react-native' require 를 가짜 모듈로 가로챈다(패치 모듈이 require 하는 그 객체).
interface LoadableModule {
  _load(request: string, parent: unknown, isMain: boolean): unknown;
}
const ModuleAny = Module as unknown as LoadableModule;
const origLoad = ModuleAny._load.bind(ModuleAny);
ModuleAny._load = function (
  request: string,
  parent: unknown,
  isMain: boolean,
): unknown {
  if (request === 'react-native') return fakeRN;
  return origLoad(request, parent, isMain);
};

// ★ 타이밍 위험 재현: 패치 적용 "전"에 모듈 참조를 캡처해 둔다.
//   (어떤 화면 파일이 _layout 의 패치 호출보다 먼저 평가돼 _reactNative 를
//    이미 보유한 상황과 동치.)
const capturedBeforePatch = fakeRN; // == 컴파일된 `var _reactNative = require('react-native')`
const TextRefBeforePatch = capturedBeforePatch.Text;
assert('패치 전: 캡처 참조의 Text === Original', TextRefBeforePatch === OriginalText);

// 실제 패치 모듈 로드·실행
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { applyGlobalTextScalingPolicy } = require('../utils/textScaling') as {
  applyGlobalTextScalingPolicy: () => void;
};
applyGlobalTextScalingPolicy();

ModuleAny._load = origLoad; // 가로채기 해제(이후 require 정상화)

// getter 가 실제로 교체됐는가
assert('패치 후: 모듈의 Text 가 래퍼로 교체됨(!== Original)', fakeRN.Text !== OriginalText);
assert(
  '패치 후: TextInput 도 래퍼로 교체됨(!== Original)',
  fakeRN.TextInput !== OriginalTextInput,
);
assert(
  '래퍼 displayName 이 진입점 키 보존(Text)',
  (fakeRN.Text as { displayName?: string }).displayName === 'Text',
);

// ★ 핵심: 패치 "전"에 캡처해 둔 모듈 참조로 멤버 접근해도 래퍼가 보인다(라이브 바인딩).
const TextRefAfter = capturedBeforePatch.Text; // 동일 객체의 멤버를 렌더 시점에 다시 읽음
assert(
  '패치 전 캡처 참조라도 멤버 재접근 시 래퍼 반영(라이브)',
  TextRefAfter !== OriginalText && TextRefAfter === fakeRN.Text,
);

// 컴파일 산출물이 하던 그대로 호출: jsx(_reactNative.Text, props)
function renderText(props: RNTextProps): React.ReactElement {
  const TypeRef = capturedBeforePatch.Text as (p: RNTextProps) => React.ReactElement;
  return TypeRef(props); // 래퍼(Patched) 실행 → createElement(Original, {allowFontScaling:false, ...props})
}

const e1 = renderText({ children: '전체' });
assert('렌더: 미지정 props → allowFontScaling=false 주입', e1.props.allowFontScaling === false);
assert('렌더: 하위 타입은 Original Text 그대로', e1.type === OriginalText);
assert('렌더: children 보존', e1.props.children === '전체');

const e2 = renderText({ allowFontScaling: true, children: '받침', numberOfLines: 1 });
assert('렌더: 명시 allowFontScaling=true 우선(opt-in 접근성 유지)', e2.props.allowFontScaling === true);
assert('렌더: 그 외 props(numberOfLines) 보존', e2.props.numberOfLines === 1);

// 음성 대조: 만약 패치가 미발화(=Original 직접 렌더)였다면 기본값이 주입되지 않는다.
const eUnpatched = OriginalText({ children: '전체' } as RNTextProps) as unknown;
assert(
  '음성 대조: 미패치 경로는 allowFontScaling 미주입(=발화가 실제로 차이를 만듦)',
  eUnpatched === null,
);

console.log(`\n${passed}/${passed + failed} passed`);
if (failed > 0) process.exit(1);
