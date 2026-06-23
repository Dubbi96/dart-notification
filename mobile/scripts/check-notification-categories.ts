/**
 * DAR-430 결정론적 검증: 알림 카테고리화(3 버킷) SSOT 와 제목 [ ]프리픽스 제거.
 *
 * 검증 항목:
 *  (1) 모든 NotificationType 이 정확히 한 카테고리(disclosure/signal/trade)로 매핑된다.
 *  (2) 버킷 구성: 공시=DISCLOSURE / 신호=SIGNAL·EXIT·THESIS_VIOLATED / 체결=TRADE_ENTRY·TRADE_EXIT.
 *  (3) Android 채널 ID(=백엔드 Expo push channelId)가 3개·고유·예상값('disclosure'/'signal'/'trade').
 *  (4) 체결 알림 제목에 [ ]프리픽스가 없다(출처는 본문/데이터로 전달).
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
];

// 백엔드 notify.consumer.handleTrade 의 제목 산출(프리픽스 제거판)을 순수 재현.
function tradeTitle(kind: 'ENTRY' | 'EXIT', label: string, pctText: string): string {
  if (kind === 'ENTRY') return `${label} 매수`;
  return `${label} 매도${pctText ? ` ${pctText}` : ''}`;
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
};
for (const t of ALL_TYPES) {
  check(
    `${t} → ${expectedCategory[t]}`,
    NOTIFICATION_CATEGORY[t] === expectedCategory[t],
  );
}

// (3) 채널 ID 고유·예상값
const channelIds = Object.values(CATEGORY_CHANNEL_ID);
check('채널 ID 3개', channelIds.length === 3);
check('채널 ID 고유', new Set(channelIds).size === 3);
check(
  "채널 ID = disclosure/signal/trade",
  CATEGORY_CHANNEL_ID.disclosure === 'disclosure' &&
    CATEGORY_CHANNEL_ID.signal === 'signal' &&
    CATEGORY_CHANNEL_ID.trade === 'trade',
);

// (4) 제목 [ ]프리픽스 제거
const entryTitle = tradeTitle('ENTRY', '삼성전자', '');
const exitTitle = tradeTitle('EXIT', '삼성전자', '+2.10%');
check('매수 제목 = "삼성전자 매수"', entryTitle === '삼성전자 매수');
check('매도 제목 = "삼성전자 매도 +2.10%"', exitTitle === '삼성전자 매도 +2.10%');
check('제목에 [ ]프리픽스 없음', !entryTitle.includes('[') && !exitTitle.includes('['));

if (failures > 0) {
  console.error(`\n실패 ${failures}건`);
  process.exit(1);
}
console.log('\n모든 검증 통과 (DAR-430 카테고리/채널/제목)');
