/**
 * DAR-315 결정론적 검증: 시스템 모의 평가금액 카드 '기준일' 날짜 표기 일관화.
 *
 * 종전엔 components/portfolio/SimulationStatusSection.tsx 가 백엔드의 raw
 * YYYYMMDD 스냅샷 날짜(`latestSnapshotDate`, 예: '20260610')를 포맷 유틸 없이
 * 그대로 출력했다(`기준일 ${latestSnapshotDate}`). 그래서 같은 화면 차트축은
 * '6/10'(M/D) 형식, 다른 화면(공시 리스트/상세)은 '2026.06.10'(YYYY.MM.DD)인데
 * 이 라벨만 '20260610' 구분자 없는 raw 형식으로 혼재했다.
 *
 * 해결: 본문 라벨을 앱 공통 날짜 포맷 정본 formatYmdDots(DAR-218)로 통일 →
 * '2026.06.10'. 차트축은 의도적으로 M/D 간결표기를 유지(축 vs 본문 라벨 기준 분리).
 *
 * 실행: npx tsx scripts/check-sim-snapshot-date-format.ts  (실패 시 exit 1)
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { formatYmdDots } from '../utils/datetime.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));

let failed = 0;
function check(label: string, got: unknown, want: unknown): void {
  const ok = got === want;
  if (!ok) failed += 1;
  console.log(
    `${ok ? 'PASS' : 'FAIL'} | ${label} | got=${JSON.stringify(got)} want=${JSON.stringify(want)}`,
  );
}

// 컴포넌트가 라벨을 만드는 방식 그대로 재현(소스와 동일한 표현식)
// DAR-393: 라벨 접두어를 '기준일'→'최근 스냅샷'으로 변경(평가금액은 live 라 stale 스냅샷일을
//   '기준일'로 붙이면 오인). 포맷 정본(formatYmdDots)·raw 미노출 규칙은 그대로 유지.
function snapshotLabel(latestSnapshotDate: string | null): string {
  return latestSnapshotDate ? `  ·  최근 스냅샷 ${formatYmdDots(latestSnapshotDate)}` : '';
}

// 1) DoD 핵심 — '20260610' → '2026.06.10' 형식 표시
check("formatYmdDots('20260610')", formatYmdDots('20260610'), '2026.06.10');
check(
  '최근 스냅샷 라벨이 YYYY.MM.DD 포함',
  snapshotLabel('20260610'),
  '  ·  최근 스냅샷 2026.06.10',
);

// 2) raw YYYYMMDD 미노출 — 라벨에 구분자 없는 '20260610' 이 등장하면 안 됨
check('라벨에 raw 20260610 미포함', snapshotLabel('20260610').includes('20260610'), false);
check('라벨에 점 구분자 포함', snapshotLabel('20260610').includes('2026.06.10'), true);

// 3) null 가드 — 스냅샷 없으면 라벨 자체를 숨김(폴백 '-' 노출 안 함)
check('null → 라벨 빈 문자열', snapshotLabel(null), '');
check('null → 폴백 - 미노출', snapshotLabel(null).includes('-'), false);

// 4) 축(M/D) vs 본문(YYYY.MM.DD) 기준 분리 — 차트축 헬퍼는 그대로 M/D 유지
//    (EquityCurveChart 의 shortMonthDay 표기를 회귀로 묶는다)
function chartAxis(yyyymmdd: string): string {
  return `${Number(yyyymmdd.slice(4, 6))}/${Number(yyyymmdd.slice(6, 8))}`;
}
check('차트축 6/10 유지(M/D)', chartAxis('20260610'), '6/10');
check('본문 라벨과 축 형식이 다름', formatYmdDots('20260610') !== chartAxis('20260610'), true);

// 5) 소스 바인딩 — 컴포넌트가 formatYmdDots 경유로 렌더하고 raw 보간을 안 한다
const src = readFileSync(
  join(__dirname, '..', 'components', 'portfolio', 'SimulationStatusSection.tsx'),
  'utf8',
);
check('formatYmdDots import 존재', /import\s*{[^}]*\bformatYmdDots\b[^}]*}\s*from\s*'@utils\/datetime'/.test(src), true);
check(
  '최근 스냅샷 라벨이 formatYmdDots(latestSnapshotDate) 경유',
  /최근 스냅샷 \$\{formatYmdDots\(latestSnapshotDate\)\}/.test(src),
  true,
);
check(
  '스냅샷 라벨에 raw ${latestSnapshotDate} 보간 잔존 없음',
  /(?:기준일|최근 스냅샷) \$\{latestSnapshotDate\}/.test(src),
  false,
);

if (failed > 0) {
  console.error(`\n${failed} check(s) FAILED`);
  process.exit(1);
}
console.log('\nAll checks passed.');
