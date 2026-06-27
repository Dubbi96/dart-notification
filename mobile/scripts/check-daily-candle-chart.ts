/**
 * DAR-384 결정론적 검증: 백필 일봉(StockDailyPrice) 화면 연동.
 *
 * 정적 소스 바인딩 검증(런타임 무관·결정론):
 * 1) 서비스(market-quote.service.ts): getDailyCandles → GET /market-data/candles?resolution=1d,
 *    6자리 가드(UNAVAILABLE graceful), limit/from/to 파라미터 전달.
 * 2) 훅(useDailyCandles.ts): 구간 프리셋(3M/1Y/ALL) limit 환산, 폴링 없음(EOD), 안정 queryKey.
 * 3) 일봉 차트(DailyCandleChart.tsx): CandleSeriesPoint 소비, source/asOf 정직 라벨, 로딩/빈/에러
 *    graceful, 거래일 날짜 라벨(KST 환산), 색 단독 금지(평문 병기).
 * 4) 화면(app/stock/[stockCode].tsx): 일봉 탭이 DailyCandleChart 렌더 + 구간 선택(3M/1Y/전체),
 *    '준비중' placeholder 제거.
 * 5) 타입(market-quote.types.ts): CandleSeriesResult source 'EOD' 포함.
 *
 * 실행: npx -y tsx@4 scripts/check-daily-candle-chart.ts  (실패 시 exit 1)
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
  const service = readFileSync(join(root, 'services', 'market-quote.service.ts'), 'utf8');
  console.log('services/market-quote.service.ts');
  assert('getDailyCandles 메서드', /getDailyCandles:\s*\(/.test(service));
  assert('GET /market-data/candles', /'\/market-data\/candles'/.test(service));
  assert("resolution: '1d' 고정", /resolution:\s*'1d'/.test(service));
  assert('6자리 코드 가드(UNAVAILABLE graceful·네트워크 미호출)', /!\/\^\\d\{6\}\$\/\.test\(stockCode\)/.test(service) && /source:\s*'UNAVAILABLE'/.test(service));
  assert('limit/from/to 옵션 전달', /options\?\.limit/.test(service) && /options\?\.from/.test(service) && /options\?\.to/.test(service));
  assert('CandleSeriesResult 타입 사용', /CandleSeriesResult/.test(service));

  // ── 2) 훅 ────────────────────────────────────────────────────────
  const hook = readFileSync(join(root, 'hooks', 'useDailyCandles.ts'), 'utf8');
  console.log('hooks/useDailyCandles.ts');
  assert('구간 프리셋 타입(3M/1Y/ALL)', /'3M'\s*\|\s*'1Y'\s*\|\s*'ALL'/.test(hook));
  assert('프리셋→limit 환산 맵', /DAILY_RANGE_LIMITS/.test(hook) && /'3M':\s*66/.test(hook) && /'1Y':\s*250/.test(hook) && /ALL:\s*1000/.test(hook));
  assert('getDailyCandles 호출(limit 주입)', /marketQuoteService\.getDailyCandles\(code,\s*\{\s*limit\s*\}\)/.test(hook));
  assert('안정 queryKey(daily-candles·code·range)', /queryKey:\s*\['daily-candles',\s*code,\s*range\]/.test(hook));
  assert('6자리 가드(enabled)', /\/\^\\d\{6\}\$\/\.test\(code\)/.test(hook));
  assert('폴링 없음(refetchInterval 미지정·EOD)', !/refetchInterval/.test(hook));
  assert('source/asOf 노출(정직 고지용)', /source:\s*result\?\.source/.test(hook) && /asOf:\s*result\?\.asOf/.test(hook));

  // ── 3) 일봉 차트 ──────────────────────────────────────────────────
  const chart = readFileSync(join(root, 'components', 'company', 'DailyCandleChart.tsx'), 'utf8');
  console.log('components/company/DailyCandleChart.tsx');
  assert('CandleSeriesPoint 소비', /CandleSeriesPoint/.test(chart));
  assert('★정직: source EOD 라벨(KRX 종가)', /KRX 일봉\(장 마감 종가\)/.test(chart));
  assert('★정직: 거래일 종가 기준 평문(E7·DAR-458) + 구현용어 미노출', /거래일 종가 기준/.test(chart) && !/앱 환경 시계/.test(chart));
  assert('asOf 서버 조회 시각 병기', /asOfDate\(asOf/.test(chart));
  assert('로딩 graceful', /isLoading/.test(chart) && /일봉 불러오는 중/.test(chart));
  assert('에러 graceful(재시도)', /isError/.test(chart) && /일봉을 불러오지 못했어요/.test(chart) && /onRetry/.test(chart));
  assert('빈 데이터 graceful', /candles\.length === 0/.test(chart) && /일봉 데이터가 아직 없어요/.test(chart));
  assert('거래일 KST 환산 라벨(자정 UTC→KST)', /9 \* 60 \* 60 \* 1000/.test(chart) && /kstParts/.test(chart));
  assert('색 단독 금지(종가·날짜 평문 병기)', /종가 \{won\(active\.close\)\}/.test(chart) && /fullDate\(active\.time\)/.test(chart));
  assert('등락 색 규약(returnColor)', /returnColor/.test(chart));
  assert('거래량 보조 바', /VOLUME_HEIGHT/.test(chart));
  assert('렌더 purity(Date.now 직접 호출 안 함)', !/Date\.now\(/.test(chart));

  // ── 4) 화면 배선 ──────────────────────────────────────────────────
  const screen = readFileSync(join(root, 'app', 'stock', '[stockCode].tsx'), 'utf8');
  console.log('app/stock/[stockCode].tsx');
  assert('DailyCandleChart 임포트', /import \{ DailyCandleChart \} from '@components\/company\/DailyCandleChart'/.test(screen));
  assert('useDailyCandles 임포트', /import \{ useDailyCandles, type DailyRangePreset \} from '@hooks\/useDailyCandles'/.test(screen));
  assert('일봉 탭 → DailyCandleChart 렌더', /<DailyCandleChart\b[\s\S]*candles=\{dailyCandles\}/.test(screen));
  assert('source/asOf 주입(정직)', /source=\{dailySource\}/.test(screen) && /asOf=\{dailyCandlesAsOf\}/.test(screen));
  assert('구간 선택(3개월/1년/전체)', /DAILY_RANGE_OPTIONS/.test(screen) && /label:\s*'3개월'/.test(screen) && /label:\s*'1년'/.test(screen) && /label:\s*'전체'/.test(screen));
  assert('구간 선택은 일봉 탭에서만 노출', /timeframe === 'daily' \?[\s\S]*setDailyRange/.test(screen));
  assert("'준비중' 플레이스홀더 제거", !/일봉 준비중/.test(screen));

  // ── 5) 타입 계약 ──────────────────────────────────────────────────
  const types = readFileSync(join(root, 'types', 'market-quote.types.ts'), 'utf8');
  console.log('types/market-quote.types.ts');
  assert('CandleSeriesResult 인터페이스', /interface CandleSeriesResult/.test(types));
  assert("source 'EOD' 포함(KRX 일봉)", /'EOD'\s*\|\s*'TIMESCALE'\s*\|\s*'UNAVAILABLE'/.test(types));
  assert('CandleSeriesPoint(time ISO·OHLCV)', /interface CandleSeriesPoint/.test(types) && /time:\s*string/.test(types));

  if (failures > 0) {
    console.error(`\n${failures}개 실패`);
    process.exit(1);
  }
  console.log('\n모두 통과');
}

main();
