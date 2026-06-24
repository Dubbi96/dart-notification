/**
 * DAR-432 결정론적 검증: 출처별 이모지+출처명 SSOT(be↔fe 공유) + 메시지 템플릿.
 *
 * 검증 항목:
 *  (1) 출처 매핑이 기획 명세와 1:1(공시📢·신호📈·모의🤖·단타⚡·이벤트엣지🎯·보수가치🛡️·단기모멘텀🚀·공격분산💥).
 *  (2) 이모지가 출처마다 고유(중복 0) — 한눈 식별 보장.
 *  (3) 체결/신호/공시 제목 템플릿이 기획 형식과 일치하고 [ ]대괄호가 없다(DAR-430·이모지+· 정합).
 *  (4) sourceByType 매핑(체결 외 타입) + 미상 키 폴백(🔔).
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
} from '../utils/notificationSource';

const EXPECTED: Record<string, { emoji: string; label: string }> = {
  disclosure: { emoji: '📢', label: '공시' },
  signal: { emoji: '📈', label: '매수신호' },
  exit: { emoji: '🔻', label: '청산' },
  thesis: { emoji: '⚠️', label: '논리훼손' },
  'paper-simulation': { emoji: '🤖', label: '모의' },
  'intraday-scalp': { emoji: '⚡', label: '단타' },
  'event-edge': { emoji: '🎯', label: '이벤트엣지' },
  'short-momentum': { emoji: '🚀', label: '단기모멘텀' },
  'conservative-value': { emoji: '🛡️', label: '보수가치' },
  'aggressive-diversified': { emoji: '💥', label: '공격분산' },
};

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
  check(`${key} → ${exp.emoji} ${exp.label}`, !!src && src.emoji === exp.emoji && src.label === exp.label);
}

// (2) 이모지 고유
const emojis = Object.values(NOTIFICATION_SOURCES).map((s) => s.emoji);
check('이모지 고유(중복 0)', new Set(emojis).size === emojis.length);

// (3) 제목 템플릿 — 백엔드 notify.consumer 산출을 순수 재현(be↔fe 형식 동일).
function tradeTitle(strategyKey: string, kind: 'ENTRY' | 'EXIT', label: string, pct: string): string {
  const src = sourceByKey(strategyKey);
  if (kind === 'ENTRY') return `${sourcePrefix(src)} · ${label} 매수`;
  return `${sourcePrefix(src)} · ${label} 매도${pct ? ` ${pct}` : ''}`;
}
const simEntry = tradeTitle('paper-simulation', 'ENTRY', '삼성전자', '');
const scalpExit = tradeTitle('intraday-scalp', 'EXIT', '삼성전자', '+2.10%');
const edgeEntry = tradeTitle('event-edge', 'ENTRY', '삼성전자', '');
check('시스템 모의 매수 제목 = "🤖 모의 · 삼성전자 매수"', simEntry === '🤖 모의 · 삼성전자 매수');
check('단타 매도 제목 = "⚡ 단타 · 삼성전자 매도 +2.10%"', scalpExit === '⚡ 단타 · 삼성전자 매도 +2.10%');
check('이벤트엣지 매수 제목 = "🎯 이벤트엣지 · 삼성전자 매수"', edgeEntry === '🎯 이벤트엣지 · 삼성전자 매수');
check(
  '체결 제목에 [ ]대괄호 없음',
  ![simEntry, scalpExit, edgeEntry].some((t) => t.includes('[') || t.includes(']')),
);

// 공시 인앱 행 프리픽스(조인 데이터 렌더) — '📢 {기업명} · {공시유형}'
const disclosurePrefix = `${sourceByType('DISCLOSURE').emoji} 삼성전자 · 단일판매ㆍ공급계약체결`;
check('공시 행 = "📢 삼성전자 · …"', disclosurePrefix.startsWith('📢 삼성전자 · '));

// (4) sourceByType + 폴백
check('sourceByType DISCLOSURE → 📢', sourceByType('DISCLOSURE').emoji === '📢');
check('sourceByType SIGNAL → 📈', sourceByType('SIGNAL').emoji === '📈');
check('sourceByType TRADE_ENTRY → 폴백(🔔)', sourceByType('TRADE_ENTRY') === FALLBACK_SOURCE);
check('미상 strategyKey → 폴백(🔔)', sourceByKey('nope') === FALLBACK_SOURCE);

if (failures > 0) {
  console.error(`\n실패 ${failures}건`);
  process.exit(1);
}
console.log('\n모든 검증 통과 (DAR-432 출처 SSOT/템플릿/폴백)');
