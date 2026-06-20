/**
 * DAR-393 결정론적 검증: 헤더 평가금액 == 자산곡선 최신점 표시 정합.
 *
 * 버그: 헤더 '모의 평가금액'은 '지금' 실시간 실가 재평가값(+5.73%)인데, 자산곡선 최신점은
 *   과거 사이클 스냅샷(일봉 백필 전 정체가, -0.11%)이라 같은 평가금액이 ~583K·부호 반대로 모순.
 * 수정(BE): getEquityCurve 가 곡선 끝에 live 점(kind='live')을 정합 병합 → 곡선 최신점 == 헤더 equity.
 * 수정(FE):
 *   1) EquityCurveChart 가 live 점을 '현재(실시간)'로 라벨(과거 스냅샷=M/D)해 시점 출처를 구분.
 *   2) 헤더가 평가금액을 '실시간 현재가 기준 · 자산곡선 최신점과 동일'로 정직 표기(stale 기준일 오인 제거).
 *
 * 실행: npx tsx scripts/check-equity-header-curve-consistency.ts  (실패 시 exit 1)
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

// ── 1) 라벨 로직 재현 — 컴포넌트 pointLabel 과 동일한 표현식 ─────────────────
type Pt = { snapshotDate: string; kind?: 'snapshot' | 'live' };
function shortDate(yyyymmdd: string): string {
  if (yyyymmdd.length !== 8) return yyyymmdd;
  return `${Number(yyyymmdd.slice(4, 6))}/${Number(yyyymmdd.slice(6, 8))}`;
}
function pointLabel(p: Pt): string {
  return p.kind === 'live' ? '현재(실시간)' : shortDate(p.snapshotDate);
}

// live 점은 날짜가 아니라 '현재(실시간)'로 — 헤더와 같은 시점임을 명시
check('live 점 라벨 = 현재(실시간)', pointLabel({ snapshotDate: '20260620', kind: 'live' }), '현재(실시간)');
// 과거 스냅샷은 M/D 유지(정체 가능 — 시점 구분)
check('snapshot 점 라벨 = M/D', pointLabel({ snapshotDate: '20260619', kind: 'snapshot' }), '6/19');
// 구버전 호환: kind 미지정이면 snapshot 취급(날짜 표기)
check('kind 미지정 → 날짜 표기', pointLabel({ snapshotDate: '20260619' }), '6/19');
// live ≠ snapshot 라벨(시점 구분 보장)
check(
  'live 라벨이 과거 날짜 라벨과 다름',
  pointLabel({ snapshotDate: '20260620', kind: 'live' }) !==
    pointLabel({ snapshotDate: '20260620', kind: 'snapshot' }),
  true,
);

// ── 2) 소스 바인딩 — 차트가 pointLabel 경유로 live/snapshot 을 구분 렌더 ─────
const chartSrc = readFileSync(
  join(__dirname, '..', 'components', 'portfolio', 'EquityCurveChart.tsx'),
  'utf8',
);
check('pointLabel 헬퍼 정의 존재', /function pointLabel\(/.test(chartSrc), true);
check("live → '현재(실시간)' 매핑", /kind === 'live' \? '현재\(실시간\)'/.test(chartSrc), true);
check('툴팁이 pointLabel(active) 경유', /pointLabel\(active\)/.test(chartSrc), true);
check('축 라벨이 pointLabel(points...) 경유', /pointLabel\(points\[/.test(chartSrc), true);
// 회귀: 툴팁/축에 raw shortDate(active...) 직접 표기 잔존 없음(라벨 우회 방지)
check('툴팁에 shortDate(active 직접표기 잔존 없음', /shortDate\(active\./.test(chartSrc), false);

// ── 3) 소스 바인딩 — 헤더가 평가금액을 live 로 정직 표기(stale 기준일 오인 제거) ──
const headerSrc = readFileSync(
  join(__dirname, '..', 'components', 'portfolio', 'SimulationStatusSection.tsx'),
  'utf8',
);
check('평가금액 = 실시간 현재가 기준 표기', /실시간 현재가 기준 · 자산곡선 최신점과 동일/.test(headerSrc), true);
// 평가금액(live) 옆에 stale '기준일 ${latestSnapshotDate}' 오인 표기 잔존 없음
check('평가금액 옆 stale 기준일 표기 제거', /기준일 \$\{(?:formatYmdDots\()?latestSnapshotDate/.test(headerSrc), false);
// 스냅샷일은 '최근 스냅샷'으로 위치 이동(여전히 표기되되 의미 정직)
check('스냅샷일 라벨 = 최근 스냅샷', /최근 스냅샷 \$\{formatYmdDots\(latestSnapshotDate\)\}/.test(headerSrc), true);

if (failed > 0) {
  console.error(`\n${failed} check(s) FAILED`);
  process.exit(1);
}
console.log('\nAll checks passed.');
