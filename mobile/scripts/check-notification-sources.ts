/**
 * DAR-432(2026-07-06 이모지 제거 개정) 결정론적 검증: 출처명 SSOT(be↔fe 공유) + 메시지 템플릿.
 *
 * 검증 항목:
 *  (1) 출처 매핑이 기획 명세와 1:1(공시·매수신호·모의·단타·이벤트엣지·보수가치·단기모멘텀·공격분산·리스크·운영).
 *  (2) 라벨이 출처마다 고유(중복 0) + 이모지 미포함 — 텍스트만으로 식별 보장.
 *  (3) 체결/신호/공시 제목 템플릿이 기획 형식과 일치하고 [ ]대괄호·이모지가 없다(DAR-430 정합).
 *  (4) sourceByType 매핑(체결 외 타입) + 미상 키 폴백('알림').
 *
 * ★be↔fe SSOT: 아래 EXPECTED 는 백엔드 notification-source.ts 와 동일해야 한다.
 *   백엔드(notification-source.spec.ts)와 본 스크립트가 같은 EXPECTED 를 단정해 드리프트를 차단한다.
 *
 * 실행: npx tsx scripts/check-notification-sources.ts  (실패 시 exit 1)
 */
import {
  NOTIFICATION_SOURCES,
  FALLBACK_SOURCE,
  sourceByKey,
  sourceByType,
  sourcePrefix,
  stripSourceEmoji,
} from '../utils/notificationSource';

const EXPECTED: Record<string, { label: string }> = {
  disclosure: { label: '공시' },
  signal: { label: '매수신호' },
  exit: { label: '청산' },
  thesis: { label: '논리훼손' },
  'paper-simulation': { label: '모의' },
  'intraday-scalp': { label: '단타' },
  'event-edge': { label: '이벤트엣지' },
  'short-momentum': { label: '단기모멘텀' },
  'conservative-value': { label: '보수가치' },
  'aggressive-diversified': { label: '공격분산' },
  // DAR-473(P01): 리스크·운영 출처.
  risk: { label: '리스크' },
  ops: { label: '운영' },
};

const EMOJI_RE = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}]/u;
const hasEmoji = (t: string): boolean => EMOJI_RE.test(t) || t.includes('\uFE0F');

let failures = 0;
function check(name: string, cond: boolean) {
  if (!cond) {
    console.error(`✗ ${name}`);
    failures += 1;
  } else {
    console.log(`✓ ${name}`);
  }
}

// (1) 출처 매핑 1:1
check(
  `출처 키 개수 = ${Object.keys(EXPECTED).length}`,
  Object.keys(NOTIFICATION_SOURCES).length === Object.keys(EXPECTED).length,
);
for (const [key, exp] of Object.entries(EXPECTED)) {
  const src = NOTIFICATION_SOURCES[key];
  check(`${key} → ${exp.label}`, !!src && src.label === exp.label);
}

// (2) 라벨 고유 + 이모지 미포함
const labels = Object.values(NOTIFICATION_SOURCES).map((s) => s.label);
check('라벨 고유(중복 0)', new Set(labels).size === labels.length);
check(
  '라벨·프리픽스에 이모지 없음(2026-07-06 개정)',
  ![...Object.values(NOTIFICATION_SOURCES), FALLBACK_SOURCE].some(
    (s) => hasEmoji(s.label) || hasEmoji(sourcePrefix(s)),
  ),
);

// (3) 제목 템플릿 — 백엔드 notify.consumer 산출을 순수 재현(be↔fe 형식 동일).
function tradeTitle(strategyKey: string, kind: 'ENTRY' | 'EXIT', label: string, pct: string): string {
  const src = sourceByKey(strategyKey);
  if (kind === 'ENTRY') return `${sourcePrefix(src)} · ${label} 매수`;
  return `${sourcePrefix(src)} · ${label} 매도${pct ? ` ${pct}` : ''}`;
}
const simEntry = tradeTitle('paper-simulation', 'ENTRY', '삼성전자', '');
const scalpExit = tradeTitle('intraday-scalp', 'EXIT', '삼성전자', '+2.10%');
const edgeEntry = tradeTitle('event-edge', 'ENTRY', '삼성전자', '');
check('시스템 모의 매수 제목 = "모의 · 삼성전자 매수"', simEntry === '모의 · 삼성전자 매수');
check('단타 매도 제목 = "단타 · 삼성전자 매도 +2.10%"', scalpExit === '단타 · 삼성전자 매도 +2.10%');
check('이벤트엣지 매수 제목 = "이벤트엣지 · 삼성전자 매수"', edgeEntry === '이벤트엣지 · 삼성전자 매수');
check(
  '체결 제목에 [ ]대괄호·이모지 없음',
  ![simEntry, scalpExit, edgeEntry].some(
    (t) => t.includes('[') || t.includes(']') || hasEmoji(t),
  ),
);

// 공시 인앱 행 프리픽스(조인 데이터 렌더) — '{기업명} · {공시유형}' (이모지 미사용)
const disclosureTitle = `삼성전자 · 단일판매ㆍ공급계약체결`;
check('공시 행 = "삼성전자 · …" (이모지 없음)', !hasEmoji(disclosureTitle));

// (5) DAR-473(P01): 리스크·운영 타입 → 출처 매핑(백엔드 sourceByType 미러).
check('RISK_ALERT → 리스크', sourceByType('RISK_ALERT').label === '리스크');
check('OPS_ALERT → 운영', sourceByType('OPS_ALERT').label === '운영');

// (4) sourceByType + 폴백
check('sourceByType DISCLOSURE → 공시', sourceByType('DISCLOSURE').label === '공시');
check('sourceByType SIGNAL → 매수신호', sourceByType('SIGNAL').label === '매수신호');
check('sourceByType TRADE_ENTRY → 폴백(알림)', sourceByType('TRADE_ENTRY') === FALLBACK_SOURCE);
check('미상 strategyKey → 폴백(알림)', sourceByKey('nope') === FALLBACK_SOURCE);

// (6) 레거시 인박스 제목(과거 이모지 발행분) strip 회귀 — 동결 목록 유지 검증.
check(
  '레거시 제목 strip = "단타 · …"',
  stripSourceEmoji('⚡ 단타 · 삼성전자 매도 +2.10%') === '단타 · 삼성전자 매도 +2.10%',
);
check('신규 제목 통과(무변경)', stripSourceEmoji('모의 · 삼성전자 매수') === '모의 · 삼성전자 매수');

if (failures > 0) {
  console.error(`\n실패 ${failures}건`);
  process.exit(1);
}
console.log('\n모든 검증 통과 (출처 SSOT/템플릿/폴백 — 이모지 미사용)');
