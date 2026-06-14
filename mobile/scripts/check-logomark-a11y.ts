/**
 * DAR-268 결정론적 검증: LogoMark 브랜드 SVG 의 스크린리더 노출 의도 명확화.
 *
 * 근거: components/common/LogoMark.tsx 의 <Svg> 알림카드 일러스트에
 * accessible / importantForAccessibility 가 미지정이라, 스크린리더가 의미없는
 * 장식 SVG 도형을 읽을 소지가 있었다. 앱 식별 정보('공시온')는 위 <Text> 노드가
 * 이미 전달하므로, SVG 는 장식으로 명시해 낭독 대상에서 제외한다.
 *
 * 해결: <Svg> 에 accessible={false} + importantForAccessibility="no-hide-descendants".
 *  - iOS(accessible=false): SVG 컨테이너가 접근성 요소가 되지 않음
 *  - Android(no-hide-descendants): SVG 와 그 하위 도형 전체를 접근성 트리에서 제외
 *
 * 이 검증은 소스의 <Svg> 여는 태그를 추출해 두 접근성 prop 이 정확한 값으로
 * 존재하는지 단정하고(회귀 시 prop 제거 포착), 음성 대조로 '공시온' 텍스트는
 * 여전히 낭독되도록 남아있는지 확인한다.
 *
 * 실행: npx tsx scripts/check-logomark-a11y.ts  (실패 시 exit 1)
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(
  join(here, '..', 'components', 'common', 'LogoMark.tsx'),
  'utf8',
);

// <Svg ...> 여는 태그(자식 시작 '>'까지)를 추출.
const svgStart = src.indexOf('<Svg');
const svgTagEnd = src.indexOf('>', svgStart);
const svgOpenTag =
  svgStart >= 0 && svgTagEnd >= 0 ? src.slice(svgStart, svgTagEnd) : '';

let failed = 0;
function check(label: string, ok: boolean): void {
  if (!ok) failed += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'} | ${label}`);
}

check('<Svg> 여는 태그 발견', svgOpenTag.length > 0);
check('accessible={false} (장식 명시)', /accessible=\{false\}/.test(svgOpenTag));
check(
  'importantForAccessibility="no-hide-descendants"',
  /importantForAccessibility=("|')no-hide-descendants\1/.test(svgOpenTag),
);
// 의미있는 라벨을 SVG 에 붙이지 않았는지(장식이므로 라벨 부재가 의도) 확인.
check(
  'SVG 에 accessibilityLabel 미부착(장식 일관성)',
  !/accessibilityLabel=/.test(svgOpenTag),
);
// 음성 대조: 앱 식별 텍스트는 <Text> 로 남아 스크린리더가 여전히 낭독.
check("'공시' 텍스트 노드 보존", /<Text[^>]*>공시<\/Text>/.test(src));
check("'온' 텍스트 노드 보존", /<Text[^>]*>온<\/Text>/.test(src));

if (failed > 0) {
  console.error(`\n${failed} check(s) FAILED`);
  process.exit(1);
}
console.log('\nAll checks passed.');
