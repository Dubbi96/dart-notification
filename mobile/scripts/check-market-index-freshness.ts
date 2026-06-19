/**
 * DAR-371 결정론적 검증: 홈 '시장 한눈에' 배지 신선도 정직 라벨.
 *
 * 배경: 배지가 EOD(일봉 종가, 예: 6/5 종가 8160)를 날짜 라벨 없이 표시해 사용자가 stale 을
 *   '현재'로 오인했다('정확한 정보 아니면 신뢰성 문제'). 출처별 정직 라벨로 해소한다.
 *   - REALTIME(KIS 실시간 지수) → '실시간'
 *   - EOD/구버전 응답 → 'YYYY.MM.DD 종가'(기준 거래일 명시)
 *
 * 실행: npx tsx scripts/check-market-index-freshness.ts  (실패 시 exit 1)
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { indexBasisLabel } from '../utils/marketIndexDisplay.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));

let failed = 0;
function check(label: string, got: unknown, want: unknown): void {
  const ok = got === want;
  if (!ok) failed += 1;
  console.log(
    `${ok ? 'PASS' : 'FAIL'} | ${label} | got=${JSON.stringify(got)} want=${JSON.stringify(want)}`,
  );
}

// 1) REALTIME → '실시간'
const rt = indexBasisLabel({ source: 'REALTIME', tradeDate: '20260619' });
check('REALTIME label', rt.label, '실시간');
check('REALTIME isRealtime', rt.isRealtime, true);
check('REALTIME a11y', rt.a11y, '실시간 지수');

// 2) EOD → 'YYYY.MM.DD 종가' (기준일 명시 — stale 을 현재로 오인 방지)
const eod = indexBasisLabel({ source: 'EOD', tradeDate: '20260605' });
check('EOD label', eod.label, '2026.06.05 종가');
check('EOD isRealtime', eod.isRealtime, false);
check('EOD a11y', eod.a11y, '2026.06.05 종가 기준');

// 3) 구버전 응답(source 미상) → EOD 폴백(종가 라벨) — 옛 응답도 정직 처리
const legacy = indexBasisLabel({ source: undefined, tradeDate: '20260605' });
check('legacy(미상) label', legacy.label, '2026.06.05 종가');
check('legacy(미상) isRealtime', legacy.isRealtime, false);

// 4) 정직성 — EOD 라벨은 '현재' 를 포함하지 않고 '종가' 를 명시한다
check("EOD 라벨에 '현재' 미포함", eod.label.includes('현재'), false);
check("EOD 라벨에 '종가' 포함", eod.label.includes('종가'), true);
check("EOD 라벨에 기준일 포함", eod.label.includes('2026.06.05'), true);

// 5) tradeDate 비정상 → formatYmdDots 폴백('-'), 여전히 '종가' 명시(현재 오인 안 함)
const bad = indexBasisLabel({ source: 'EOD', tradeDate: 'bad' });
check('비정상 tradeDate graceful', bad.label, '- 종가');
check('비정상도 현재 오인 안 함', bad.label.includes('현재'), false);

// 6) 소스 바인딩 — 배지가 indexBasisLabel 경유로 신선도 라벨을 렌더한다
const badgeSrc = readFileSync(
  join(__dirname, '..', 'components', 'home', 'MarketIndexBadge.tsx'),
  'utf8',
);
check(
  'indexBasisLabel import 존재',
  /import\s*{[^}]*\bindexBasisLabel\b[^}]*}\s*from\s*'@utils\/marketIndexDisplay'/.test(badgeSrc),
  true,
);
check('basis = indexBasisLabel(quote) 호출', /indexBasisLabel\(quote\)/.test(badgeSrc), true);
check('basis.label 렌더', /\{basis\.label\}/.test(badgeSrc), true);
check('basisRow 스타일 존재', /styles\.basisRow/.test(badgeSrc), true);
check(
  'accessibilityLabel 에 basis.a11y 합성',
  /accessibilityLabel=\{`[^`]*\$\{basis\.a11y\}/.test(badgeSrc),
  true,
);
check('실시간 라이브닷 분기(basis.isRealtime)', /basis\.isRealtime/.test(badgeSrc), true);

// 7) 백엔드 타입 1:1 — source/asOf 필드가 모바일 타입에 추가됐는지
const typeSrc = readFileSync(join(__dirname, '..', 'types', 'market.types.ts'), 'utf8');
check("source?: 'REALTIME' | 'EOD' 필드", /source\?:\s*'REALTIME'\s*\|\s*'EOD'/.test(typeSrc), true);
check('asOf?: string | null 필드', /asOf\?:\s*string\s*\|\s*null/.test(typeSrc), true);

if (failed > 0) {
  console.error(`\n${failed} check(s) FAILED`);
  process.exit(1);
}
console.log('\nAll checks passed.');
