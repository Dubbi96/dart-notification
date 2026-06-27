/**
 * DAR-452 결정론 체크 — 기업 상세(app/company/[corpCode].tsx) 분봉 차트 접이식 + 인라인스타일/매직넘버 정리.
 *
 * E1: 회사카드+분봉이 탭 위 고정 → 전 탭 뷰포트 절반 잠식.
 *     해결 = 분봉 차트 기본 접힘(접힘 시 헤더 한 줄만 점유) + 토글로 펼침. 단일 수정으로 6개 탭 동시 개선.
 * E3: 탭별 pull-to-refresh — 이 파일에서 렌더하는 인라인 탭(공시/통계/적합도)은 RN 코어 <RefreshControl>만 사용.
 * E4: JSX 인라인 스타일·매직넘버(width:26 스페이서·gap:4·hitSlop 8 등) → StyleSheet/토큰 추출.
 *
 * 실행: npx -y tsx scripts/check-company-chart-collapsible.ts  (실패 시 exit 1)
 */
import { readFileSync } from 'fs';
import { join } from 'path';

const ROOT = join(__dirname, '..');
const page = readFileSync(join(ROOT, 'app/company/[corpCode].tsx'), 'utf8');

let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean) {
  if (cond) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    console.log(`  ✗ ${name}`);
  }
}
function count(re: RegExp): number {
  return (page.match(re) ?? []).length;
}

console.log('[1] E1 — 분봉 차트 접이식(기본 접힘 → 토글 펼침)');
ok('접힘 상태 기본값 false(useState)', /const \[isChartExpanded, setIsChartExpanded\] = useState\(false\)/.test(page));
ok('토글 핸들러 toggleChart(prev => !prev)', /const toggleChart = useCallback\(\(\) => setIsChartExpanded\(\(prev\) => !prev\)/.test(page));
ok('차트 헤더 토글 버튼 onPress=toggleChart', /onPress=\{toggleChart\}/.test(page));
ok('토글 a11y 상태 expanded 노출', /accessibilityState=\{\{ expanded: isChartExpanded \}\}/.test(page));
ok('토글 a11y 라벨 접기/펼치기', /isChartExpanded \? '분봉 차트 접기' : '분봉 차트 펼치기'/.test(page));
ok('chevron 상태 전환(down/right)', /isChartExpanded \? 'chevron-down' : 'chevron-right'/.test(page));
ok('펼칠 때만 MinuteCandleChart 렌더', /isChartExpanded \? \([\s\S]*?<MinuteCandleChart/.test(page));
ok('접힘 힌트 문구(탭하여 펼치기)', /탭하여 당일 분봉 차트 보기/.test(page));
ok('"크게 보기" 전체화면 진입점 유지(접힘 무관)', /크게 보기/.test(page) && /router\.push\(`\/stock\/\$\{company\.stockCode\}`\)/.test(page));

console.log('[2] E3 — 인라인 탭 RefreshControl(RN 코어, 커스텀 래퍼 금지)');
ok('RN 코어 <RefreshControl> 3개 이상(공시/통계/적합도)', count(/<RefreshControl/g) >= 3);
ok('refreshControl 커스텀 래퍼(App* 등) 미사용', !/refreshControl=\{<(?!RefreshControl)/.test(page));

console.log('[3] E4 — 인라인 스타일·매직넘버 제거(StyleSheet/토큰 추출)');
ok('인라인 스페이서 {width: 26} 제거', !/\{ width: 26 \}/.test(page));
// DAR-472: per-file 매직넘버 26 → 공용 sizing.icon.lg 토큰(값 보존). 상수명·소비처는 유지.
ok('헤더 아이콘 크기 상수 BACK_ICON_SIZE(=sizing.icon.lg)', /const BACK_ICON_SIZE = sizing\.icon\.lg/.test(page) && /size=\{BACK_ICON_SIZE\}/.test(page));
ok('헤더 스페이서 = 아이콘 크기 공유(중앙정렬)', /width: BACK_ICON_SIZE/.test(page));
ok('인라인 gap:4 제거 → chartExpandLink 토큰화', !/gap: 4/.test(page) && /gap: spacing\.xs/.test(page));
ok('인라인 hitSlop {top: 8 ...} 제거 → 토큰 상수', !/hitSlop=\{\{ top: 8/.test(page));
// DAR-472: 접기 토글은 CHART_TOUCH_HIT_SLOP(시각≈26pt+24=50pt) 유지. "크게 보기" 링크는
// 시각 16pt라 기존 토큰으론 40pt<44pt 였어서 verticalHitSlopForHeight 로 정확히 44pt 보정.
ok('접기 토글 hitSlop 토큰 상수', /const CHART_TOUCH_HIT_SLOP = /.test(page) && count(/hitSlop=\{CHART_TOUCH_HIT_SLOP\}/g) >= 1);
ok('"크게 보기" 링크 44pt 세로 보정(verticalHitSlopForHeight)', /hitSlop=\{verticalHitSlopForHeight\(CHART_LINK_VISUAL_HEIGHT\)\}/.test(page) && /const CHART_LINK_VISUAL_HEIGHT = 16/.test(page));
ok('탭 칩 hitSlop 토큰 상수', /const TAB_CHIP_HIT_SLOP = /.test(page) && /hitSlop=\{TAB_CHIP_HIT_SLOP\}/.test(page));
ok('차트 헤더 구조 스타일 추출(chartHeader/chartToggle/chartExpandLink)', /chartHeader: \{/.test(page) && /chartToggle: \{/.test(page) && /chartExpandLink: \{/.test(page));
ok('표 셀 스타일 추출 + 4회 사용(인라인 {flex:1,alignItems} 제거)', /tableCell: \{/.test(page) && count(/styles\.tableCell/g) === 4);
ok('하단 스페이서 스타일 추출 + 3회 사용', /bottomSpacer: \{/.test(page) && count(/styles\.bottomSpacer/g) === 3);
ok('미사용 import StockPriceBadge 제거', !/StockPriceBadge/.test(page));

console.log(`\n결과: ${pass} pass / ${fail} fail`);
process.exit(fail === 0 ? 0 : 1);
