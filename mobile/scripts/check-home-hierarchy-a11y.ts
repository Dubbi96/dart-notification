// DAR-446 결정론 검증: 홈 화면 정보위계 재배치 + 게스트 게이팅 + 내부용어 제거 + 접근성.
// 정본: docs/roadmap/cc-ui-ux-audit-2026-06-27.md (A-HOME-1~6, A-MKT-1).
// 소스 정적 검사(RN 런타임 import 회피) — 각 수용 기준을 1:1로 단정한다.
import { readFileSync } from 'fs';
import { join } from 'path';

const root = join(__dirname, '..');
const homeSrc = readFileSync(join(root, 'app/(tabs)/home/index.tsx'), 'utf8');
const gradSrc = readFileSync(join(root, 'components/home/GraduationTracker.tsx'), 'utf8');
const funnelSrc = readFileSync(join(root, 'components/home/EntryFunnelSection.tsx'), 'utf8');
const cardSrc = readFileSync(join(root, 'components/home/DisclosureFeedCard.tsx'), 'utf8');
const mktSrc = readFileSync(join(root, 'components/home/MarketIndexBadge.tsx'), 'utf8');

// 주석(//, /* */, {/* */})을 제거해 '렌더되는 UI 문자열'만 대상으로 내부용어를 검사한다.
// (제거 노트 주석에 의도적으로 등장하는 용어가 오탐을 일으키지 않도록.)
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
}

// 본문에서 [startMarker, endMarker) 구간을 추출.
function slice(src: string, startMarker: string, endMarker: string): string {
  const s = src.indexOf(startMarker);
  if (s < 0) throw new Error(`marker not found: ${startMarker}`);
  const rest = src.slice(s + startMarker.length);
  const e = rest.indexOf(endMarker);
  return e < 0 ? rest : rest.slice(0, e);
}

let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean) {
  if (cond) {
    pass++;
    console.log(`  ok  ${name}`);
  } else {
    fail++;
    console.log(`  FAIL ${name}`);
  }
}

// ── 구간 추출 ──────────────────────────────────────────────────────────────
const listHeaderBlock = slice(homeSrc, 'const ListHeader = useCallback(', 'const ListEmpty = useCallback(');
const listFooterBlock = slice(homeSrc, 'const ListFooter = useCallback(', 'return (');
const summaryBlock = slice(homeSrc, '<View style={styles.summaryContent}>', '</GlassCard>');

// ── A-HOME-2: 헤더 축소 + 공시/신호 상단, 졸업/퍼널은 헤더에서 제거 ─────────────
ok('A-HOME-2: ListHeader 에 GraduationTracker 없음(피드 위 강등 제거)', !/<GraduationTracker/.test(listHeaderBlock));
ok('A-HOME-2: ListHeader 에 HomeSignalPreview 존재(신호 프리뷰 상단)', /<HomeSignalPreview/.test(listHeaderBlock));
ok('A-HOME-2: ListHeader 에 MarketIndexBadge 존재', /<MarketIndexBadge/.test(listHeaderBlock));
{
  // 시장배지·신호프리뷰가 세그먼트(공시 피드 헤더)보다 먼저 와야 한다.
  const idxMarket = listHeaderBlock.indexOf('<MarketIndexBadge');
  const idxSignal = listHeaderBlock.indexOf('<HomeSignalPreview');
  const idxSegment = listHeaderBlock.indexOf('styles.segmentControl');
  ok('A-HOME-2: 시장배지 → 신호프리뷰 → 세그먼트 순서 보존', idxMarket < idxSignal && idxSignal < idxSegment);
}

// ── A-HOME-3: 게스트 게이팅 — 운용 성과(졸업/퍼널)는 footer + isAuthenticated 게이트 ──
ok('A-HOME-3: GraduationTracker 는 ListFooter 에서 렌더', /<GraduationTracker/.test(listFooterBlock));
ok('A-HOME-3: footer 의 GraduationTracker 는 isAuthenticated 게이트', /isAuthenticated\s*\?[\s\S]*<GraduationTracker/.test(listFooterBlock));
// 회귀: 페이지네이션 스피너(ActivityIndicator) 유지.
ok('regression: footer 에 페이지네이션 ActivityIndicator 유지', /isFetchingNextPage\s*\?[\s\S]*ActivityIndicator/.test(listFooterBlock));

// ── A-HOME-4: 세 통계 모두 accessibilityRole/Label ─────────────────────────────
{
  const roleCount = (summaryBlock.match(/accessibilityRole="button"/g) ?? []).length;
  const labelCount = (summaryBlock.match(/accessibilityLabel=/g) ?? []).length;
  ok('A-HOME-4: 요약 통계 3개 모두 accessibilityRole="button"', roleCount === 3);
  ok('A-HOME-4: 요약 통계 3개 모두 accessibilityLabel', labelCount === 3);
  // 기존 누락분(관심 기업·저장된 공시) 라벨 명시 확인.
  ok('A-HOME-4: 관심 기업 통계 라벨 존재', /관심 기업 목록 열기/.test(summaryBlock));
  ok('A-HOME-4: 저장된 공시 통계 라벨 존재', /저장한 공시 열기/.test(summaryBlock));
}

// ── A-HOME-5: 핵심 수치 amount 토큰 강조(이름 h2보다 큰 위계) ───────────────────
{
  const amountCount = (summaryBlock.match(/typo\.amount/g) ?? []).length;
  ok('A-HOME-5: 요약 수치 3개 모두 typo.amount 사용', amountCount === 3);
  ok('A-HOME-5: 요약 수치에 typo.h2 미사용(위계 약화 회귀 차단)', !/typo\.h2,\s*\{ color: colors\.onColor \}\]\}>\{(disclosures|watchlist|saved)Count/.test(summaryBlock));
}

// ── A-HOME-6: 공시 피드 카드 role="button" + 요약 라벨 ─────────────────────────
ok('A-HOME-6: DisclosureFeedCard TouchableOpacity accessibilityRole="button"', /<TouchableOpacity[\s\S]*?accessibilityRole="button"/.test(cardSrc));
ok('A-HOME-6: DisclosureFeedCard accessibilityLabel(요약) 존재', /accessibilityLabel=\{accessibilityLabel\}/.test(cardSrc) && /공시 상세 보기/.test(cardSrc));
ok('A-HOME-6: 카드 내부 텍스트 no-hide-descendants 그룹핑', /importantForAccessibility="no-hide-descendants"/.test(cardSrc));

// ── A-MKT-1: 로딩 시 고정 높이 스켈레톤 자리표시(점프 제거) ──────────────────────
ok('A-MKT-1: useMarketIndices 에서 isLoading 구독', /const \{ data, isLoading \} = useMarketIndices\(\)/.test(mktSrc));
ok('A-MKT-1: MarketIndexBadgeSkeleton 컴포넌트 정의', /function MarketIndexBadgeSkeleton\(\)/.test(mktSrc));
ok('A-MKT-1: 로딩 시 스켈레톤 반환', /if \(isLoading\) return <MarketIndexBadgeSkeleton \/>/.test(mktSrc));
ok('A-MKT-1: 스켈레톤은 실제 배지와 동일 카드(styles.card) 골격', /MarketIndexBadgeSkeleton[\s\S]*?styles\.card/.test(mktSrc));

// ── A-HOME-1: 1차 표면 내부용어 0건 — 평이어 치환 ─────────────────────────────
{
  const gradUi = stripComments(gradSrc);
  const funnelUi = stripComments(funnelSrc);
  const homeUi = stripComments(homeSrc);
  // 금지 내부용어(렌더 문자열 기준).
  const banned = ['졸업', 'Main Thesis', 'M10', '결승선', 'Sharpe', '위험조정'];
  for (const term of banned) {
    ok(`A-HOME-1: GraduationTracker UI 에 '${term}' 미노출`, !gradUi.includes(term));
  }
  ok("A-HOME-1: EntryFunnelSection UI 에 '퍼널' 미노출", !funnelUi.includes('퍼널'));
  ok("A-HOME-1: home ListHeader 주석 외 UI 에 'Main Thesis' 미노출", !homeUi.includes('Main Thesis'));
  // 평이어 치환 확인(positive).
  ok("A-HOME-1: GraduationTracker '운용 성과' 평이어 노출", gradUi.includes('운용 성과'));
  ok("A-HOME-1: GraduationTracker '위험 대비 수익' 평이어 노출", gradUi.includes('위험 대비 수익'));
  ok("A-HOME-1: EntryFunnelSection '신호에서 체결까지' 평이어 노출", funnelUi.includes('신호에서 체결까지'));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
