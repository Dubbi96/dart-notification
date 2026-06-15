/**
 * DAR-310 결정론적 검증: 매도(Exit) 신호 카드 탭이 매수 상세(/signals/[id])로 오라우팅돼
 * "신호를 불러오지 못했습니다" 에러를 띄우던 버그를, 기업 허브(/company/[corpCode])로 교정했음을
 * 두 층으로 증명한다.
 *
 *  (A) 라우팅 도메인 모델: 두 디테일 라우트의 해석 규칙을 모사한다.
 *      - /signals/[id]  → useSignalDetail 로 "매수 신호(TradingSignal) id" 만 해석. exit id 는 미존재 → isError.
 *      - /company/[corpCode] → corpCode 로 기업을 해석. ExitSignal.corpCode 는 유효.
 *      수정 전(버그) 목적지(exit.id→/signals/[id])는 항상 에러, 수정 후(exit.corpCode→/company/[corpCode])는 항상 해석됨을 보인다.
 *      매수 카드 라우팅은 회귀 없이 그대로 해석됨도 대조군으로 확인한다.
 *
 *  (B) 소스 바인딩: 실제 signals/index.tsx·ExitScoreCard.tsx 가
 *      exit 핸들러를 /company/${signal.corpCode} 로 push 하고,
 *      깨진 /signals/${signal.id} push 가 제거됐음을 정적으로 확인(모델이 소스와 어긋나면 실패).
 *
 * 실행: npx tsx scripts/check-exit-card-route.ts
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

let failures = 0;
function assert(name: string, cond: boolean) {
  if (cond) {
    console.log(`  ✓ ${name}`);
  } else {
    failures++;
    console.error(`  ✗ ${name}`);
  }
}

console.log('DAR-310 Exit 카드 라우팅 교정 + 소스 바인딩');

// ── (A) 라우팅 도메인 모델 ─────────────────────────────────────
type RouteResult = { ok: true; screen: string } | { ok: false; reason: string };

// 매수 신호 상세가 해석할 수 있는 id 집합(useSignalDetail 백엔드 키). exit id 는 여기 없다.
const BUY_SIGNAL_IDS = new Set(['buy_1', 'buy_2', 'buy_3']);
// 기업 허브가 해석할 수 있는 corpCode 집합(useCompanyDetail).
const COMPANY_CODES = new Set(['00126380', '00164779', '00401731']);

// /signals/[id] 라우트 해석(매수 상세 전용).
function resolveSignalDetail(id: string): RouteResult {
  if (BUY_SIGNAL_IDS.has(id)) return { ok: true, screen: 'BuySignalDetail' };
  return { ok: false, reason: '신호를 불러오지 못했습니다' }; // useSignalDetail isError 화면
}
// /company/[corpCode] 라우트 해석(기업 허브).
function resolveCompanyHub(corpCode: string): RouteResult {
  if (COMPANY_CODES.has(corpCode)) return { ok: true, screen: 'CompanyHub' };
  return { ok: false, reason: '기업 정보를 찾을 수 없습니다' };
}

type ExitSignal = { id: string; corpCode: string; corpName: string };
type TradingSignal = { id: string; corpCode: string };

// 전체 매도 피드(에뮬 재현: 세나테크놀로지 Exit Score 0 등). exit id 는 매수 id 공간과 분리.
const exitFeed: ExitSignal[] = [
  { id: 'exit_1', corpCode: '00126380', corpName: '세나테크놀로지' },
  { id: 'exit_2', corpCode: '00164779', corpName: '삼성전자' },
  { id: 'exit_3', corpCode: '00401731', corpName: 'SK하이닉스' },
];
const buyFeed: TradingSignal[] = [
  { id: 'buy_1', corpCode: '00126380' },
  { id: 'buy_2', corpCode: '00164779' },
];

// 수정 전(버그) 목적지: exit.id 를 매수 상세 라우트로.
const buggyExitTarget = (s: ExitSignal): RouteResult => resolveSignalDetail(s.id);
// 수정 후 목적지: exit.corpCode 를 기업 허브로.
const fixedExitTarget = (s: ExitSignal): RouteResult => resolveCompanyHub(s.corpCode);
// 매수 카드 목적지(불변): buy.id 를 매수 상세로.
const buyTarget = (s: TradingSignal): RouteResult => resolveSignalDetail(s.id);

// 1) 버그 재현: 수정 전 경로로는 매도 피드 전 카드가 에러(피드 전체 불능).
const buggyResults = exitFeed.map(buggyExitTarget);
assert(
  '수정 전: 매도 카드 전부 "신호를 불러오지 못했습니다" 에러(버그 재현)',
  buggyResults.every((r) => !r.ok && r.reason === '신호를 불러오지 못했습니다'),
);

// 2) 수정 후: 매도 피드 전 카드가 기업 허브로 정상 해석.
const fixedResults = exitFeed.map(fixedExitTarget);
assert(
  '수정 후: 매도 카드 전부 기업 허브(CompanyHub) 정상 진입',
  fixedResults.every((r) => r.ok && r.screen === 'CompanyHub'),
);

// 3) 매수 카드 회귀 없음: buy.id 는 매수 상세로 그대로 해석.
const buyResults = buyFeed.map(buyTarget);
assert(
  '매수 카드 회귀 없음: 매수 상세(BuySignalDetail) 정상 진입',
  buyResults.every((r) => r.ok && r.screen === 'BuySignalDetail'),
);

// 4) 도메인 분리 증명: exit.id 를 매수 상세에 넣으면 절대 해석 안 됨(근본원인 모델).
assert(
  'exit id 는 매수 상세 id 공간에 없음(오라우팅 근본원인)',
  exitFeed.every((s) => !BUY_SIGNAL_IDS.has(s.id)),
);

// 5) exit corpCode 는 기업 허브에서 유효(수정 목적지 타당성).
assert(
  'exit corpCode 는 기업 허브에서 해석 가능(유효 라우트)',
  exitFeed.every((s) => COMPANY_CODES.has(s.corpCode)),
);

// 6) 빈 피드: 라우팅 호출 0 → 에러 0(빈상태 정상).
assert('빈 매도 피드: 라우팅 0건(빈상태 정상)', [].map(fixedExitTarget as never).length === 0);

// ── (B) 소스 바인딩 ───────────────────────────────────────────
const root = join(__dirname, '..');
const indexSrc = readFileSync(join(root, 'app', '(tabs)', 'signals', 'index.tsx'), 'utf8');
const cardSrc = readFileSync(join(root, 'components', 'signals', 'ExitScoreCard.tsx'), 'utf8');

// handleExitPress 블록 추출(선언부터 닫는 콜백까지).
const exitHandler = indexSrc.match(/const handleExitPress = useCallback\([\s\S]*?\}, \[\]\);/);
assert('handleExitPress 핸들러 존재', !!exitHandler);
const handlerBody = exitHandler ? exitHandler[0] : '';

assert(
  'exit 핸들러가 /company/${signal.corpCode} 로 push(교정 목적지)',
  /router\.push\(`\/company\/\$\{signal\.corpCode\}`\)/.test(handlerBody),
);
assert(
  'exit 핸들러에 깨진 /signals/${signal.id} push 부재(회귀 신호)',
  !/router\.push\(`\/signals\/\$\{signal\.id\}`\)/.test(handlerBody),
);

// 매수(SignalExplorer) 경로는 그대로(별도 컴포넌트). index.tsx 에 exit id 매수상세 push 가 없는지만 확인.
assert(
  'index.tsx 전체에 exit→/signals/${signal.id} 잔존 없음',
  !/router\.push\(`\/signals\/\$\{signal\.id\}`\)/.test(indexSrc),
);

// ExitScoreCard 는 onPress 콜백으로 라우팅 위임(자체 경로 하드코딩 없음).
assert('ExitScoreCard 가 onPress(signal) 위임 유지', /onPress\?\.\(signal\)/.test(cardSrc));
assert(
  'ExitScoreCard a11y 액션 라벨이 목적지(기업 정보)와 일치',
  /label: '기업 정보 보기'/.test(cardSrc),
);

const total = 11;
const passed = total - failures;
if (failures === 0) {
  console.log(`ALL PASS (${passed}/${total})`);
  process.exit(0);
} else {
  console.error(`FAIL: ${failures}/${total} assertion(s)`);
  process.exit(1);
}
