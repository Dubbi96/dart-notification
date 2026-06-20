/**
 * DAR-388 결정론적 검증: 1년 자동매매 백테스트 트랙레코드 모바일 화면.
 *
 * 정적 소스 바인딩 검증(런타임 무관·결정론):
 * 1) 서비스(backtest.service.ts): getTrackRecord → GET /backtest/track-record, null graceful.
 * 2) 훅(useBacktestTrackRecord.ts): 안정 queryKey, 폴링 없음(staleTime 만), getTrackRecord 호출.
 * 3) 타입(backtest.types.ts): BacktestTrackRecord/BacktestMetrics/byEventType 계약.
 * 4) 화면(app/portfolio/backtest-track-record.tsx): 헤더 요약(기간·초기자본·총수익률 색조·승률),
 *    EquityCurveChart 재사용(매핑), 핵심지표 6+종, byEventType 리스트, 정직 라벨, 로딩/빈/에러 graceful.
 * 5) 진입점(app/portfolio/auto-trading.tsx): 트랙레코드 화면으로 라우팅.
 * 6) 라우트 등록(app/_layout.tsx): portfolio/backtest-track-record Stack.Screen.
 *
 * 실행: npx -y tsx@4 scripts/check-backtest-track-record.ts  (실패 시 exit 1)
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

function main() {
  const root = join(__dirname, '..');

  // ── 1) 서비스 ────────────────────────────────────────────────────
  const service = readFileSync(join(root, 'services', 'backtest.service.ts'), 'utf8');
  console.log('services/backtest.service.ts');
  assert('getTrackRecord 메서드', /getTrackRecord:\s*\(/.test(service));
  assert('GET /backtest/track-record', /'\/backtest\/track-record'/.test(service));
  assert('BacktestTrackRecord | null 응답(graceful)', /BacktestTrackRecord\s*\|\s*null/.test(service));

  // ── 2) 훅 ────────────────────────────────────────────────────────
  const hook = readFileSync(join(root, 'hooks', 'useBacktestTrackRecord.ts'), 'utf8');
  console.log('hooks/useBacktestTrackRecord.ts');
  assert('안정 queryKey(backtest-track-record)', /queryKey:\s*\['backtest-track-record'\]/.test(hook));
  assert('getTrackRecord 호출', /backtestService\.getTrackRecord\(\)/.test(hook));
  assert('폴링 없음(refetchInterval 미지정)', !/refetchInterval/.test(hook));
  assert('staleTime 설정', /staleTime/.test(hook));

  // ── 3) 타입 ──────────────────────────────────────────────────────
  const types = readFileSync(join(root, 'types', 'backtest.types.ts'), 'utf8');
  console.log('types/backtest.types.ts');
  assert('BacktestTrackRecord 인터페이스', /interface BacktestTrackRecord/.test(types));
  assert('BacktestMetrics 인터페이스', /interface BacktestMetrics/.test(types));
  assert('byEventType: Record<string, BacktestGroupMetrics>', /byEventType:\s*Record<string,\s*BacktestGroupMetrics>/.test(types));
  assert('equityCurve: BacktestEquityPoint[]', /equityCurve:\s*BacktestEquityPoint\[\]/.test(types));
  assert('% 0~100 스케일 명시(정직 주석)', /0~100\s*스케일/.test(types));

  // ── 4) 화면 ──────────────────────────────────────────────────────
  const screen = readFileSync(
    join(root, 'app', 'portfolio', 'backtest-track-record.tsx'),
    'utf8',
  );
  console.log('app/portfolio/backtest-track-record.tsx');
  assert('useBacktestTrackRecord 소비', /useBacktestTrackRecord\(\)/.test(screen));
  assert('헤더: 기간(startDate~endDate)', /record\.startDate/.test(screen) && /record\.endDate/.test(screen));
  assert('헤더: 초기자본', /initialCapital/.test(screen));
  assert('헤더: 총수익률 색조(pnlColor)', /pnlColor\(m\.totalReturn/.test(screen));
  assert('헤더: 승률 대형', /winRate/.test(screen));
  assert('EquityCurveChart 재사용', /<EquityCurveChart\b/.test(screen));
  assert('자산곡선 매핑(date→snapshotDate)', /snapshotDate:\s*compactDate\(p\.date\)/.test(screen));
  assert('핵심지표: profitFactor', /profitFactor/.test(screen));
  assert('핵심지표: MDD', /metrics\.mdd/.test(screen));
  assert('핵심지표: Sharpe', /metrics\.sharpe/.test(screen));
  assert('핵심지표: 평균보유', /avgHoldDays/.test(screen));
  assert('이벤트유형별 성과(byEventType)', /byEventType/.test(screen) && /getEventTypeLabel/.test(screen));
  assert('★정직: point-in-time 미래정보 미사용', /미래정보 미사용/.test(screen));
  assert('★정직: 커버리지 점진 채움 고지', /커버리지가 채워집/.test(screen));
  assert('★정직: 손실 그대로 표시', /손실도 그대로 표시/.test(screen));
  assert('로딩 graceful', /query\.isLoading/.test(screen) && /LoadingState/.test(screen));
  assert('에러 graceful', /query\.isError/.test(screen) && /ApiErrorState/.test(screen));
  assert('빈 상태 graceful(record/metrics 가드)', /!record\s*\|\|\s*!record\.metrics/.test(screen) && /EmptyState/.test(screen));
  assert('접근성 라벨(accessibilityLabel) 사용', /accessibilityLabel=/.test(screen));
  assert('하드코딩 색상 0(rgb/# 리터럴 없음)', !/#[0-9a-fA-F]{3,6}\b/.test(screen) && !/rgb\(/.test(screen));

  // ── 5) 진입점 ────────────────────────────────────────────────────
  const entry = readFileSync(join(root, 'app', 'portfolio', 'auto-trading.tsx'), 'utf8');
  console.log('app/portfolio/auto-trading.tsx');
  assert('트랙레코드 라우팅', /router\.push\('\/portfolio\/backtest-track-record'\)/.test(entry));
  assert('진입 카드 렌더', /<TrackRecordEntryCard\s*\/>/.test(entry));
  assert('진입 버튼 접근성(44pt·role)', /minHeight:\s*44/.test(entry) && /accessibilityRole="button"/.test(entry));

  // ── 6) 라우트 등록 ───────────────────────────────────────────────
  const layout = readFileSync(join(root, 'app', '_layout.tsx'), 'utf8');
  console.log('app/_layout.tsx');
  assert('Stack.Screen 등록', /name="portfolio\/backtest-track-record"/.test(layout));

  console.log('');
  if (failures > 0) {
    console.error(`FAILED: ${failures} assertion(s)`);
    process.exit(1);
  }
  console.log('All checks passed.');
}

main();
