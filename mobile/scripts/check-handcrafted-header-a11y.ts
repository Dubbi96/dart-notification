// DAR-295 결정론 검증: 공통 ScreenHeader 미사용 화면들의 손수제작 헤더바 제목 헤더 시맨틱.
// DAR-294(공통 ScreenHeader)와 동일 패턴 정렬 — 헤더바(styles.header) 내 typo.h3 제목 Text 가
// accessibilityRole='header' 노출해야 스크린리더 헤더/로터 섹션 네비 가능.
// 대상 4곳(3 파일):
//   app/disclosure/[id].tsx  '공시 상세' ×2 (로딩 헤더 + 본문 헤더)
//   app/disclosures/index.tsx '전체 공시'
//   app/search/index.tsx      '통합 검색'
import { readFileSync } from 'fs';
import { join } from 'path';

const root = join(__dirname, '..');

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

// 라벨을 JSX 텍스트 자식으로 갖는 <Text ...>LABEL</Text> 블록만 추출(주석/ title= prop/
// accessibilityLabel 등 비-제목 출현은 자연 배제). [^>] 는 다중라인 속성을 따라가며 여는태그
// 끝 '>' 까지만 소비한다(속성 값에 '>' 없음).
function titleBlocks(src: string, label: string): string[] {
  const esc = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`<Text\\b[^>]*>\\s*${esc}\\s*</Text>`, 'g');
  return src.match(re) || [];
}

function checkTitle(rel: string, label: string, expectedCount: number) {
  const src = readFileSync(join(root, rel), 'utf8');
  const blocks = titleBlocks(src, label);
  ok(`${rel} '${label}': 헤더바 제목 Text ${expectedCount}곳 추출`, blocks.length === expectedCount);
  blocks.forEach((block, i) => {
    const tag = `${rel} '${label}'${expectedCount > 1 ? ` #${i + 1}` : ''}`;
    ok(`${tag}: accessibilityRole="header"`, /accessibilityRole="header"/.test(block));
    ok(`${tag}: typo.h3 스타일 보존`, /typo\.h3/.test(block));
  });
}

// disclosure/[id].tsx — '공시 상세' 두 헤더바(로딩 + 본문) 모두
checkTitle('app/disclosure/[id].tsx', '공시 상세', 2);
// disclosures/index.tsx — 앵커 갱신 2026-07-02(L-5a A-1): 손수제작 헤더 → 공통 ScreenHeader 이관.
// 제목 헤더 시맨틱은 ScreenHeader 내부 title Text(accessibilityRole="header")가 전이 제공 —
// ① 화면이 title="전체 공시" 로 ScreenHeader 를 사용하고 ② 컴포넌트가 role=header 를 부여함을 단정.
{
  const src = readFileSync(join(root, 'app/disclosures/index.tsx'), 'utf8');
  ok(
    "app/disclosures/index.tsx '전체 공시': ScreenHeader title 사용(이관)",
    /from '@components\/common\/ScreenHeader'/.test(src) &&
      /<ScreenHeader\s+title="전체 공시"/.test(src),
  );
  const hdr = readFileSync(join(root, 'components/common/ScreenHeader.tsx'), 'utf8');
  const titleText = hdr.match(/<Text\b[\s\S]*?accessibilityRole="header"[\s\S]*?>\s*\{title\}/);
  ok('ScreenHeader: title Text 가 accessibilityRole="header"(전이 커버 성립)', titleText !== null);
}
// search/index.tsx — '통합 검색'(헤더바 제목; title= prop / accessibilityLabel 은 별개로 배제됨)
checkTitle('app/search/index.tsx', '통합 검색', 1);

// 회귀 가드: role="header" 가 헤더바 제목에만 (각 파일별 정확히 기대 개수) 부여 — 과확산 방지
// (disclosures 는 ScreenHeader 이관으로 인라인 role=header 0 이 정상 — 잔존 시 이중 시맨틱 회귀)
const counts: Array<[string, number]> = [
  ['app/disclosure/[id].tsx', 2],
  ['app/disclosures/index.tsx', 0],
  ['app/search/index.tsx', 1],
];
for (const [rel, n] of counts) {
  const src = readFileSync(join(root, rel), 'utf8');
  const total = (src.match(/accessibilityRole="header"/g) || []).length;
  ok(`${rel}: role=header 정확히 ${n}곳(과확산 없음)`, total === n);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
