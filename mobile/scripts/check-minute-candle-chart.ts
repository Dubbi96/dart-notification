/**
 * DAR-354 결정론 체크 — MinuteCandleChart / useMinuteCandles 순수 로직 검증.
 * 소스 바인딩(파일이 실제로 그 규약을 구현하는지) + 분기/스케일/장중판정 대조군.
 * 실행: npx -y tsx@4 scripts/check-minute-candle-chart.ts
 */
import { readFileSync } from 'fs';
import { join } from 'path';

const ROOT = join(__dirname, '..');
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

const svc = readFileSync(join(ROOT, 'services/market-quote.service.ts'), 'utf8');
const hook = readFileSync(join(ROOT, 'hooks/useMinuteCandles.ts'), 'utf8');
const comp = readFileSync(join(ROOT, 'components/company/MinuteCandleChart.tsx'), 'utf8');
const types = readFileSync(join(ROOT, 'types/market-quote.types.ts'), 'utf8');
const page = readFileSync(join(ROOT, 'app/company/[corpCode].tsx'), 'utf8');

console.log('[1] 타입 — 백엔드 MinuteCandlesResult / KisMinuteCandle 1:1');
ok('MinuteCandle time/open/high/low/close/volume', /interface MinuteCandle[\s\S]*time:[\s\S]*open:[\s\S]*high:[\s\S]*low:[\s\S]*close:[\s\S]*volume:/.test(types));
ok('MinuteCandlesResult stockCode/source/asOf/candles', /interface MinuteCandlesResult[\s\S]*stockCode:[\s\S]*source:[\s\S]*asOf:[\s\S]*candles:/.test(types));
ok("source enum KIS_REALTIME|UNAVAILABLE", /'KIS_REALTIME'\s*\|\s*'UNAVAILABLE'/.test(types));

console.log('[2] 서비스 — getMinuteCandles(stockCode): MinuteCandlesResult');
ok('getMinuteCandles 메서드 존재', /getMinuteCandles:\s*\(stockCode: string\)/.test(svc));
ok('반환 타입 MinuteCandlesResult', /getMinuteCandles:\s*\(stockCode: string\):\s*Promise<MinuteCandlesResult>/.test(svc));
ok('엔드포인트 /market-data/minute-candles', /['"]\/market-data\/minute-candles['"]/.test(svc));
ok('6자리 아니면 UNAVAILABLE 빈결과(네트워크 0)', /\/\^\\d\{6\}\$\/\.test\(stockCode\)[\s\S]*source:\s*'UNAVAILABLE'[\s\S]*candles:\s*\[\]/.test(svc));
ok('응답 r.data.data(MinuteCandlesResult 전체) 반환', /\.then\(\(r\)\s*=>\s*r\.data\.data\)/.test(svc));

console.log('[3] 훅 — queryKey/폴링/candles·asOf 노출');
ok("queryKey ['minute-candles', code]", /queryKey:\s*\['minute-candles',\s*code\]/.test(hook));
ok('6자리 정규화 enabled 게이트', /\/\^\\d\{6\}\$\/\.test\(code\)/.test(hook));
ok('장중 폴링: isKrxMarketOpen 게이트', /pollWhileMarketOpen[\s\S]*isKrxMarketOpen\(new Date\(\)\)\s*\?\s*60 \* 1000\s*:\s*false/.test(hook));
ok('candles = result?.candles ?? []', /candles:\s*result\?\.candles\s*\?\?\s*\[\]/.test(hook));
ok('asOf 노출(환경시계 괴리 고지용)', /asOf:\s*result\?\.asOf\s*\?\?\s*''/.test(hook));

console.log('[4] 컴포넌트 — 3상태 분기 + 캔들 + 거래량 + 정직라벨');
ok('로딩 분기(isLoading)', /if \(isLoading\)/.test(comp));
ok('에러 분기(isError) + 재시도', /if \(isError\)[\s\S]*onRetry/.test(comp));
ok('빈데이터 분기(length === 0)', /if \(candles\.length === 0\)/.test(comp));
ok('빈상태 graceful 문구', /당일 분봉 데이터가 아직 없어요/.test(comp));
ok('꼬리 Line(고-저) + 몸통 Rect(시-종)', /<Line[\s\S]*y1=\{yHigh\}[\s\S]*y2=\{yLow\}/.test(comp) && /<Rect[\s\S]*bodyTop/.test(comp));
ok('거래량 보조 차트', /거래량|VOLUME_HEIGHT/.test(comp) && /v-\$\{c\.time\}/.test(comp));
ok('상승/하락 색 returnColor(close-open)', /returnColor\(c\.close - c\.open, colors\)/.test(comp));
ok("정직 라벨 '실시간 시세 기준'(E7 평이화·DAR-458)", /실시간 시세 기준/.test(comp));
ok('구현용어 미노출(앱 환경 시계 제거·E7·DAR-458)', !/앱 환경 시계/.test(comp));
ok('asOf → 서버 조회 HH:MM 병기(asOfClock)', /asOfClock\(asOf \?\? ''\)[\s\S]*서버 조회/.test(comp));
ok('색 단독 금지 — 시간·가격 평문 병기(요약)', /종가 \{won\(active\.close\)\}/.test(comp));

console.log('[5] 페이지 배선 — 현재가 헤더 아래');
ok('useMinuteCandles import', /import \{ useMinuteCandles \} from '@hooks\/useMinuteCandles'/.test(page));
ok('MinuteCandleChart import', /import \{ MinuteCandleChart \} from '@components\/company\/MinuteCandleChart'/.test(page));
// DAR-471: 접힘 시 지연 로딩 게이팅(enabled: isChartExpanded)을 옵션에 추가 → 폴링/발화 모두 펼칠 때만.
ok('장중 폴링 옵션 전달(+DAR-471 enabled 게이팅)', /useMinuteCandles\(company\?\.stockCode,\s*\{\s*pollWhileMarketOpen:\s*true,\s*enabled:\s*isChartExpanded,?\s*\}\)/.test(page));
ok('헤더 Card 닫힘 직후 섹션(현재가 헤더 아래)', /DAR-354: 분봉 차트 섹션 — 현재가 헤더 아래/.test(page));
ok('stockCode 있을 때만 렌더', /company\.stockCode \? \([\s\S]*<MinuteCandleChart/.test(page));
ok('asOf prop 전달(정직 라벨)', /asOf=\{minuteCandlesAsOf\}/.test(page));
ok('탭 셀렉터 앞 배치', page.indexOf('DAR-354: 분봉 차트 섹션') < page.indexOf('Tab selector'));

// --- 순수 로직 재구현 대조군: 장중 판정 ---
console.log('[6] 장중 판정 로직(KST 09:00–15:30 평일) 대조군');
function isKrxMarketOpen(now: Date): boolean {
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  const day = kst.getUTCDay();
  if (day === 0 || day === 6) return false;
  const minutes = kst.getUTCHours() * 60 + kst.getUTCMinutes();
  return minutes >= 9 * 60 && minutes <= 15 * 60 + 30;
}
// 2026-06-19 금 10:00 KST = 01:00 UTC → 장중
ok('금 10:00 KST 장중', isKrxMarketOpen(new Date('2026-06-19T01:00:00Z')));
// 금 08:00 KST = 2026-06-18T23:00Z → 장전
ok('금 08:00 KST 장전 closed', !isKrxMarketOpen(new Date('2026-06-18T23:00:00Z')));
// 금 15:31 KST = 06:31 UTC → 장후
ok('15:31 KST 장후 closed', !isKrxMarketOpen(new Date('2026-06-19T06:31:00Z')));
// 토 12:00 KST = 03:00 UTC → 주말
ok('토 12:00 KST 주말 closed', !isKrxMarketOpen(new Date('2026-06-20T03:00:00Z')));
// 09:00 정각 경계 = 00:00 UTC → 장중(포함)
ok('09:00 KST 경계 포함', isKrxMarketOpen(new Date('2026-06-19T00:00:00Z')));

// --- 가격→Y 스케일 단조성 대조군 ---
console.log('[7] 가격 Y 스케일 단조(고가일수록 위=작은 y)');
const minP = 70000;
const maxP = 72000;
const priceH = 144;
const PADtop = 8;
const yPrice = (v: number) => PADtop + priceH - ((v - minP) / (maxP - minP || 1)) * priceH;
ok('maxP의 y < minP의 y(위쪽)', yPrice(maxP) < yPrice(minP));
ok('단조 감소', yPrice(71000) < yPrice(70000) && yPrice(72000) < yPrice(71000));

console.log(`\n결과: ${pass} pass / ${fail} fail`);
process.exit(fail === 0 ? 0 : 1);
