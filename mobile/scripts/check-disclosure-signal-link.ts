/**
 * DAR-208 결정론적 검증: 공시 상세 → 매수 신호 역링크 진입 카드의 노출/이동 규칙.
 *
 * 버그(수정 전): 신호 → 공시 단방향만 존재(signals/[id]의 '관련 공시'). 그 공시로 생성된
 *   매수 신호로 가는 역방향 동선이 없어, intro Slide2("공시→AI 매수점수") 약속이
 *   공시 상세 화면에서 끊겨 있었다.
 *
 * 수정 후: GET /signals/by-disclosure/:rcpNo 역조회 결과(있으면 배지, 없으면 null)를
 *   disclosureSignalTarget()이 단일 판정한다.
 *     - 신호 있음(id 존재)  → '/signals/{id}' (카드 노출 + 탭 시 이동)
 *     - 신호 없음(null)      → null (카드 미표시, 빈상태 흡수)
 *     - id 결손(방어)        → null (가짜 이동 경로 금지)
 *
 * 실행: npx tsx scripts/check-disclosure-signal-link.ts  (실패 시 exit 1)
 */
import { disclosureSignalTarget } from '../utils/disclosureSignalLink.ts';

import type { CompanySignalBadge } from '../types/signal.types.ts';

function badge(id: string): CompanySignalBadge {
  return {
    id,
    corpCode: '00126380',
    corpName: '삼성전자',
    ticker: '005930',
    eventType: 'SUPPLY_CONTRACT',
    grade: 'BUY',
    buyScore: 72,
    entryReady: true,
    relatedDisclosureRcpNo: '20240101000001',
    createdAt: '2024-01-01T00:00:00.000Z',
  };
}

interface Case {
  name: string;
  input: CompanySignalBadge | null | undefined;
  expected: string | null;
  expectVisible: boolean;
}

const cases: Case[] = [
  {
    name: '신호 존재 → /signals/{id} 경로 반환(카드 노출 + 이동)',
    input: badge('sig_1'),
    expected: '/signals/sig_1',
    expectVisible: true,
  },
  {
    name: '신호 없음(null) → null(카드 미표시)',
    input: null,
    expected: null,
    expectVisible: false,
  },
  {
    name: '미조회(undefined, 게스트/로딩) → null(카드 미표시)',
    input: undefined,
    expected: null,
    expectVisible: false,
  },
  {
    name: 'id 결손(방어) → null(가짜 이동 경로 금지)',
    input: { ...badge(''), id: '' },
    expected: null,
    expectVisible: false,
  },
];

let failures = 0;
for (const c of cases) {
  const target = disclosureSignalTarget(c.input);
  const visible = target !== null;
  const ok = target === c.expected && visible === c.expectVisible;
  if (!ok) failures++;
  console.log(
    `${ok ? 'PASS' : 'FAIL'} | ${c.name}\n` +
      `   target=${String(target)} [기대 ${String(c.expected)}] · 노출=${visible} [기대 ${c.expectVisible}]`,
  );
}

console.log(`\n결과: ${cases.length - failures}/${cases.length} PASS`);
if (failures > 0) {
  console.error('FAILURES present');
  process.exit(1);
}
console.log('All scenarios passed');
