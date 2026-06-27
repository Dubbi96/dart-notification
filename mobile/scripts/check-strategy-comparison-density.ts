/**
 * DAR-459 결정론적 검증: 전략 비교 섹션 밀도 완화 + 우승 뱃지 아이콘.
 *
 * 배경(UI/UX 전수 감사 2026-06-27):
 *  - C6: 단타 섹션 + 4종 백테스트 전략카드가 각각 미니차트+3지표+접이 상세+드릴다운을
 *        한 스크롤에 모두 펼쳐 과밀했다. → 미니차트를 '한 탭 뒤'(InlineDisclosure)로
 *        옵션화해 기본 카드를 압축하고, 단타/백테스트 구분을 대칭 섹션 헤더로 명확히 한다.
 *  - C9: 우승 뱃지 "🥇" 이모지가 Feather 컨벤션을 이탈(렌더/색맹/로케일 의존). →
 *        Feather award 아이콘(형태) + 평문 라벨 병행, 색 단독 의미 금지.
 *
 * 이 스크립트가 검증하는 것(소스 바인딩·결정론):
 *  (A) C9: StrategyComparisonSection 에 🥇/이모지 0, BestBadge 가 Feather award + 평문
 *          '최고 수익' + 테마 토큰 colors.success(하드코딩 hex 0).
 *  (B) C6: 두 파일 모두 EquityCurveChart 가 InlineDisclosure('미니 자산곡선') 안으로
 *          이동(옵션화) — 기본 정보(primaryRow)는 차트보다 위, 차트는 단 1회 렌더.
 *  (C) C6: 단타/백테스트 구분 섹션 헤더 — 단타 트랙 헤더 + 백테스트 비교 헤더 병존.
 *  (D) 공통: 두 파일 이모지 0(픽토그래프 플레인) · Feather 외 아이콘 라이브러리 import 0.
 *  (E) 공통: 접이 헤더 44pt 터치영역 · refreshControl 커스텀 래퍼 금지(refreshing/onRefresh).
 *
 * 실행: npx tsx scripts/check-strategy-comparison-density.ts  (실패 시 exit 1)
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean, detail = '') {
  if (cond) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

const comparisonSrc = readFileSync(
  join(root, 'components/portfolio/StrategyComparisonSection.tsx'),
  'utf8',
);
const scalpSrc = readFileSync(
  join(root, 'components/portfolio/IntradayScalpSection.tsx'),
  'utf8',
);

// 이모지(픽토그래프 플레인 U+1F000–U+1FAFF) — 🥇(U+1F947) 포함. 한글(AC00–D7A3)·
// 중점(·)·em대시(—)·★(U+2605) 같은 의도적 마커는 이 범위 밖이라 오탐 없음.
const EMOJI_RE = /[\u{1F000}-\u{1FAFF}]/u;

console.log('\n[A] C9 — 우승 뱃지: 이모지 폐기 + Feather award + 평문');
check('🥇 이모지 제거(StrategyComparisonSection)', !comparisonSrc.includes('🥇'));
check('BestBadge 가 Feather award 아이콘 사용', /name="award"/.test(comparisonSrc));
check(
  'BestBadge 평문 라벨 "최고 수익" 유지',
  comparisonSrc.includes('최고 수익'),
);
{
  // BestBadge 블록만 추출해 토큰/하드코딩 검사.
  const start = comparisonSrc.indexOf('function BestBadge');
  const end = comparisonSrc.indexOf('function StatPair');
  const badgeBlock = start >= 0 && end > start ? comparisonSrc.slice(start, end) : '';
  check('BestBadge 가 colors.success 토큰 사용', badgeBlock.includes('colors.success'));
  check(
    'BestBadge 하드코딩 색상(#hex/rgba) 0',
    badgeBlock.length > 0 && !/#[0-9a-fA-F]{3,8}\b|rgba?\(/.test(badgeBlock),
  );
}

console.log('\n[B] C6 — 미니차트 옵션화(InlineDisclosure 안으로 이동)');
for (const [label, src] of [
  ['StrategyComparisonSection', comparisonSrc],
  ['IntradayScalpSection', scalpSrc],
] as const) {
  const discIdx = src.indexOf('label="미니 자산곡선"');
  const chartIdx = src.indexOf('<EquityCurveChart');
  const primaryIdx = src.indexOf('styles.primaryRow');
  const chartCount = (src.match(/<EquityCurveChart/g) ?? []).length;

  check(`${label}: '미니 자산곡선' 접이 토글 존재`, discIdx >= 0);
  check(`${label}: EquityCurveChart 단 1회 렌더`, chartCount === 1, `count=${chartCount}`);
  check(
    `${label}: 차트가 토글 안으로 이동(토글 라벨 < 차트)`,
    discIdx >= 0 && chartIdx > discIdx,
  );
  check(
    `${label}: 핵심 지표(primaryRow)가 차트보다 위(기본 정보 압축 유지)`,
    primaryIdx >= 0 && primaryIdx < discIdx,
  );
  check(
    `${label}: 미니차트 토글 아이콘 trending-up`,
    /label="미니 자산곡선" icon="trending-up"/.test(src),
  );
}

console.log('\n[C] C6 — 단타/백테스트 구분 섹션 헤더 병존');
check(
  '단타 트랙 섹션 헤더 존재(IntradayScalpSection)',
  scalpSrc.includes('단타 트랙 (분봉·실시간 모의)'),
);
check(
  '백테스트 비교 섹션 헤더 존재(StrategyComparisonSection)',
  comparisonSrc.includes('백테스트 비교 (일봉 4종 변형)'),
);

console.log('\n[D] 공통 — 이모지 0 · Feather 단일 아이콘');
check('StrategyComparisonSection 이모지 0', !EMOJI_RE.test(comparisonSrc));
check('IntradayScalpSection 이모지 0', !EMOJI_RE.test(scalpSrc));
for (const [label, src] of [
  ['StrategyComparisonSection', comparisonSrc],
  ['IntradayScalpSection', scalpSrc],
] as const) {
  const otherIconLib = /from '@expo\/vector-icons\/(?!.*Feather)/.test(src)
    || /(Ionicons|MaterialIcons|MaterialCommunityIcons|FontAwesome|AntDesign|Entypo)\b/.test(src);
  check(`${label}: Feather 외 아이콘 라이브러리 import 0`, !otherIconLib);
}

console.log('\n[E] 공통 — 44pt 터치영역 · refreshControl 규약');
check(
  'InlineDisclosure 헤더 44pt(StrategyComparisonSection)',
  /discHeader:\s*\{[^}]*minHeight:\s*44/s.test(comparisonSrc),
);
check(
  'InlineDisclosure 헤더 44pt(IntradayScalpSection)',
  /discHeader:\s*\{[^}]*minHeight:\s*44/s.test(scalpSrc),
);
check(
  'refreshControl 커스텀 래퍼 금지(refreshing/onRefresh 사용)',
  comparisonSrc.includes('refreshing={query.isRefetching}')
    && comparisonSrc.includes('onRefresh={query.refetch}')
    && !comparisonSrc.includes('refreshControl='),
);

console.log(`\n결과: ${pass} PASS · ${fail} FAIL`);
if (fail > 0) {
  console.error('FAILURES present');
  process.exit(1);
}
console.log('All checks passed');
