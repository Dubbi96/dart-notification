/**
 * DAR-358 결정론적 검증: 모의 성과 헤더 간결화 — 7+ 섹션 워터폴 → 핵심 3카드 + 점진적 공개.
 *
 * 종전 SummaryHeader 는 [배너·평가요약·에쿼티커브·졸업지표(4행 MetricRow)·성과리포트
 * 드릴다운 카드·철학체크 드릴다운 카드·보유 포지션 라벨]로 7+ Surface/섹션이 세로로
 * 쌓였고, 사용자가 즉시 원하는 승률·누적수익률이 4번째 카드(MetricRow 묶음)에 묻혔다.
 *
 * 재설계(이 PR):
 *  - 카드 ① 핵심: 평가금액 + 손익 칩(=누적수익률) + 승률(신호 적중률 D+5)을 진입 즉시 노출.
 *  - 카드 ② 자산곡선(async 논블로킹 유지).
 *  - 카드 ③ 상세 검증 지표(구 '상세 졸업지표' — UXR-4 C-2 사용자 어휘 치환): 접이(More) 점진적 공개 — 기본 접힘.
 *  - 드릴다운(성과 리포트·철학 체크): 인라인 카드 → 푸터 바(경량 버튼)로 강등.
 *  - '보유 포지션' 라벨: 리스트 헤더로 시각 축소(typo.small textSecondary + 카운트).
 *
 * 정적 분석으로 시각을 직접 못 보므로, 소스 바인딩으로 위 구조 불변식을 고정한다.
 * 실행: npx tsx scripts/check-sim-header-simplify.ts  (실패 시 exit 1)
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

let failed = 0;
function check(label: string, got: unknown, want: unknown): void {
  const ok = got === want;
  if (!ok) failed += 1;
  console.log(
    `${ok ? 'PASS' : 'FAIL'} | ${label} | got=${JSON.stringify(got)} want=${JSON.stringify(want)}`,
  );
}

const src = readFileSync(
  join(__dirname, '..', 'components', 'portfolio', 'SimulationStatusSection.tsx'),
  'utf8',
);

// 헤더 본문(SummaryHeader)만 추출해 분석 — PositionRow 등 다른 섹션 잡음 제거
const headerStart = src.indexOf('function SummaryHeader');
const headerEnd = src.indexOf('export function SimulationStatusSection');
check('SummaryHeader 본문 추출 성공', headerStart > -1 && headerEnd > headerStart, true);
const header = src.slice(headerStart, headerEnd);

// 1) 카드 수 평탄화 — Surface(카드) 3개: 핵심 + (EquityCurveCard는 별도 함수) + 상세지표 접이.
//    SummaryHeader 직접 렌더하는 Surface 는 2개(핵심·상세지표), 자산곡선은 <EquityCurveCard/>.
const surfaceCount = (header.match(/<Surface\b/g) ?? []).length;
check('SummaryHeader 직접 Surface 2개(핵심+상세지표)', surfaceCount, 2);
check('자산곡선 카드 컴포넌트 연결 유지', /<EquityCurveCard\s*\/>/.test(header), true);

// 2) 진입 즉시 핵심지표(승률 + 누적수익률) 가독.
//    누적수익률 = 상단 손익 칩(PriceChangeChip value=cumulativeReturnPct), 승률 = 인라인 키지표.
check(
  '핵심카드 손익 칩이 누적수익률(cumulativeReturnPct) 사용',
  /<PriceChangeChip\s+value=\{metrics\.cumulativeReturnPct\}\s+amount=\{metrics\.netPnl\}/.test(header),
  true,
);
check('핵심카드에 신호 적중률(D+5) 인라인 노출', /신호 적중률\(D\+5\)/.test(header), true);
check('승률 인라인 keyMetric 스타일 사용', /styles\.keyMetric/.test(header), true);
// 승률(hitRateD5)이 접이(상세지표) 이전, 즉 핵심카드 영역에 위치하는지 순서로 확인
const hitRateIdx = header.indexOf('신호 적중률(D+5)');
const collapseIdx = header.indexOf('상세 검증 지표');
check('승률이 접이 섹션보다 위(즉시 노출)', hitRateIdx > -1 && hitRateIdx < collapseIdx, true);

// 3) 점진적 공개 — 접이 토글 상태 + 기본 접힘(useState false) + 펼침 조건부 렌더
check('useState import', /import React, \{[^}]*\buseState\b/.test(src), true);
check('접이 상태 기본 접힘(false)', /useState\(false\)/.test(header), true);
check('펼침 시에만 상세지표 렌더(metricsExpanded 조건부)', /metricsExpanded\s*\?/.test(header), true);
check('접이 토글 accessibilityState expanded', /accessibilityState=\{\{\s*expanded:\s*metricsExpanded\s*\}\}/.test(header), true);

// 4) 드릴다운 강등 — 인라인 카드(DrilldownLink) 제거, 푸터 바(FooterLink) 도입.
check('인라인 DrilldownLink 카드 컴포넌트 제거', /function DrilldownLink/.test(src), false);
check('푸터 링크 컴포넌트 도입', /function FooterLink/.test(src), true);
check('푸터 바 컨테이너 사용', /styles\.footerBar/.test(header), true);
check('성과 리포트 진입점 유지(trade-history)', /router\.push\('\/portfolio\/trade-history'\)/.test(header), true);
check('철학 체크 진입점 유지(/philosophy)', /router\.push\('\/philosophy'\)/.test(header), true);

// 5) 보유 포지션 라벨 시각 축소 — captionMedium → small + textSecondary, 카운트 동반.
check('보유 포지션 라벨 존재', /보유 포지션 \{positionCount\}/.test(header), true);
// 라벨 Text 의 style 에 typo.small + textSecondary 가 직접 바인딩되었는지(축소) 확인
check(
  '보유 포지션 라벨 small + textSecondary 로 축소',
  /typo\.small,\s*\{\s*color:\s*colors\.textSecondary[^}]*\}\][^>]*>\s*보유 포지션 \{positionCount\}/.test(header),
  true,
);
// 종전 captionMedium(굵은 섹션 헤더) 라벨이 아님을 음성 대조로 고정
check(
  '보유 포지션 라벨이 captionMedium(종전 강조) 아님',
  /typo\.captionMedium[^>]*>\s*보유 포지션\s*</.test(header),
  false,
);

// 6) 회귀 — 리스트 안정성 불변식 유지(keyExtractor corpCode, refreshing/onRefresh).
check('keyExtractor corpCode 유지', /keyExtractor=\{\(item\) => item\.corpCode\}/.test(src), true);
// UXR-4 C-1: onRefresh 가 status 만 refetch 하면 '자산곡선 최신점과 동일' 단언이 스스로 깨짐 →
// 형제 쿼리(equity-curve)까지 일괄 refetch 하는 handleRefresh 로 교체(커스텀 refreshControl 은 여전히 금지).
check('refreshing/onRefresh props 유지(커스텀 refreshControl 금지)', /refreshing=\{isRefreshing\}/.test(src) && /onRefresh=\{handleRefresh\}/.test(src), true);
check(
  '당겨 새로고침이 형제 쿼리(status+equity-curve) 동시 갱신(UXR-4 C-1)',
  /\['simulation', 'status'\]/.test(src) &&
    /\['simulation', 'equity-curve'\]/.test(src) &&
    /queryClient\.refetchQueries\(/.test(src),
  true,
);
check('면책 배너(정직 라벨) 유지', /실제 주문이 아닙니다/.test(header), true);
check('async 자산곡선 논블로킹(EquityCurveCard 내부 로딩/에러 처리) 유지', /자산곡선 불러오는 중/.test(src), true);

if (failed > 0) {
  console.error(`\n${failed} check(s) FAILED`);
  process.exit(1);
}
console.log('\nAll checks passed.');
