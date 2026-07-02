/**
 * DAR-460 결정론적 검증: 1년 트랙레코드 발견성 + 새로고침 + 수익률 위계.
 *
 * 출처: UI/UX 전수 감사 2026-06-27 (C5·C8·C10).
 * 파일별 1이슈 제약 → app/portfolio/auto-trading.tsx, app/portfolio/backtest-track-record.tsx 만 수정.
 *
 * 종전:
 *   - C5  auto-trading.tsx: 트랙레코드 진입점(TrackRecordEntryCard)이 최근 실행/감사 트레일 아래(최하단) →
 *         신뢰 핵심 자료가 화면 끝에 매몰, 발견성 낮음.
 *   - C8  두 화면 ScrollView 모두 pull-to-refresh 부재(자동매매는 "30초 자동 갱신" 문구뿐).
 *   - C10 backtest-track-record.tsx: 총수익률·승률이 동일 typo.amount → 위계 동률.
 *
 * 해결:
 *   (C5)  TrackRecordEntryCard 를 킬스위치 직후(상단)로 승격 + primaryLight 톤 아이콘/bodyMedium 제목.
 *   (C8)  두 ScrollView 에 RN 코어 <RefreshControl refreshing/onRefresh> (커스텀 래퍼 금지).
 *   (C10) 승률 typo.amount → typo.h2 강등, 총수익률은 typo.amount 유지(위계 분리).
 *
 * 이 스크립트가 검증하는 것 (순수 소스 바인딩 — RN 런타임/네이티브 불요):
 *   (A) auto-trading: RefreshControl import + ScrollView refreshControl prop + refreshing/onRefresh.
 *   (B) auto-trading: 트랙레코드 진입점이 리스크게이트·감사트레일보다 위(상단)에 위치.
 *   (C) auto-trading: onRefresh 가 refetch 기반(수동 갱신 어포던스).
 *   (D) backtest: RefreshControl import + ScrollView refreshControl prop + refreshing/onRefresh.
 *   (E) backtest(C10): 총수익률 typo.amount 유지 · 승률 typo.h2 강등 · 승률 amount 제거.
 *   (F) 크로스플랫폼 가드: 두 파일 모두 커스텀 refreshControl 래퍼 금지 — RN 코어 <RefreshControl> 만.
 *   (G) 회귀 가드: 진입점이 여전히 /portfolio/backtest-track-record 로 라우팅 · 빈/에러/로딩 동선 불변.
 *
 * 실행: npx tsx scripts/check-track-record-discoverability.ts  (실패 시 exit 1)
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

let failed = 0;
function check(label: string, ok: boolean, detail = ''): void {
  if (!ok) failed += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'} | ${label}${detail ? ' | ' + detail : ''}`);
}

const AUTO = readFileSync(join(root, 'app/portfolio/auto-trading.tsx'), 'utf8');
const BACKTEST = readFileSync(join(root, 'app/portfolio/backtest-track-record.tsx'), 'utf8');
// DAR-472: 두 화면의 새로고침 보일러플레이트(refreshing useState + onRefresh useCallback→refetch)를
// 공통 훅 useManualRefresh 로 추출. C8 어포던스(당겨서 refetch)는 훅 안에 보존된다.
const REFRESH_HOOK = readFileSync(join(root, 'hooks/useManualRefresh.ts'), 'utf8');

// ── (A) auto-trading: RN 코어 RefreshControl 도입 ───────────────────────────
check(
  'auto-trading: RefreshControl 를 react-native 에서 import',
  /import\s*\{[^}]*\bRefreshControl\b[^}]*\}\s*from\s*'react-native'/.test(AUTO),
);
check(
  'auto-trading: ScrollView 에 refreshControl prop',
  /refreshControl=\{\s*<RefreshControl/.test(AUTO),
);
check(
  'auto-trading: RefreshControl 에 refreshing/onRefresh 바인딩',
  /<RefreshControl[\s\S]*?refreshing=\{refreshing\}[\s\S]*?onRefresh=\{onRefresh\}/.test(AUTO),
);
check('auto-trading: 공통 새로고침 훅 사용(useManualRefresh)', /const \{ refreshing, onRefresh \} = useManualRefresh\(query\.refetch\)/.test(AUTO));
check('공통 훅: refreshing 로컬 상태(useState(false)) 소유', /useState\(false\)/.test(REFRESH_HOOK));

// ── (B) auto-trading(C5): 트랙레코드 진입점 상단 승격 ────────────────────────
// 진입점(TrackRecordEntryCard 렌더)이 리스크게이트·감사트레일보다 먼저 등장해야 한다.
const entryIdx = AUTO.indexOf('<TrackRecordEntryCard');
const riskIdx = AUTO.indexOf('<RiskGateCard');
const ordersIdx = AUTO.indexOf('<RecentOrdersCard');
check('auto-trading: TrackRecordEntryCard 렌더 존재', entryIdx !== -1);
check(
  'auto-trading: 진입점이 리스크게이트보다 위(상단)',
  entryIdx !== -1 && riskIdx !== -1 && entryIdx < riskIdx,
  `entry@${entryIdx} < risk@${riskIdx}`,
);
check(
  'auto-trading: 진입점이 감사트레일보다 위(상단)',
  entryIdx !== -1 && ordersIdx !== -1 && entryIdx < ordersIdx,
  `entry@${entryIdx} < orders@${ordersIdx}`,
);
// 킬스위치(안전 표면)는 여전히 최상단 카드로 유지(진입점보다 위).
const killIdx = AUTO.indexOf('<KillSwitchCard');
check(
  'auto-trading: 킬스위치(안전 표면)는 진입점보다 위 유지',
  killIdx !== -1 && entryIdx !== -1 && killIdx < entryIdx,
  `kill@${killIdx} < entry@${entryIdx}`,
);

// ── (C) 수동 갱신이 refetch 기반(C8 어포던스는 공통 훅에 보존) ─────────────────
check(
  '공통 훅: onRefresh 가 useCallback(async)→await refetch()',
  /onRefresh\s*=\s*useCallback\(async[\s\S]*?await refetch\(\)/.test(REFRESH_HOOK),
);
check(
  '공통 훅: finally 로 스피너 해제(무한 로딩 방지)',
  /finally\s*\{\s*setRefreshing\(false\)/.test(REFRESH_HOOK),
);

// ── (D) backtest: RN 코어 RefreshControl 도입 ───────────────────────────────
check(
  'backtest: RefreshControl 를 react-native 에서 import',
  /import\s*\{[^}]*\bRefreshControl\b[^}]*\}\s*from\s*'react-native'/.test(BACKTEST),
);
check(
  'backtest: ScrollView 에 refreshControl prop',
  /refreshControl=\{\s*<RefreshControl/.test(BACKTEST),
);
check(
  'backtest: RefreshControl 에 refreshing/onRefresh 바인딩',
  /<RefreshControl[\s\S]*?refreshing=\{refreshing\}[\s\S]*?onRefresh=\{onRefresh\}/.test(BACKTEST),
);
check(
  'backtest: 공통 새로고침 훅 사용(useManualRefresh)',
  /const \{ refreshing, onRefresh \} = useManualRefresh\(query\.refetch\)/.test(BACKTEST),
);

// ── (E) backtest(C10): 총수익률 vs 승률 위계 분리 ───────────────────────────
// 총수익률 헤드라인은 typo.amount(최대 토큰) 유지, 승률은 typo.h2 로 강등.
check(
  'backtest(C10): 총수익률 헤드라인 typo.amount 유지',
  /accessibilityLabel=\{`총수익률[\s\S]*?style=\{\[typo\.amount/.test(BACKTEST) ||
    /style=\{\[typo\.amount, \{ color: returnTone \}\]\}/.test(BACKTEST),
);
check(
  'backtest(C10): 승률 값이 typo.h2 로 강등',
  /\{\[typo\.h2, \{ color: colors\.text \}\]\}>\{formatPct\(m\.winRate\)\}/.test(BACKTEST),
);
check(
  'backtest(C10): 승률에 typo.amount 잔존 없음(위계 동률 제거)',
  !/\{\[typo\.amount, \{ color: colors\.text \}\]\}>\{formatPct\(m\.winRate\)\}/.test(BACKTEST),
);

// ── (F) 크로스플랫폼 가드: 커스텀 refreshControl 래퍼 금지 ───────────────────
// docs/mobile-cross-platform-issues.md — refreshing/onRefresh 또는 RN 코어 <RefreshControl> 만 허용.
for (const [name, src] of [
  ['auto-trading', AUTO],
  ['backtest', BACKTEST],
] as const) {
  const m = src.match(/refreshControl=\{\s*<([A-Za-z0-9_]+)/);
  check(
    `${name}: refreshControl 이 RN 코어 RefreshControl(커스텀 래퍼 금지)`,
    m !== null && m[1] === 'RefreshControl',
    m ? `=<${m[1]}` : 'no match',
  );
}

// ── (G) 회귀 가드: 라우팅·상태 동선 불변 ────────────────────────────────────
check(
  'auto-trading: 진입점이 /portfolio/backtest-track-record 로 라우팅 유지',
  /router\.push\('\/portfolio\/backtest-track-record'\)/.test(AUTO),
);
// 앵커 갱신 2026-07-02(L-3): 로딩 표현 LoadingState → DetailSkeleton(레이아웃 보존 스켈레톤) 이관.
check('auto-trading: 로딩/에러 동선(DetailSkeleton·ApiErrorState) 유지', /<DetailSkeleton/.test(AUTO) && /<ApiErrorState/.test(AUTO));
check(
  'backtest: 빈/에러/로딩 동선(EmptyState·ApiErrorState·DetailSkeleton) 유지',
  /<EmptyState/.test(BACKTEST) && /<ApiErrorState/.test(BACKTEST) && /<DetailSkeleton/.test(BACKTEST),
);

console.log(failed === 0 ? '\nALL PASS' : `\n${failed} FAILED`);
process.exit(failed === 0 ? 0 : 1);
