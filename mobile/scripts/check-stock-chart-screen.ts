/**
 * DAR-355 결정론적 검증: 전용 종목 차트 화면(풀스크린 분봉/현재가) + 진입점 3곳.
 *
 * 정적 소스 바인딩 검증(런타임 무관·결정론):
 * 1) 화면(app/stock/[stockCode].tsx): QuoteHeader·MinuteCandleChart·useMinuteCandles·useStockQuotes
 *    조립, 폴링 게이트(resolveQuotePollInterval)·★정직 라벨·타임프레임 토글·일봉 '준비중'.
 * 2) 진입점: company 상세·신호 상세·관심목록이 실제로 `/stock/{code}` 로 라우팅.
 *
 * 실행: npx -y tsx@4 scripts/check-stock-chart-screen.ts  (실패 시 exit 1)
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

  // ── 1) 전용 차트 화면 ─────────────────────────────────────────────
  const screen = readFileSync(join(root, 'app', 'stock', '[stockCode].tsx'), 'utf8');
  console.log('app/stock/[stockCode].tsx');
  assert('라우트 파라미터(useLocalSearchParams<{ stockCode }>)', /useLocalSearchParams<\{\s*stockCode:\s*string\s*\}>/.test(screen));
  assert('QuoteHeader 임포트', /import \{ QuoteHeader \} from '@components\/common\/QuoteHeader'/.test(screen));
  assert('MinuteCandleChart 임포트', /import \{ MinuteCandleChart \} from '@components\/company\/MinuteCandleChart'/.test(screen));
  assert('useMinuteCandles 임포트', /import \{ useMinuteCandles \} from '@hooks\/useMinuteCandles'/.test(screen));
  assert('useStockQuotes 임포트', /import \{ useStockQuotes \} from '@hooks\/useStockQuotes'/.test(screen));
  assert('QuoteHeader 렌더(quote·updatedAt 주입)', /<QuoteHeader\s+quote=\{quote\}\s+updatedAt=\{quoteUpdatedAt\}/.test(screen));
  assert('MinuteCandleChart 렌더(candles 주입)', /<MinuteCandleChart\b[\s\S]*candles=\{minuteCandles\}/.test(screen));
  assert('분봉 폴링(pollWhileMarketOpen: true)', /useMinuteCandles\(code,\s*\{\s*pollWhileMarketOpen:\s*true\s*\}\)/.test(screen));
  assert('시세 폴링 게이트(resolveQuotePollInterval)', /resolveQuotePollInterval\(\{/.test(screen));
  assert('게이트 입력(포커스·활성·now·간격)', /isFocused,[\s\S]*appActive,[\s\S]*now: new Date\(\),[\s\S]*intervalMs: QUOTE_POLL_INTERVAL_MS,/.test(screen));
  assert('refetchInterval 게이팅 전달', /refetchInterval:\s*quotePollInterval/.test(screen));
  assert('15s 폴링 상수', /QUOTE_POLL_INTERVAL_MS = 15 \* 1000/.test(screen));
  assert('useFocusEffect·AppState 게이트', /useFocusEffect/.test(screen) && /AppState\.addEventListener/.test(screen));
  assert('타임프레임 토글(SegmentedButtons minute/daily)', /<SegmentedButtons/.test(screen) && /value:\s*'minute'/.test(screen) && /value:\s*'daily'/.test(screen));
  // DAR-384: 일봉 탭 '준비중' 플레이스홀더 → 실제 일봉 차트(DailyCandleChart)로 교체.
  assert('일봉 실제 차트(DailyCandleChart, 준비중 placeholder 제거)', /<DailyCandleChart\b/.test(screen) && !/일봉 준비중/.test(screen));
  assert('★정직: 실시간 시장가 고지 1줄', /실시간 시장가 —/.test(screen));
  assert('렌더에서 Date.now 직접 호출 안 함(purity, now=new Date())', !/Date\.now\(/.test(screen));

  // ── 2) 진입점 3곳 ────────────────────────────────────────────────
  const company = readFileSync(join(root, 'app', 'company', '[corpCode].tsx'), 'utf8');
  console.log('app/company/[corpCode].tsx');
  assert('company: /stock/{stockCode} 라우팅', /router\.push\(`\/stock\/\$\{company\.stockCode\}`\)/.test(company));
  assert('company: 차트 진입 라벨(크게 보기)', /크게 보기/.test(company));

  const signal = readFileSync(join(root, 'app', 'signals', '[id].tsx'), 'utf8');
  console.log('app/signals/[id].tsx');
  assert('signals: /stock/{ticker} 라우팅', /router\.push\(`\/stock\/\$\{signal\.ticker\}`\)/.test(signal));
  assert('signals: 6자리 종목코드 가드(graceful)', /signal\.ticker && \/\^\\d\{6\}\$\/\.test\(signal\.ticker\)/.test(signal));

  const watchlist = readFileSync(join(root, 'app', 'settings-detail', 'watchlist.tsx'), 'utf8');
  console.log('app/settings-detail/watchlist.tsx');
  assert('watchlist: /stock/{stockCode} 라우팅', /router\.push\(`\/stock\/\$\{stockCode\}`\)/.test(watchlist));
  assert('watchlist: onChartPress 행 콜백 배선', /onChartPress=\{handleChartNavigate\}/.test(watchlist));
  assert('watchlist: 종목코드 있을 때만 차트 버튼(graceful)', /item\.stockCode \? \(/.test(watchlist) && /onPress=\{handleChart\}/.test(watchlist));

  if (failures > 0) {
    console.error(`\n${failures}개 실패`);
    process.exit(1);
  }
  console.log('\n모두 통과');
}

main();
