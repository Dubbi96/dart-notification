/**
 * DAR-353 결정론적 검증: 현재가 실시간 자동갱신(폴링) + 대형 현재가 헤더.
 *
 * 1) 순수 로직(utils/marketQuoteDisplay): KST 장중 게이트·갱신경과·출처 메타 진리표.
 * 2) 폴링 게이트(resolveQuotePollInterval): 포커스×활성×장중 전수 진리표 —
 *    모두 참일 때만 간격(ms), 하나라도 거짓이면 false(폴링 없음). 양/음성 대조.
 *    (refetchInterval=number→폴링/false→1회 는 React Query 계약이며, 훅이 이를
 *     useQuery 로 전달함을 (3) 정적 바인딩으로 확인한다.)
 * 3) 정적 소스 바인딩: 훅·헤더·화면이 실제로 옵션/게이트/정직 고지를 사용하는지.
 *
 * 실행: npx -y tsx@4 scripts/check-quote-header.ts  (실패 시 exit 1)
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  kstWallClock,
  isKstMarketOpen,
  formatUpdatedAgo,
  quoteSourceMeta,
  resolveQuotePollInterval,
} from '../utils/marketQuoteDisplay';

let failures = 0;
function assert(name: string, cond: boolean, detail = '') {
  if (cond) {
    console.log(`  ✓ ${name}`);
  } else {
    failures += 1;
    console.error(`  ✗ ${name} ${detail}`);
  }
}

// ── 헬퍼: 특정 KST 벽시계(요일·HH:MM)에 해당하는 Date 를 만든다(UTC 기준 -9h). ──
// 2026-06 기준 요일 검증용 고정 날짜를 쓰되, 핵심은 KST 변환 결정론이다.
function kstDate(isoUtc: string): Date {
  return new Date(isoUtc);
}

function main() {
  console.log('DAR-353 현재가 헤더 + 폴링 게이트');

  // 1) KST 벽시계 변환 — TZ 독립(epoch+9h). 2026-06-19T00:30:00Z = KST 09:30 금요일.
  {
    const wc = kstWallClock(kstDate('2026-06-19T00:30:00Z'));
    assert('KST 변환: 00:30Z → 09:30 KST', wc.minutes === 9 * 60 + 30, `(got ${wc.minutes})`);
    assert('KST 변환: 2026-06-19 금요일(day=5)', wc.day === 5, `(got ${wc.day})`);
  }

  // 2) 장중 게이트 진리표(평일 09:00–15:30 KST, 경계 포함/제외)
  assert('09:30 KST 평일 → 개장', isKstMarketOpen(kstDate('2026-06-19T00:30:00Z')));
  assert('09:00 KST 정각 → 개장(경계 포함)', isKstMarketOpen(kstDate('2026-06-19T00:00:00Z')));
  assert('08:59 KST → 폐장(개장 전)', !isKstMarketOpen(kstDate('2026-06-18T23:59:00Z')));
  assert('15:29 KST → 개장', isKstMarketOpen(kstDate('2026-06-19T06:29:00Z')));
  assert('15:30 KST 정각 → 폐장(종료 경계 제외)', !isKstMarketOpen(kstDate('2026-06-19T06:30:00Z')));
  assert('16:00 KST → 폐장(장 마감)', !isKstMarketOpen(kstDate('2026-06-19T07:00:00Z')));
  // 주말: 2026-06-20 토 / 2026-06-21 일 — 장중 시간대라도 폐장.
  assert('토요일 11:00 KST → 폐장', !isKstMarketOpen(kstDate('2026-06-20T02:00:00Z')));
  assert('일요일 11:00 KST → 폐장', !isKstMarketOpen(kstDate('2026-06-21T02:00:00Z')));

  // 3) 갱신 경과 평문화
  const now = 1_000_000_000_000;
  assert("미상(null) → '' (표기 생략)", formatUpdatedAgo(null, now) === '');
  assert("0(미갱신) → ''", formatUpdatedAgo(0, now) === '');
  assert("3초 전 → '방금'", formatUpdatedAgo(now - 3_000, now) === '방금');
  assert("12초 전 → '12초 전'", formatUpdatedAgo(now - 12_000, now) === '12초 전', `(got ${formatUpdatedAgo(now - 12_000, now)})`);
  assert("90초 전 → '1분 전'", formatUpdatedAgo(now - 90_000, now) === '1분 전');
  assert("2시간 전 → '2시간 전'", formatUpdatedAgo(now - 2 * 3600_000, now) === '2시간 전');
  assert("미래값(시계 괴리) → '방금'(음수 경과 클램프)", formatUpdatedAgo(now + 5_000, now) === '방금');

  // 4) 출처 메타 — 정직 고지(REALTIME 만 환경시계 괴리 고지)
  const rt = quoteSourceMeta('REALTIME');
  assert("REALTIME 라벨 '실시간'", rt.label === '실시간');
  assert('REALTIME isRealtime=true', rt.isRealtime === true);
  assert('REALTIME 정직 고지 존재(환경 시계 괴리)', !!rt.disclosure && /환경 시계/.test(rt.disclosure!));
  const dy = quoteSourceMeta('DAILY');
  assert("DAILY 라벨 '종가'", dy.label === '종가');
  assert('DAILY isRealtime=false', dy.isRealtime === false);
  assert('DAILY 고지 없음(null)', dy.disclosure === null);

  // 5) 폴링 게이트 진리표(포커스×활성×장중) — 모두 참일 때만 간격, 아니면 false.
  const MARKET_OPEN = kstDate('2026-06-19T00:30:00Z'); // 평일 09:30 KST
  const MARKET_CLOSED = kstDate('2026-06-19T07:00:00Z'); // 평일 16:00 KST(장 마감)
  const POLL_MS = 15000;
  const gate = (isFocused: boolean, appActive: boolean, now: Date) =>
    resolveQuotePollInterval({ isFocused, appActive, now, intervalMs: POLL_MS });
  assert('포커스+활성+장중 → 폴링 간격(15000)', gate(true, true, MARKET_OPEN) === POLL_MS);
  assert('포커스 이탈 → false(폴링 없음)', gate(false, true, MARKET_OPEN) === false);
  assert('백그라운드(앱 비활성) → false', gate(true, false, MARKET_OPEN) === false);
  assert('장 마감 → false(graceful, 종가만 표시)', gate(true, true, MARKET_CLOSED) === false);
  assert('모두 충족이라도 주말이면 false', gate(true, true, kstDate('2026-06-20T02:00:00Z')) === false);

  // 6) 정적 소스 바인딩
  const root = join(__dirname, '..');
  const hook = readFileSync(join(root, 'hooks', 'useStockQuotes.ts'), 'utf8');
  assert('훅: refetchInterval 옵션 수용', /refetchInterval\?:\s*number\s*\|\s*false/.test(hook));
  assert('훅: useQuery 에 refetchInterval 전달', /refetchInterval,/.test(hook));
  assert('훅: 백그라운드 폴링 비활성', /refetchIntervalInBackground:\s*false/.test(hook));
  assert('훅: 기본값 off(false)', /options\?\.refetchInterval\s*\?\?\s*false/.test(hook));

  const header = readFileSync(join(root, 'components', 'common', 'QuoteHeader.tsx'), 'utf8');
  assert('헤더: 대형 현재가(typo.amount) 사용', /typo\.amount/.test(header));
  assert('헤더: 출처 메타 사용', /quoteSourceMeta/.test(header));
  assert('헤더: 갱신시각 사용(Date.now 래퍼)', /quoteUpdatedAgo/.test(header));
  assert('헤더: 렌더에서 Date.now 직접 호출 안 함(purity)', !/Date\.now\(/.test(header));
  assert('헤더: 부호색(pnlColor) 사용', /pnlColor/.test(header));
  assert('헤더: 데이터 없으면 null 가드', /if \(!quote \|\| !\(quote\.price > 0\)\) return null/.test(header));

  const screen = readFileSync(join(root, 'app', 'company', '[corpCode].tsx'), 'utf8');
  assert('화면: QuoteHeader 렌더', /<QuoteHeader\b/.test(screen));
  assert('화면: 폴링 게이트(resolveQuotePollInterval)', /resolveQuotePollInterval\(\{/.test(screen));
  assert('화면: 게이트 입력(포커스·활성·now·간격)', /isFocused,\s*\n\s*appActive,\s*\n\s*now: new Date\(\),\s*\n\s*intervalMs: QUOTE_POLL_INTERVAL_MS,/.test(screen));
  assert('화면: refetchInterval 게이팅 전달', /refetchInterval:\s*quotePollInterval/.test(screen));
  assert('화면: 15s 폴링 간격 상수', /QUOTE_POLL_INTERVAL_MS = 15 \* 1000/.test(screen));
  assert('화면: useFocusEffect 임포트', /useFocusEffect/.test(screen));
  assert('화면: AppState 백그라운드 연동', /AppState\.addEventListener/.test(screen));
  assert('화면: StockPriceBadge 제거(대형 헤더로 대체)', !/StockPriceBadge/.test(screen));

  if (failures > 0) {
    console.error(`\n${failures}개 실패`);
    process.exit(1);
  }
  console.log('\n모두 통과');
}

main();
