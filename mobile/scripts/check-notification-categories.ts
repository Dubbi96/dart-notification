/**
 * DAR-430 결정론적 검증: 알림 카테고리화 SSOT 와 제목 [ ]프리픽스 제거.
 * DAR-473(P01): 운영(system) 버킷 추가 — 4 버킷·4 채널.
 *
 * 검증 항목:
 *  (1) 모든 NotificationType 이 정확히 한 카테고리(disclosure/signal/trade/system)로 매핑된다.
 *  (2) 버킷 구성: 공시=DISCLOSURE / 신호=SIGNAL·EXIT·THESIS_VIOLATED / 체결=TRADE_ENTRY·TRADE_EXIT /
 *      운영=RISK_ALERT·OPS_ALERT.
 *  (3) Android 채널 ID(=백엔드 Expo push channelId)가 4개·고유·예상값('disclosure'/'signal'/'trade'/'system').
 *  (4) 체결 알림 제목에 [ ]대괄호가 없다(출처는 이모지+출처명으로 전달 — DAR-432 정합).
 *
 * 실행: npx tsx scripts/check-notification-categories.ts  (실패 시 exit 1)
 */
import {
  NOTIFICATION_CATEGORY,
  CATEGORY_CHANNEL_ID,
  type NotificationType,
  type NotificationCategory,
} from '../types/notification.types';

const ALL_TYPES: NotificationType[] = [
  'DISCLOSURE',
  'SIGNAL',
  'EXIT',
  'THESIS_VIOLATED',
  'TRADE_ENTRY',
  'TRADE_EXIT',
  // DAR-473(P01): 리스크·운영 알림 타입.
  'RISK_ALERT',
  'OPS_ALERT',
];

// 백엔드 notify.consumer.handleTrade 의 제목 산출(DAR-432 2026-07-06 개정: 출처명 텍스트판)을 순수 재현.
// 출처명(srcPrefix 예: '단타')는 NOTIFICATION_SOURCES(SSOT)에서 오며, 여기서는 대괄호 부재만 본다.
function tradeTitle(srcPrefix: string, kind: 'ENTRY' | 'EXIT', label: string, pctText: string): string {
  if (kind === 'ENTRY') return `${srcPrefix} · ${label} 매수`;
  return `${srcPrefix} · ${label} 매도${pctText ? ` ${pctText}` : ''}`;
}

let failures = 0;
function check(name: string, cond: boolean) {
  if (!cond) {
    console.error(`✗ ${name}`);
    failures += 1;
  } else {
    console.log(`✓ ${name}`);
  }
}

// (1) 전 타입 매핑 존재
for (const t of ALL_TYPES) {
  check(`type ${t} 카테고리 매핑 존재`, NOTIFICATION_CATEGORY[t] !== undefined);
}

// (2) 버킷 구성
const expectedCategory: Record<NotificationType, NotificationCategory> = {
  DISCLOSURE: 'disclosure',
  SIGNAL: 'signal',
  EXIT: 'signal',
  THESIS_VIOLATED: 'signal',
  TRADE_ENTRY: 'trade',
  TRADE_EXIT: 'trade',
  // DAR-473(P01): 리스크·운영 → 'system' 버킷.
  RISK_ALERT: 'system',
  OPS_ALERT: 'system',
};
for (const t of ALL_TYPES) {
  check(
    `${t} → ${expectedCategory[t]}`,
    NOTIFICATION_CATEGORY[t] === expectedCategory[t],
  );
}

// (3) 채널 ID 고유·예상값 (DAR-473 P01: 'system' 채널 추가 → 4개)
const channelIds = Object.values(CATEGORY_CHANNEL_ID);
check('채널 ID 4개', channelIds.length === 4);
check('채널 ID 고유', new Set(channelIds).size === 4);
check(
  "채널 ID = disclosure/signal/trade/system",
  CATEGORY_CHANNEL_ID.disclosure === 'disclosure' &&
    CATEGORY_CHANNEL_ID.signal === 'signal' &&
    CATEGORY_CHANNEL_ID.trade === 'trade' &&
    CATEGORY_CHANNEL_ID.system === 'system',
);

// (4) 제목 [ ]대괄호 부재(출처는 출처명 텍스트 프리픽스로 — DAR-432 개정)
const entryTitle = tradeTitle('단타', 'ENTRY', '삼성전자', '');
const exitTitle = tradeTitle('단타', 'EXIT', '삼성전자', '+2.10%');
check('매수 제목 = "단타 · 삼성전자 매수"', entryTitle === '단타 · 삼성전자 매수');
check('매도 제목 = "단타 · 삼성전자 매도 +2.10%"', exitTitle === '단타 · 삼성전자 매도 +2.10%');
check(
  '제목에 [ ]대괄호 없음',
  !entryTitle.includes('[') &&
    !exitTitle.includes('[') &&
    !entryTitle.includes(']') &&
    !exitTitle.includes(']'),
);

if (failures > 0) {
  console.error(`\n실패 ${failures}건`);
  process.exit(1);
}
console.log('\n모든 검증 통과 (DAR-430 카테고리/채널/제목)');
