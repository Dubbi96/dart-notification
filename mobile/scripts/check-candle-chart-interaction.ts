/**
 * DAR-458 결정론 검증: 캔들차트 장기구간 인터랙션(E6) + 정직 카피 평이화(E7) + 화면 고지 중복 제거(E7/E2).
 *
 * 정적 소스 바인딩 검증(런타임 무관·결정론):
 * 1) Daily/MinuteCandleChart.tsx (E6):
 *    - 구 per-candle 탭 히트영역(onPress 슬롯 Rect, ≈1px) 제거 → 전폭 가로 스크럽 오버레이
 *      (onStartShouldSetResponder + onResponderGrant/Move, locationX→가장 가까운 인덱스) + 크로스헤어 점선.
 *    - 스크린리더용 adjustable a11y(증/감 액션 = 한 칸 이동).
 * 2) Daily/MinuteCandleChart.tsx (E7): '앱 환경 시계' 구현용어 미노출, 사용자 언어 카피.
 * 3) stock/[stockCode].tsx (E7/E2): 화면 상단 중복 고지 배너 제거(QuoteHeader 배지 + 각 차트 단독 노출).
 *
 * + 순수 로직 대조군: indexFromX(locationX → clamp(round((x-PAD.left)/slotW - 0.5), 0, n-1)).
 *
 * 실행: npx -y tsx@4 scripts/check-candle-chart-interaction.ts  (실패 시 exit 1)
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

let failures = 0;
function assert(name: string, cond: boolean, detail = '') {
  if (cond) {
    console.log(`  ✓ ${name}`);
  } else {
    failures += 1;
    console.error(`  ✗ ${name} ${detail}`);
  }
}

/** 차트 컴포넌트 공통 검증(분봉·일봉 동일 인터랙션 규약). */
function assertChart(label: string, src: string) {
  console.log(label);
  // E6 — 구 탭 히트영역(슬롯 폭 ≈1px) 제거
  assert('  구 per-candle 탭 히트영역 제거(onPress 슬롯 Rect 없음)', !/onPress=\{\(\) => setSelected\(i\)\}/.test(src));
  // E6 — 전폭 가로 스크럽 오버레이
  assert('  스크럽 오버레이(onStartShouldSetResponder)', /onStartShouldSetResponder=\{\(\) => true\}/.test(src));
  assert('  스크럽 grant/move 핸들러 배선', /onResponderGrant=\{handleScrub\}/.test(src) && /onResponderMove=\{handleScrub\}/.test(src));
  assert('  전체 높이(≥44pt) 터치영역(absoluteFill)', /style=\{StyleSheet\.absoluteFill\}/.test(src));
  // E6 — locationX → 인덱스
  assert('  locationX → 가장 가까운 인덱스(indexFromX)', /indexFromX/.test(src) && /e\.nativeEvent\.locationX/.test(src));
  assert('  인덱스 clamp(0..n-1)', /Math\.min\(n - 1, Math\.max\(0, raw\)\)/.test(src));
  // E6 — 크로스헤어 시각화
  assert('  크로스헤어 세로 점선(strokeDasharray)', /strokeDasharray="3 3"/.test(src));
  assert('  종가 마커 Circle', /<Circle\b/.test(src));
  // E6 — a11y adjustable(스크린리더 스크럽 대체)
  assert('  adjustable role + 증/감 액션', /accessibilityRole="adjustable"/.test(src) && /name: 'increment'/.test(src) && /name: 'decrement'/.test(src));
  assert('  a11y 액션 핸들러 배선', /onAccessibilityAction=\{handleA11yAction\}/.test(src) && /actionName === 'increment'/.test(src));
  assert('  a11y 현재 선택값 평문(accessibilityValue)', /accessibilityValue=\{\{ text:/.test(src));
  // E7 — 구현용어 미노출
  assert('  구현용어 미노출(앱 환경 시계 제거)', !/앱 환경 시계/.test(src));
  // 렌더 purity
  assert('  렌더 purity(Date.now 직접 호출 없음)', !/Date\.now\(/.test(src));
}

function main() {
  const root = join(__dirname, '..');

  const minute = readFileSync(join(root, 'components', 'company', 'MinuteCandleChart.tsx'), 'utf8');
  assertChart('components/company/MinuteCandleChart.tsx', minute);
  assert('  E7 평이 카피(실시간 시세 기준)', /실시간 시세 기준/.test(minute));
  assert('  스크럽 안내 문구(좌우로 문지르면)', /좌우로 문지르면/.test(minute));

  const daily = readFileSync(join(root, 'components', 'company', 'DailyCandleChart.tsx'), 'utf8');
  assertChart('components/company/DailyCandleChart.tsx', daily);
  assert('  E7 평이 카피(거래일 종가 기준)', /거래일 종가 기준/.test(daily));
  assert('  source 라벨 유지(KRX 일봉 장 마감 종가)', /KRX 일봉\(장 마감 종가\)/.test(daily));
  assert('  스크럽 안내 문구(좌우로 문지르면)', /좌우로 문지르면/.test(daily));

  // E7/E2 — 화면 상단 중복 고지 배너 제거
  const screen = readFileSync(join(root, 'app', 'stock', '[stockCode].tsx'), 'utf8');
  console.log('app/stock/[stockCode].tsx');
  assert('  E7/E2 화면 상단 중복 고지 배너 제거(실시간 시장가 — 없음)', !/실시간 시장가 —/.test(screen));
  assert('  QuoteHeader 단독 framing 유지', /<QuoteHeader\b/.test(screen));
  assert('  각 차트 정직 고지 단독 소스(Min/DailyCandleChart 렌더)', /<MinuteCandleChart\b/.test(screen) && /<DailyCandleChart\b/.test(screen));

  // ── 순수 로직 대조군: locationX → 인덱스 ──────────────────────────────
  console.log('indexFromX 대조군(스크럽 X → 가장 가까운 캔들)');
  const PADleft = 8;
  const plotW = 300;
  const n = 250; // 1Y/전체 장기구간
  const slotW = plotW / n;
  const indexFromX = (x: number) => {
    const raw = Math.round((x - PADleft) / slotW - 0.5);
    return Math.min(n - 1, Math.max(0, raw));
  };
  // 첫 슬롯 중앙 → 0
  assert('  첫 슬롯 중앙 → 0', indexFromX(PADleft + slotW * 0.5) === 0);
  // 마지막 슬롯 중앙 → n-1
  assert('  마지막 슬롯 중앙 → n-1', indexFromX(PADleft + slotW * (n - 0.5)) === n - 1);
  // 왼쪽 경계 밖 → 0 clamp
  assert('  좌측 경계 밖 → 0 clamp', indexFromX(-100) === 0);
  // 오른쪽 경계 밖 → n-1 clamp
  assert('  우측 경계 밖 → n-1 clamp', indexFromX(99999) === n - 1);
  // 중앙 근방 단조: 큰 x → 큰(또는 같은) 인덱스
  assert('  단조(좌→우 인덱스 증가)', indexFromX(PADleft + 100) <= indexFromX(PADleft + 200));
  // 임의 슬롯 k의 중앙 → k (촘촘해도 정확 선택)
  const k = 137;
  assert('  슬롯 k 중앙 → k(가는 캔들도 정확 선택)', indexFromX(PADleft + slotW * (k + 0.5)) === k);

  if (failures > 0) {
    console.error(`\n${failures}개 실패`);
    process.exit(1);
  }
  console.log('\n모두 통과');
}

main();
