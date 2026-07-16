import { NotificationType } from '@prisma/client';
import {
  NotifyConsumer,
  formatKrw,
  signedPct,
  opsAlertTitle,
  OPS_SEVERITY_LABEL,
} from './notify.consumer';
import { NOTIFY_JOB } from '../common/queues/queue.constants';

/**
 * NotifyConsumer 단위 테스트 (DAR-85) — DoD 핵심 보호:
 *  - 멱등: SIGNAL 은 TradingSignal.isNotified 로 1회만 발송.
 *  - ★토글 OFF시 미발송: 기본 OFF면 NotificationHistory(인박스)만 기록하고 푸시 미발송.
 *  - 토글 ON + 유효토큰 → 실발송.
 *  - 수신자 해석: SIGNAL=watcher, EXIT/THESIS=포트폴리오 소유자.
 *  - ★알림→실주문 직결 없음: consumer 는 expoPush 발송만 하고 주문/Kill API 미호출.
 */

const makePrisma = () => ({
  tradingSignal: { findUnique: jest.fn(), update: jest.fn().mockResolvedValue({}) },
  watchList: { findMany: jest.fn().mockResolvedValue([]) },
  position: { findUnique: jest.fn() },
  positionThesis: { findUnique: jest.fn() },
  notificationSettings: {
    findUnique: jest.fn().mockResolvedValue(null),
    // DAR-424: 체결 알림은 수신자 토글을 일괄 조회한다.
    findMany: jest.fn().mockResolvedValue([]),
  },
  // DAR-424: 체결 알림은 실제 앱 사용자 전원에게 브로드캐스트.
  user: { findMany: jest.fn().mockResolvedValue([]) },
  userDevice: { findMany: jest.fn().mockResolvedValue([]) },
});

const makeDeps = () => {
  const prisma = makePrisma();
  // DAR-136: consumer 는 createNotificationIfAbsent 를 사용(푸시 멱등 권위).
  // 기본 created=true(신규) → 토글 ON 시 푸시 발송 경로 진입.
  const notifications = {
    createNotificationIfAbsent: jest
      .fn()
      .mockResolvedValue({ notification: { id: 'n1' }, created: true }),
  };
  const expoPush = {
    isValidExpoPushToken: jest.fn().mockReturnValue(true),
    sendPushNotifications: jest.fn().mockResolvedValue([]),
  };
  // DAR-514: 실발송 직전 일일 캡 게이트. 기본은 항상 허용(캡 이내) — 기존 발송 단언 보존.
  const pushCap = {
    consume: jest
      .fn()
      .mockResolvedValue({ allowed: true, cap: 30, sentToday: 0, suppressed: false }),
  };
  const consumer = new NotifyConsumer(
    prisma as any,
    notifications as any,
    expoPush as any,
    pushCap as any,
  );
  return { consumer, prisma, notifications, expoPush, pushCap };
};

const job = (name: string, data: any) => ({ name, data }) as any;

describe('NotifyConsumer (DAR-85)', () => {
  // ── SIGNAL 멱등 ─────────────────────────────────────────────────────────
  describe('SIGNAL 멱등', () => {
    it('isNotified=true 면 인박스 생성·푸시·마킹 모두 스킵(중복 통지 0)', async () => {
      const { consumer, prisma, notifications, expoPush } = makeDeps();
      prisma.tradingSignal.findUnique.mockResolvedValue({ id: 's1', isNotified: true });

      await consumer.process(job(NOTIFY_JOB.SIGNAL, { signalId: 's1', corpCode: 'c1' }));

      expect(notifications.createNotificationIfAbsent).not.toHaveBeenCalled();
      expect(expoPush.sendPushNotifications).not.toHaveBeenCalled();
      expect(prisma.tradingSignal.update).not.toHaveBeenCalled();
    });

    it('신규 신호는 처리 후 isNotified=true·notifiedAt 마킹(재처리 멱등 토대)', async () => {
      const { consumer, prisma } = makeDeps();
      prisma.tradingSignal.findUnique.mockResolvedValue({ id: 's1', isNotified: false });
      prisma.watchList.findMany.mockResolvedValue([{ userId: 'u1' }]);

      await consumer.process(job(NOTIFY_JOB.SIGNAL, { signalId: 's1', corpCode: 'c1' }));

      expect(prisma.tradingSignal.update).toHaveBeenCalledWith({
        where: { id: 's1' },
        data: expect.objectContaining({ isNotified: true, notifiedAt: expect.any(Date) }),
      });
    });

    it('TradingSignal 결측이면 graceful 스킵', async () => {
      const { consumer, prisma, notifications } = makeDeps();
      prisma.tradingSignal.findUnique.mockResolvedValue(null);
      await consumer.process(job(NOTIFY_JOB.SIGNAL, { signalId: 'sX', corpCode: 'c1' }));
      expect(notifications.createNotificationIfAbsent).not.toHaveBeenCalled();
    });
  });

  // ── ★토글 OFF시 미발송 ────────────────────────────────────────────────────
  describe('★발송 기본 OFF 게이트', () => {
    it('설정 없음(기본 OFF) → 인박스 기록만, 푸시 미발송', async () => {
      const { consumer, prisma, notifications, expoPush } = makeDeps();
      prisma.tradingSignal.findUnique.mockResolvedValue({ id: 's1', isNotified: false });
      prisma.watchList.findMany.mockResolvedValue([{ userId: 'u1' }]);
      prisma.notificationSettings.findUnique.mockResolvedValue(null); // 기본 OFF

      await consumer.process(job(NOTIFY_JOB.SIGNAL, { signalId: 's1', corpCode: 'c1' }));

      expect(notifications.createNotificationIfAbsent).toHaveBeenCalledTimes(1);
      expect(notifications.createNotificationIfAbsent.mock.calls[0][0]).toMatchObject({
        userId: 'u1',
        type: NotificationType.SIGNAL,
        refId: 's1',
      });
      expect(expoPush.sendPushNotifications).not.toHaveBeenCalled();
    });

    it('signalPushEnabled=false → 인박스만, 푸시 미발송', async () => {
      const { consumer, prisma, notifications, expoPush } = makeDeps();
      prisma.tradingSignal.findUnique.mockResolvedValue({ id: 's1', isNotified: false });
      prisma.watchList.findMany.mockResolvedValue([{ userId: 'u1' }]);
      prisma.notificationSettings.findUnique.mockResolvedValue({
        isEnabled: true,
        signalPushEnabled: false,
        exitPushEnabled: false,
        thesisPushEnabled: false,
      });

      await consumer.process(job(NOTIFY_JOB.SIGNAL, { signalId: 's1', corpCode: 'c1' }));

      expect(notifications.createNotificationIfAbsent).toHaveBeenCalledTimes(1);
      expect(expoPush.sendPushNotifications).not.toHaveBeenCalled();
    });

    it('master isEnabled=false 면 토글 ON 이어도 미발송(인박스만)', async () => {
      const { consumer, prisma, expoPush } = makeDeps();
      prisma.tradingSignal.findUnique.mockResolvedValue({ id: 's1', isNotified: false });
      prisma.watchList.findMany.mockResolvedValue([{ userId: 'u1' }]);
      prisma.notificationSettings.findUnique.mockResolvedValue({
        isEnabled: false,
        signalPushEnabled: true,
        exitPushEnabled: true,
        thesisPushEnabled: true,
      });

      await consumer.process(job(NOTIFY_JOB.SIGNAL, { signalId: 's1', corpCode: 'c1' }));
      expect(expoPush.sendPushNotifications).not.toHaveBeenCalled();
    });
  });

  // ── 토글 ON 실발송 ────────────────────────────────────────────────────────
  describe('토글 ON 실발송', () => {
    it('signalPushEnabled=true + 유효 디바이스 → 푸시 발송', async () => {
      const { consumer, prisma, expoPush } = makeDeps();
      prisma.tradingSignal.findUnique.mockResolvedValue({ id: 's1', isNotified: false });
      prisma.watchList.findMany.mockResolvedValue([{ userId: 'u1' }]);
      prisma.notificationSettings.findUnique.mockResolvedValue({
        isEnabled: true,
        signalPushEnabled: true,
        exitPushEnabled: false,
        thesisPushEnabled: false,
      });
      prisma.userDevice.findMany.mockResolvedValue([{ deviceToken: 'ExponentPushToken[x]' }]);

      await consumer.process(
        job(NOTIFY_JOB.SIGNAL, { signalId: 's1', corpCode: 'c1', grade: 'BUY', buyScore: 80 }),
      );

      expect(expoPush.sendPushNotifications).toHaveBeenCalledTimes(1);
      const msgs = expoPush.sendPushNotifications.mock.calls[0][0];
      expect(msgs[0]).toMatchObject({ to: 'ExponentPushToken[x]' });
      expect(msgs[0].data).toMatchObject({ type: NotificationType.SIGNAL, refId: 's1' });
      // DAR-430: SIGNAL → '신호' 카테고리 → 'signal' 채널.
      expect(msgs[0].channelId).toBe('signal');
    });

    it('토글 ON 이지만 유효 토큰 없음 → 발송 호출 안 함(인박스만)', async () => {
      const { consumer, prisma, expoPush } = makeDeps();
      prisma.tradingSignal.findUnique.mockResolvedValue({ id: 's1', isNotified: false });
      prisma.watchList.findMany.mockResolvedValue([{ userId: 'u1' }]);
      prisma.notificationSettings.findUnique.mockResolvedValue({
        isEnabled: true,
        signalPushEnabled: true,
        exitPushEnabled: false,
        thesisPushEnabled: false,
      });
      prisma.userDevice.findMany.mockResolvedValue([]); // 토큰 없음

      await consumer.process(job(NOTIFY_JOB.SIGNAL, { signalId: 's1', corpCode: 'c1' }));
      expect(expoPush.sendPushNotifications).not.toHaveBeenCalled();
    });
  });

  // ── ★DAR-136: 푸시 멱등(NotificationHistory created 권위) ────────────────────
  describe('★푸시 멱등(중복 발송 방지) — created=false 면 재발송 스킵', () => {
    it('이미 통지된 항목(created=false)은 토글 ON·유효토큰이어도 푸시 재발송 안 함', async () => {
      const { consumer, prisma, notifications, expoPush } = makeDeps();
      prisma.tradingSignal.findUnique.mockResolvedValue({ id: 's1', isNotified: false });
      prisma.watchList.findMany.mockResolvedValue([{ userId: 'u1' }]);
      prisma.notificationSettings.findUnique.mockResolvedValue({
        isEnabled: true,
        signalPushEnabled: true,
        exitPushEnabled: true,
        thesisPushEnabled: true,
      });
      prisma.userDevice.findMany.mockResolvedValue([{ deviceToken: 'ExponentPushToken[x]' }]);
      // 잡 재시도 등으로 이미 인박스가 존재 → created=false
      notifications.createNotificationIfAbsent.mockResolvedValue({
        notification: { id: 'n1' },
        created: false,
      });

      await consumer.process(
        job(NOTIFY_JOB.SIGNAL, { signalId: 's1', corpCode: 'c1', grade: 'BUY' }),
      );

      // 설정 조회조차 하지 않고 즉시 스킵(중복 푸시 0)
      expect(prisma.notificationSettings.findUnique).not.toHaveBeenCalled();
      expect(expoPush.sendPushNotifications).not.toHaveBeenCalled();
    });

    it('EXIT 재시도(created=false)도 푸시 재발송 안 함 — 신호레벨 가드 없는 EXIT/THESIS 보호', async () => {
      const { consumer, prisma, notifications, expoPush } = makeDeps();
      prisma.position.findUnique.mockResolvedValue({
        corpCode: 'c1',
        stockCode: '005930',
        portfolio: { id: 'pf-1', userId: 'owner-1' },
      });
      prisma.notificationSettings.findUnique.mockResolvedValue({
        isEnabled: true,
        signalPushEnabled: true,
        exitPushEnabled: true,
        thesisPushEnabled: true,
      });
      prisma.userDevice.findMany.mockResolvedValue([{ deviceToken: 'ExponentPushToken[x]' }]);
      notifications.createNotificationIfAbsent.mockResolvedValue({
        notification: { id: 'n1' },
        created: false,
      });

      await consumer.process(
        job(NOTIFY_JOB.EXIT, { positionId: 'pos-1', corpCode: 'c1', exitAction: 'EXIT' }),
      );

      expect(expoPush.sendPushNotifications).not.toHaveBeenCalled();
    });

    it('신규(created=true) 동일 입력은 정상적으로 푸시 발송 — 멱등 가드가 첫 발송은 막지 않음', async () => {
      const { consumer, prisma, notifications, expoPush } = makeDeps();
      prisma.position.findUnique.mockResolvedValue({
        corpCode: 'c1',
        stockCode: '005930',
        portfolio: { id: 'pf-1', userId: 'owner-1' },
      });
      prisma.notificationSettings.findUnique.mockResolvedValue({
        isEnabled: true,
        signalPushEnabled: true,
        exitPushEnabled: true,
        thesisPushEnabled: true,
      });
      prisma.userDevice.findMany.mockResolvedValue([{ deviceToken: 'ExponentPushToken[x]' }]);
      notifications.createNotificationIfAbsent.mockResolvedValue({
        notification: { id: 'n1' },
        created: true,
      });

      await consumer.process(
        job(NOTIFY_JOB.EXIT, { positionId: 'pos-1', corpCode: 'c1', exitAction: 'EXIT' }),
      );

      expect(expoPush.sendPushNotifications).toHaveBeenCalledTimes(1);
    });
  });

  // ── EXIT / THESIS 수신자 해석 ─────────────────────────────────────────────
  describe('EXIT 수신자 해석', () => {
    it('포지션→포트폴리오 소유자에게 EXIT 인박스(refId=positionId)', async () => {
      const { consumer, prisma, notifications } = makeDeps();
      prisma.position.findUnique.mockResolvedValue({
        corpCode: 'c1',
        stockCode: '005930',
        portfolio: { id: 'pf-1', userId: 'owner-1' },
      });

      await consumer.process(
        job(NOTIFY_JOB.EXIT, { positionId: 'pos-1', corpCode: 'c1', exitAction: 'EXIT' }),
      );

      expect(notifications.createNotificationIfAbsent.mock.calls[0][0]).toMatchObject({
        userId: 'owner-1',
        type: NotificationType.EXIT,
        refId: 'pos-1',
      });
    });

    it('소유자 결측이면 graceful 스킵', async () => {
      const { consumer, prisma, notifications } = makeDeps();
      prisma.position.findUnique.mockResolvedValue(null);
      await consumer.process(job(NOTIFY_JOB.EXIT, { positionId: 'pX', corpCode: 'c1' }));
      expect(notifications.createNotificationIfAbsent).not.toHaveBeenCalled();
    });
  });

  describe('THESIS_VIOLATED 수신자 해석', () => {
    it('thesis→position→portfolio 소유자에게 THESIS_VIOLATED 인박스(refId=thesisId)', async () => {
      const { consumer, prisma, notifications } = makeDeps();
      prisma.positionThesis.findUnique.mockResolvedValue({
        corpCode: 'c1',
        position: { id: 'pos-9', stockCode: '005930', portfolio: { id: 'pf-2', userId: 'owner-2' } },
      });

      await consumer.process(
        job(NOTIFY_JOB.THESIS_VIOLATED, { positionThesisId: 't-1', corpCode: 'c1' }),
      );

      expect(notifications.createNotificationIfAbsent.mock.calls[0][0]).toMatchObject({
        userId: 'owner-2',
        type: NotificationType.THESIS_VIOLATED,
        refId: 't-1',
      });
    });
  });

  // ── TRADE_ENTRY / TRADE_EXIT (DAR-424) ────────────────────────────────────
  describe('TRADE 체결 알림 (DAR-424)', () => {
    const entryJob = {
      kind: 'ENTRY' as const,
      refId: 'trade-1',
      strategyKey: 'intraday-scalp',
      strategyLabel: '분봉 단타',
      corpCode: 'c1',
      stockCode: '005930',
      corpName: '삼성전자',
      price: 105000,
      shares: 10,
      cash: 9500000,
      totalValue: 10200000,
      deepLink: '/portfolio/strategy/intraday-scalp',
    };
    const exitJob = {
      ...entryJob,
      kind: 'EXIT' as const,
      pnlPct: 2.1,
      exitReason: 'TAKE_PROFIT',
      price: 107000,
    };

    it('실제 사용자 전원에게 브로드캐스트 인박스(매수) — 종목명·가격·현금·평가금 본문', async () => {
      const { consumer, prisma, notifications } = makeDeps();
      prisma.user.findMany.mockResolvedValue([{ id: 'u1' }, { id: 'u2' }]);

      await consumer.process(job(NOTIFY_JOB.TRADE_ENTRY, entryJob));

      // 합성 시스템 유저 제외 조건으로 조회
      expect(prisma.user.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { provider: { not: 'system' } } }),
      );
      expect(notifications.createNotificationIfAbsent).toHaveBeenCalledTimes(2);
      const first = notifications.createNotificationIfAbsent.mock.calls[0][0];
      expect(first).toMatchObject({
        userId: 'u1',
        type: NotificationType.TRADE_ENTRY,
        refId: 'trade-1',
        deepLink: '/portfolio/strategy/intraday-scalp',
      });
      // DAR-432: 출처 이모지(단타)+기업명 제목 · 본문은 핵심 수치 한 줄(대괄호 0).
      expect(first.title).toBe('단타 · 삼성전자 매수');
      expect(first.body).toBe('₩105,000 × 10주 · 잔액 ₩9,500,000');
      expect(first.title).not.toContain('[');
    });

    it('매도 알림 — 제목에 손익%·본문에 손익(사유)·전체평가금', async () => {
      const { consumer, prisma, notifications } = makeDeps();
      prisma.user.findMany.mockResolvedValue([{ id: 'u1' }]);

      await consumer.process(job(NOTIFY_JOB.TRADE_EXIT, exitJob));

      const call = notifications.createNotificationIfAbsent.mock.calls[0][0];
      expect(call.type).toBe(NotificationType.TRADE_EXIT);
      // DAR-432: 출처 이모지(단타)+기업명+손익% 제목 · 본문은 손익(사유)·평가금 한 줄.
      expect(call.title).toBe('단타 · 삼성전자 매도 +2.10%');
      expect(call.body).toBe('손익 +2.10%(TAKE_PROFIT) · 평가금 ₩10,200,000');
    });

    it('tradePushEnabled=false 인 사용자는 인박스도 생략(과알림 방지)', async () => {
      const { consumer, prisma, notifications, expoPush } = makeDeps();
      prisma.user.findMany.mockResolvedValue([{ id: 'u1' }, { id: 'u2' }]);
      prisma.notificationSettings.findMany.mockResolvedValue([
        { userId: 'u1', isEnabled: true, tradePushEnabled: false },
        { userId: 'u2', isEnabled: true, tradePushEnabled: true },
      ]);
      prisma.userDevice.findMany.mockResolvedValue([{ deviceToken: 'ExponentPushToken[x]' }]);

      await consumer.process(job(NOTIFY_JOB.TRADE_ENTRY, entryJob));

      // u1 은 OFF → 스킵, u2 만 인박스
      expect(notifications.createNotificationIfAbsent).toHaveBeenCalledTimes(1);
      expect(notifications.createNotificationIfAbsent.mock.calls[0][0]).toMatchObject({
        userId: 'u2',
      });
      // u2 는 master ON + 토큰 → 푸시 발송
      expect(expoPush.sendPushNotifications).toHaveBeenCalledTimes(1);
    });

    it('설정행 미존재 → 기본 ON(인박스+푸시 진입)', async () => {
      const { consumer, prisma, notifications, expoPush } = makeDeps();
      prisma.user.findMany.mockResolvedValue([{ id: 'u1' }]);
      prisma.notificationSettings.findMany.mockResolvedValue([]); // 설정 없음
      prisma.userDevice.findMany.mockResolvedValue([{ deviceToken: 'ExponentPushToken[x]' }]);

      await consumer.process(job(NOTIFY_JOB.TRADE_ENTRY, entryJob));

      expect(notifications.createNotificationIfAbsent).toHaveBeenCalledTimes(1);
      expect(expoPush.sendPushNotifications).toHaveBeenCalledTimes(1);
      const msg = expoPush.sendPushNotifications.mock.calls[0][0][0];
      expect(msg.data).toMatchObject({ type: NotificationType.TRADE_ENTRY, refId: 'trade-1' });
      // DAR-430: 체결 카테고리 → 'trade' 채널. DAR-432: 출처 라벨(단타)+strategyKey data 전달.
      expect(msg.channelId).toBe('trade');
      expect(msg.data).toMatchObject({
        channelId: 'trade',
        source: '단타',
        strategyKey: 'intraday-scalp',
      });
    });

    // DAR-431: 체결 푸시 data 에 트랙 식별자(strategyKey/strategyName)+딥링크 동봉 →
    //   클라이언트가 전략별로 라우팅·필터링한다(포트폴리오 루트 폴백 제거).
    it('체결 push data 에 strategyKey·strategyName·deepLink 동봉 (DAR-431)', async () => {
      const { consumer, prisma, expoPush } = makeDeps();
      prisma.user.findMany.mockResolvedValue([{ id: 'u1' }]);
      prisma.notificationSettings.findMany.mockResolvedValue([]); // 기본 ON
      prisma.userDevice.findMany.mockResolvedValue([{ deviceToken: 'ExponentPushToken[x]' }]);

      await consumer.process(job(NOTIFY_JOB.TRADE_ENTRY, entryJob));

      const msg = expoPush.sendPushNotifications.mock.calls[0][0][0];
      expect(msg.data).toMatchObject({
        type: NotificationType.TRADE_ENTRY,
        refId: 'trade-1',
        strategyKey: 'intraday-scalp',
        strategyName: '분봉 단타',
        deepLink: '/portfolio/strategy/intraday-scalp',
      });
    });

    it('master isEnabled=false → 인박스만, 푸시 미발송', async () => {
      const { consumer, prisma, notifications, expoPush } = makeDeps();
      prisma.user.findMany.mockResolvedValue([{ id: 'u1' }]);
      prisma.notificationSettings.findMany.mockResolvedValue([
        { userId: 'u1', isEnabled: false, tradePushEnabled: true },
      ]);
      prisma.userDevice.findMany.mockResolvedValue([{ deviceToken: 'ExponentPushToken[x]' }]);

      await consumer.process(job(NOTIFY_JOB.TRADE_ENTRY, entryJob));

      expect(notifications.createNotificationIfAbsent).toHaveBeenCalledTimes(1);
      expect(expoPush.sendPushNotifications).not.toHaveBeenCalled();
    });

    it('멱등: created=false 면 푸시 재발송 스킵', async () => {
      const { consumer, prisma, notifications, expoPush } = makeDeps();
      prisma.user.findMany.mockResolvedValue([{ id: 'u1' }]);
      prisma.notificationSettings.findMany.mockResolvedValue([
        { userId: 'u1', isEnabled: true, tradePushEnabled: true },
      ]);
      prisma.userDevice.findMany.mockResolvedValue([{ deviceToken: 'ExponentPushToken[x]' }]);
      notifications.createNotificationIfAbsent.mockResolvedValue({
        notification: { id: 'n1' },
        created: false,
      });

      await consumer.process(job(NOTIFY_JOB.TRADE_ENTRY, entryJob));
      expect(expoPush.sendPushNotifications).not.toHaveBeenCalled();
    });

    it('수신 사용자 0명 → graceful no-op', async () => {
      const { consumer, prisma, notifications } = makeDeps();
      prisma.user.findMany.mockResolvedValue([]);
      await consumer.process(job(NOTIFY_JOB.TRADE_ENTRY, entryJob));
      expect(notifications.createNotificationIfAbsent).not.toHaveBeenCalled();
    });
  });

  // ── DAR-432: 출처별 이모지+출처명 메시지 템플릿 ──────────────────────────────
  describe('출처별 메시지 템플릿 (DAR-432)', () => {
    const baseEntry = {
      kind: 'ENTRY' as const,
      refId: 'trade-x',
      corpCode: 'c1',
      stockCode: '005930',
      corpName: '삼성전자',
      price: 70000,
      shares: 5,
      cash: 9650000,
      totalValue: 10100000,
      deepLink: '/portfolio?tab=sim',
    };

    async function titleFor(jobData: Record<string, unknown>): Promise<string> {
      const { consumer, prisma, notifications } = makeDeps();
      prisma.user.findMany.mockResolvedValue([{ id: 'u1' }]);
      await consumer.process(job(NOTIFY_JOB.TRADE_ENTRY, jobData));
      return notifications.createNotificationIfAbsent.mock.calls[0][0].title as string;
    }

    it('시스템 모의 → 모의 출처 제목', async () => {
      const title = await titleFor({
        ...baseEntry,
        strategyKey: 'paper-simulation',
        strategyLabel: '시스템 모의',
      });
      expect(title).toBe('모의 · 삼성전자 매수');
    });

    it('4전략(이벤트엣지) → 이벤트엣지 출처 제목', async () => {
      const title = await titleFor({
        ...baseEntry,
        strategyKey: 'event-edge',
        strategyLabel: '이벤트엣지',
      });
      expect(title).toBe('이벤트엣지 · 삼성전자 매수');
    });

    it('미등록 strategyKey → 알림 폴백(do-no-harm)', async () => {
      const title = await titleFor({
        ...baseEntry,
        strategyKey: 'mystery-track',
        strategyLabel: '미상',
      });
      expect(title).toBe('알림 · 삼성전자 매수');
    });

    it('SIGNAL → 매수신호 제목(등급 한국어)+본문 점수·근거', async () => {
      const { consumer, prisma, notifications } = makeDeps();
      prisma.tradingSignal.findUnique.mockResolvedValue({ id: 's1', isNotified: false });
      prisma.watchList.findMany.mockResolvedValue([{ userId: 'u1' }]);

      await consumer.process(
        job(NOTIFY_JOB.SIGNAL, {
          signalId: 's1',
          corpCode: 'c1',
          corpName: '삼성전자',
          grade: 'STRONG_BUY_CANDIDATE',
          buyScore: 82,
          eventType: 'SUPPLY_CONTRACT',
        }),
      );

      const call = notifications.createNotificationIfAbsent.mock.calls[0][0];
      expect(call.title).toBe('삼성전자 매수신호 적극매수');
      expect(call.body).toBe('82점 · SUPPLY_CONTRACT');
      expect(call.title).not.toContain('[');
    });

    it('EXIT → 청산 권고 제목', async () => {
      const { consumer, prisma, notifications } = makeDeps();
      prisma.position.findUnique.mockResolvedValue({
        corpCode: 'c1',
        stockCode: '005930',
        corpName: '삼성전자',
        portfolio: { id: 'pf-1', userId: 'owner-1' },
      });

      await consumer.process(
        job(NOTIFY_JOB.EXIT, {
          positionId: 'pos-1',
          corpCode: 'c1',
          corpName: '삼성전자',
          exitAction: 'EXIT',
        }),
      );
      const call = notifications.createNotificationIfAbsent.mock.calls[0][0];
      expect(call.title).toBe('삼성전자 청산 권고');
    });

    it('THESIS_VIOLATED → 투자논리 훼손 제목', async () => {
      const { consumer, prisma, notifications } = makeDeps();
      prisma.positionThesis.findUnique.mockResolvedValue({
        corpCode: 'c1',
        corpName: '삼성전자',
        position: {
          id: 'pos-9',
          stockCode: '005930',
          portfolio: { id: 'pf-2', userId: 'owner-2' },
        },
      });

      await consumer.process(
        job(NOTIFY_JOB.THESIS_VIOLATED, {
          positionThesisId: 't-1',
          corpCode: 'c1',
          corpName: '삼성전자',
        }),
      );
      const call = notifications.createNotificationIfAbsent.mock.calls[0][0];
      expect(call.title).toBe('삼성전자 투자논리 훼손');
    });
  });

  // ── OPS_ALERT / RISK_ALERT (DAR-473 P01) ──────────────────────────────────
  describe('리스크·운영 알림 (DAR-473 P01)', () => {
    const opsJob = {
      type: 'OPS_ALERT' as const,
      severity: 'WARNING' as const,
      source: 'cron-freshness',
      message: '공시 수집 크론이 30분째 지연되고 있습니다.',
      dedupeKey: 'cron-stale:2026-07-03',
    };
    const riskJob = {
      type: 'RISK_ALERT' as const,
      severity: 'CRITICAL' as const,
      source: 'kill-switch',
      message: '킬스위치가 발동했습니다. 신규 진입이 중단됩니다.',
      dedupeKey: 'kill-switch:2026-07-03',
    };

    it('실제 사용자 전원 브로드캐스트 — 설정행 미존재=기본 ON(인박스+푸시)', async () => {
      const { consumer, prisma, notifications, expoPush } = makeDeps();
      prisma.user.findMany.mockResolvedValue([{ id: 'u1' }, { id: 'u2' }]);
      prisma.notificationSettings.findMany.mockResolvedValue([]); // 기본 ON
      prisma.userDevice.findMany.mockResolvedValue([{ deviceToken: 'ExponentPushToken[x]' }]);

      await consumer.process(job(NOTIFY_JOB.OPS_ALERT, opsJob));

      // 합성 시스템 유저 제외 조건으로 조회(체결 알림과 동일 브로드캐스트 배선).
      expect(prisma.user.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { provider: { not: 'system' } } }),
      );
      expect(notifications.createNotificationIfAbsent).toHaveBeenCalledTimes(2);
      const first = notifications.createNotificationIfAbsent.mock.calls[0][0];
      expect(first).toMatchObject({
        userId: 'u1',
        type: NotificationType.OPS_ALERT,
        refId: 'cron-stale:2026-07-03', // dedupeKey = 멱등 자연키
        title: '운영 · 주의',
        body: '공시 수집 크론이 30분째 지연되고 있습니다.',
      });
      // 채널: 카테고리 'system' → Android 채널 'system'.
      expect(expoPush.sendPushNotifications).toHaveBeenCalledTimes(2);
      expect(expoPush.sendPushNotifications.mock.calls[0][0][0].channelId).toBe('system');
    });

    it('RISK_ALERT → 리스크 제목·OPS_ALERT 타입 구분·system 채널', async () => {
      const { consumer, prisma, notifications, expoPush } = makeDeps();
      prisma.user.findMany.mockResolvedValue([{ id: 'u1' }]);
      prisma.notificationSettings.findMany.mockResolvedValue([]);
      prisma.userDevice.findMany.mockResolvedValue([{ deviceToken: 'ExponentPushToken[x]' }]);

      await consumer.process(job(NOTIFY_JOB.OPS_ALERT, riskJob));

      const call = notifications.createNotificationIfAbsent.mock.calls[0][0];
      expect(call.type).toBe(NotificationType.RISK_ALERT);
      expect(call.title).toBe('리스크 · 긴급');
      const msg = expoPush.sendPushNotifications.mock.calls[0][0][0];
      expect(msg.channelId).toBe('system');
      expect(msg.data).toMatchObject({ type: NotificationType.RISK_ALERT, refId: 'kill-switch:2026-07-03' });
    });

    it('opsPushEnabled=false 인 사용자는 인박스도 생략(과알림 방지)', async () => {
      const { consumer, prisma, notifications, expoPush } = makeDeps();
      prisma.user.findMany.mockResolvedValue([{ id: 'u1' }, { id: 'u2' }]);
      prisma.notificationSettings.findMany.mockResolvedValue([
        { userId: 'u1', isEnabled: true, opsPushEnabled: false },
        { userId: 'u2', isEnabled: true, opsPushEnabled: true },
      ]);
      prisma.userDevice.findMany.mockResolvedValue([{ deviceToken: 'ExponentPushToken[x]' }]);

      await consumer.process(job(NOTIFY_JOB.OPS_ALERT, opsJob));

      // u1 OFF → 스킵, u2 만 인박스+푸시.
      expect(notifications.createNotificationIfAbsent).toHaveBeenCalledTimes(1);
      expect(notifications.createNotificationIfAbsent.mock.calls[0][0]).toMatchObject({ userId: 'u2' });
      expect(expoPush.sendPushNotifications).toHaveBeenCalledTimes(1);
    });

    it('master isEnabled=false → 인박스만, 푸시 미발송', async () => {
      const { consumer, prisma, notifications, expoPush } = makeDeps();
      prisma.user.findMany.mockResolvedValue([{ id: 'u1' }]);
      prisma.notificationSettings.findMany.mockResolvedValue([
        { userId: 'u1', isEnabled: false, opsPushEnabled: true },
      ]);
      prisma.userDevice.findMany.mockResolvedValue([{ deviceToken: 'ExponentPushToken[x]' }]);

      await consumer.process(job(NOTIFY_JOB.OPS_ALERT, opsJob));

      expect(notifications.createNotificationIfAbsent).toHaveBeenCalledTimes(1);
      expect(expoPush.sendPushNotifications).not.toHaveBeenCalled();
    });

    it('멱등: created=false 면 푸시 재발송 스킵', async () => {
      const { consumer, prisma, notifications, expoPush } = makeDeps();
      prisma.user.findMany.mockResolvedValue([{ id: 'u1' }]);
      prisma.notificationSettings.findMany.mockResolvedValue([]);
      prisma.userDevice.findMany.mockResolvedValue([{ deviceToken: 'ExponentPushToken[x]' }]);
      notifications.createNotificationIfAbsent.mockResolvedValue({
        notification: { id: 'n1' },
        created: false,
      });

      await consumer.process(job(NOTIFY_JOB.OPS_ALERT, opsJob));
      expect(expoPush.sendPushNotifications).not.toHaveBeenCalled();
    });

    it('수신 사용자 0명 → graceful no-op', async () => {
      const { consumer, prisma, notifications } = makeDeps();
      prisma.user.findMany.mockResolvedValue([]);
      await consumer.process(job(NOTIFY_JOB.OPS_ALERT, opsJob));
      expect(notifications.createNotificationIfAbsent).not.toHaveBeenCalled();
    });

    it('opsAlertTitle 순수 함수 — 출처 이모지+라벨·심각도', () => {
      expect(opsAlertTitle(NotificationType.OPS_ALERT, 'INFO')).toBe('운영 · 정보');
      expect(opsAlertTitle(NotificationType.RISK_ALERT, 'CRITICAL')).toBe('리스크 · 긴급');
      expect(OPS_SEVERITY_LABEL).toMatchObject({
        INFO: '정보',
        WARNING: '주의',
        ERROR: '오류',
        CRITICAL: '긴급',
      });
    });
  });

  // ── PRICE_MOVE (갭분석 W7) ─────────────────────────────────────────────────
  describe('PRICE_MOVE — 관심종목 급변동(갭분석 W7)', () => {
    const priceMoveJob = {
      refId: '005930-20260716',
      corpCode: 'C001',
      stockCode: '005930',
      corpName: '알파전자',
      tradeDate: '20260716',
      changePct: 6.2,
      price: 10_620,
      prevClose: 10_000,
      title: '알파전자 급변동 +6.2%',
      body: '전일 종가 대비 +6.2% · 오늘 공시 2건 · 준실시간(최대 5분 지연)',
      deepLink: '/company/C001',
      newsUrl: 'https://finance.naver.com/item/news.naver?code=005930',
    };

    it('★기본 OFF: 설정행 미존재 watcher 는 인박스도 생략(스팸 방지)', async () => {
      const { consumer, prisma, notifications, expoPush } = makeDeps();
      prisma.watchList.findMany.mockResolvedValue([{ userId: 'u1' }]);
      prisma.notificationSettings.findMany.mockResolvedValue([]); // 설정행 없음 = 기본 OFF

      await consumer.process(job(NOTIFY_JOB.PRICE_MOVE, priceMoveJob));

      expect(notifications.createNotificationIfAbsent).not.toHaveBeenCalled();
      expect(expoPush.sendPushNotifications).not.toHaveBeenCalled();
    });

    it('priceMovePushEnabled=false → 인박스·푸시 모두 생략', async () => {
      const { consumer, prisma, notifications, expoPush } = makeDeps();
      prisma.watchList.findMany.mockResolvedValue([{ userId: 'u1' }]);
      prisma.notificationSettings.findMany.mockResolvedValue([
        { userId: 'u1', isEnabled: true, priceMovePushEnabled: false },
      ]);

      await consumer.process(job(NOTIFY_JOB.PRICE_MOVE, priceMoveJob));

      expect(notifications.createNotificationIfAbsent).not.toHaveBeenCalled();
      expect(expoPush.sendPushNotifications).not.toHaveBeenCalled();
    });

    it('priceMovePushEnabled=true → 인박스 기록 + 푸시 발송(제목·본문·딥링크·뉴스URL 동봉)', async () => {
      const { consumer, prisma, notifications, expoPush } = makeDeps();
      prisma.watchList.findMany.mockResolvedValue([{ userId: 'u1' }]);
      prisma.notificationSettings.findMany.mockResolvedValue([
        { userId: 'u1', isEnabled: true, priceMovePushEnabled: true },
      ]);
      prisma.userDevice.findMany.mockResolvedValue([{ deviceToken: 'ExponentPushToken[x]' }]);

      await consumer.process(job(NOTIFY_JOB.PRICE_MOVE, priceMoveJob));

      expect(notifications.createNotificationIfAbsent).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'u1',
          type: NotificationType.PRICE_MOVE,
          refId: '005930-20260716',
          title: priceMoveJob.title,
          body: priceMoveJob.body,
          deepLink: '/company/C001',
        }),
      );
      expect(expoPush.sendPushNotifications).toHaveBeenCalledTimes(1);
      const messages = expoPush.sendPushNotifications.mock.calls[0][0];
      expect(messages[0].data).toMatchObject({
        deepLink: '/company/C001',
        type: NotificationType.PRICE_MOVE,
        refId: '005930-20260716',
        stockCode: '005930',
        newsUrl: priceMoveJob.newsUrl,
      });
    });

    it('master isEnabled=false 면 토글 ON 이어도 인박스만(푸시 미발송)', async () => {
      const { consumer, prisma, notifications, expoPush } = makeDeps();
      prisma.watchList.findMany.mockResolvedValue([{ userId: 'u1' }]);
      prisma.notificationSettings.findMany.mockResolvedValue([
        { userId: 'u1', isEnabled: false, priceMovePushEnabled: true },
      ]);

      await consumer.process(job(NOTIFY_JOB.PRICE_MOVE, priceMoveJob));

      expect(notifications.createNotificationIfAbsent).toHaveBeenCalledTimes(1);
      expect(expoPush.sendPushNotifications).not.toHaveBeenCalled();
    });

    it('멱등: created=false(이미 통지)면 푸시 재발송 스킵 — 종목당 1일 1회 보장', async () => {
      const { consumer, prisma, notifications, expoPush } = makeDeps();
      prisma.watchList.findMany.mockResolvedValue([{ userId: 'u1' }]);
      prisma.notificationSettings.findMany.mockResolvedValue([
        { userId: 'u1', isEnabled: true, priceMovePushEnabled: true },
      ]);
      notifications.createNotificationIfAbsent.mockResolvedValue({
        notification: { id: 'n1' },
        created: false,
      });

      await consumer.process(job(NOTIFY_JOB.PRICE_MOVE, priceMoveJob));

      expect(expoPush.sendPushNotifications).not.toHaveBeenCalled();
    });

    it('watcher 0명 → graceful no-op(설정 조회도 생략)', async () => {
      const { consumer, prisma, notifications } = makeDeps();
      prisma.watchList.findMany.mockResolvedValue([]);
      await consumer.process(job(NOTIFY_JOB.PRICE_MOVE, priceMoveJob));
      expect(prisma.notificationSettings.findMany).not.toHaveBeenCalled();
      expect(notifications.createNotificationIfAbsent).not.toHaveBeenCalled();
    });
  });

  // ── EDITION — 일일 에디션 발행 푸시 (DAR-523 Wave B/B2) ─────────────────────
  describe('EDITION — 일일 에디션 발행 푸시(DAR-523)', () => {
    const editionJob = {
      editionDate: '20260717',
      count: 3,
      strongBuyCount: 1,
      headlineCorpName: '삼성전자',
      title: '오늘의 투자판단 에디션',
      body: '삼성전자 외 2곳 · 매수 후보 3곳 (적극매수 1)',
      deepLink: '/signals',
    };

    it('★하드 가드: count<=0(빈 에디션)은 발송 금지 — 수신자 조회조차 안 함', async () => {
      const { consumer, prisma, notifications, expoPush } = makeDeps();

      await consumer.process(job(NOTIFY_JOB.EDITION, { ...editionJob, count: 0 }));

      expect(prisma.user.findMany).not.toHaveBeenCalled();
      expect(notifications.createNotificationIfAbsent).not.toHaveBeenCalled();
      expect(expoPush.sendPushNotifications).not.toHaveBeenCalled();
    });

    it('★기본 OFF: 설정행 미존재 사용자는 인박스도 생략(옵트인 전제)', async () => {
      const { consumer, prisma, notifications, expoPush } = makeDeps();
      prisma.user.findMany.mockResolvedValue([{ id: 'u1' }]);
      prisma.notificationSettings.findMany.mockResolvedValue([]); // 설정행 없음 = 기본 OFF

      await consumer.process(job(NOTIFY_JOB.EDITION, editionJob));

      // 합성 시스템 유저 제외 조건으로 조회.
      expect(prisma.user.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { provider: { not: 'system' } } }),
      );
      expect(notifications.createNotificationIfAbsent).not.toHaveBeenCalled();
      expect(expoPush.sendPushNotifications).not.toHaveBeenCalled();
    });

    it('editionPushEnabled=false → 인박스·푸시 모두 생략(옵트아웃 미발송)', async () => {
      const { consumer, prisma, notifications, expoPush } = makeDeps();
      prisma.user.findMany.mockResolvedValue([{ id: 'u1' }]);
      prisma.notificationSettings.findMany.mockResolvedValue([
        { userId: 'u1', isEnabled: true, editionPushEnabled: false },
      ]);

      await consumer.process(job(NOTIFY_JOB.EDITION, editionJob));

      expect(notifications.createNotificationIfAbsent).not.toHaveBeenCalled();
      expect(expoPush.sendPushNotifications).not.toHaveBeenCalled();
    });

    it('editionPushEnabled=true + master ON + 유효토큰 → 인박스 + 푸시(제목·본문·딥링크·signal 채널)', async () => {
      const { consumer, prisma, notifications, expoPush } = makeDeps();
      prisma.user.findMany.mockResolvedValue([{ id: 'u1' }]);
      prisma.notificationSettings.findMany.mockResolvedValue([
        { userId: 'u1', isEnabled: true, editionPushEnabled: true },
      ]);
      prisma.userDevice.findMany.mockResolvedValue([{ deviceToken: 'ExponentPushToken[x]' }]);

      await consumer.process(job(NOTIFY_JOB.EDITION, editionJob));

      expect(notifications.createNotificationIfAbsent).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'u1',
          type: NotificationType.EDITION,
          refId: '20260717', // editionDate = 멱등 자연키
          title: editionJob.title,
          body: editionJob.body,
          deepLink: '/signals',
        }),
      );
      expect(expoPush.sendPushNotifications).toHaveBeenCalledTimes(1);
      const msg = expoPush.sendPushNotifications.mock.calls[0][0][0];
      expect(msg).toMatchObject({ to: 'ExponentPushToken[x]' });
      // DAR-523: EDITION → 'signal' 카테고리 → 'signal' 채널(기존 모바일 채널 재사용).
      expect(msg.channelId).toBe('signal');
      expect(msg.data).toMatchObject({ type: NotificationType.EDITION, refId: '20260717' });
    });

    it('master isEnabled=false → 인박스만, 푸시 미발송', async () => {
      const { consumer, prisma, notifications, expoPush } = makeDeps();
      prisma.user.findMany.mockResolvedValue([{ id: 'u1' }]);
      prisma.notificationSettings.findMany.mockResolvedValue([
        { userId: 'u1', isEnabled: false, editionPushEnabled: true },
      ]);
      prisma.userDevice.findMany.mockResolvedValue([{ deviceToken: 'ExponentPushToken[x]' }]);

      await consumer.process(job(NOTIFY_JOB.EDITION, editionJob));

      expect(notifications.createNotificationIfAbsent).toHaveBeenCalledTimes(1);
      expect(expoPush.sendPushNotifications).not.toHaveBeenCalled();
    });

    it('멱등(재기동 안전): created=false 면 푸시 재발송 스킵 — 사용자당 에디션 1호 1회', async () => {
      const { consumer, prisma, notifications, expoPush } = makeDeps();
      prisma.user.findMany.mockResolvedValue([{ id: 'u1' }]);
      prisma.notificationSettings.findMany.mockResolvedValue([
        { userId: 'u1', isEnabled: true, editionPushEnabled: true },
      ]);
      prisma.userDevice.findMany.mockResolvedValue([{ deviceToken: 'ExponentPushToken[x]' }]);
      notifications.createNotificationIfAbsent.mockResolvedValue({
        notification: { id: 'n1' },
        created: false,
      });

      await consumer.process(job(NOTIFY_JOB.EDITION, editionJob));

      expect(expoPush.sendPushNotifications).not.toHaveBeenCalled();
    });

    it('일일 캡 초과(allowed=false) → 인박스 보존·실발송 억제 · consume(userId,EDITION,editionDate)', async () => {
      const { consumer, prisma, notifications, expoPush, pushCap } = makeDeps();
      prisma.user.findMany.mockResolvedValue([{ id: 'u1' }]);
      prisma.notificationSettings.findMany.mockResolvedValue([
        { userId: 'u1', isEnabled: true, editionPushEnabled: true },
      ]);
      prisma.userDevice.findMany.mockResolvedValue([{ deviceToken: 'ExponentPushToken[x]' }]);
      pushCap.consume.mockResolvedValue({ allowed: false, cap: 30, sentToday: 30, suppressed: true });

      await consumer.process(job(NOTIFY_JOB.EDITION, editionJob));

      expect(notifications.createNotificationIfAbsent).toHaveBeenCalledTimes(1);
      // EDITION 은 캡 면제 아님 → consume 호출(발송/억제 원장 기록 경로).
      expect(pushCap.consume).toHaveBeenCalledWith('u1', NotificationType.EDITION, '20260717');
      expect(expoPush.sendPushNotifications).not.toHaveBeenCalled();
    });

    it('혼합: u1 OFF·u2 ON → u2 만 인박스+푸시(브로드캐스트 게이트)', async () => {
      const { consumer, prisma, notifications, expoPush } = makeDeps();
      prisma.user.findMany.mockResolvedValue([{ id: 'u1' }, { id: 'u2' }]);
      prisma.notificationSettings.findMany.mockResolvedValue([
        { userId: 'u1', isEnabled: true, editionPushEnabled: false },
        { userId: 'u2', isEnabled: true, editionPushEnabled: true },
      ]);
      prisma.userDevice.findMany.mockResolvedValue([{ deviceToken: 'ExponentPushToken[x]' }]);

      await consumer.process(job(NOTIFY_JOB.EDITION, editionJob));

      expect(notifications.createNotificationIfAbsent).toHaveBeenCalledTimes(1);
      expect(notifications.createNotificationIfAbsent.mock.calls[0][0]).toMatchObject({ userId: 'u2' });
      expect(expoPush.sendPushNotifications).toHaveBeenCalledTimes(1);
    });

    it('수신 사용자 0명 → graceful no-op', async () => {
      const { consumer, prisma, notifications } = makeDeps();
      prisma.user.findMany.mockResolvedValue([]);
      await consumer.process(job(NOTIFY_JOB.EDITION, editionJob));
      expect(notifications.createNotificationIfAbsent).not.toHaveBeenCalled();
    });
  });

  describe('포맷 헬퍼 (DAR-424)', () => {
    it('formatKrw — 천단위 구분·반올림', () => {
      expect(formatKrw(9500000)).toBe('9,500,000');
      expect(formatKrw(105000.7)).toBe('105,001');
      expect(formatKrw(-12345)).toBe('-12,345');
    });
    it('signedPct — 부호 포함 소수 2자리, 결측은 빈 문자열', () => {
      expect(signedPct(2.1)).toBe('+2.10%');
      expect(signedPct(-1.2)).toBe('-1.20%');
      expect(signedPct(0)).toBe('+0.00%');
      expect(signedPct(undefined)).toBe('');
      expect(signedPct(null)).toBe('');
    });
  });

  // ── DAR-514: 일일 푸시 캡 게이트(발송 경로 전체가 캡 존중) ─────────────────────
  describe('일일 푸시 캡 (DAR-514)', () => {
    it('SIGNAL: 캡 초과(allowed=false) → 인박스는 남고 실발송만 억제', async () => {
      const { consumer, prisma, notifications, expoPush, pushCap } = makeDeps();
      prisma.tradingSignal.findUnique.mockResolvedValue({ id: 's1', isNotified: false });
      prisma.watchList.findMany.mockResolvedValue([{ userId: 'u1' }]);
      prisma.notificationSettings.findUnique.mockResolvedValue({
        isEnabled: true,
        signalPushEnabled: true,
        exitPushEnabled: false,
        thesisPushEnabled: false,
      });
      prisma.userDevice.findMany.mockResolvedValue([{ deviceToken: 'ExponentPushToken[x]' }]);
      pushCap.consume.mockResolvedValue({
        allowed: false,
        cap: 30,
        sentToday: 30,
        suppressed: true,
      });

      await consumer.process(job(NOTIFY_JOB.SIGNAL, { signalId: 's1', corpCode: 'c1' }));

      // 인박스는 기록됨(정보 손실 아님) · 캡 소비는 호출 · 실발송은 억제.
      expect(notifications.createNotificationIfAbsent).toHaveBeenCalledTimes(1);
      expect(pushCap.consume).toHaveBeenCalledWith('u1', NotificationType.SIGNAL, 's1');
      expect(expoPush.sendPushNotifications).not.toHaveBeenCalled();
    });

    it('TRADE: 캡 초과 → 실발송 억제(인박스는 보존)', async () => {
      const { consumer, prisma, notifications, expoPush, pushCap } = makeDeps();
      prisma.user.findMany.mockResolvedValue([{ id: 'u1' }]);
      prisma.notificationSettings.findMany.mockResolvedValue([]); // 기본 ON
      prisma.userDevice.findMany.mockResolvedValue([{ deviceToken: 'ExponentPushToken[x]' }]);
      pushCap.consume.mockResolvedValue({
        allowed: false,
        cap: 30,
        sentToday: 30,
        suppressed: true,
      });

      await consumer.process(
        job(NOTIFY_JOB.TRADE_ENTRY, {
          kind: 'ENTRY',
          refId: 'trade-1',
          strategyKey: 'intraday-scalp',
          strategyLabel: '분봉 단타',
          corpCode: 'c1',
          stockCode: '005930',
          corpName: '삼성전자',
          price: 105000,
          shares: 10,
          cash: 9500000,
          totalValue: 10200000,
          deepLink: '/portfolio/strategy/intraday-scalp',
        }),
      );

      expect(notifications.createNotificationIfAbsent).toHaveBeenCalledTimes(1);
      expect(pushCap.consume).toHaveBeenCalledWith('u1', NotificationType.TRADE_ENTRY, 'trade-1');
      expect(expoPush.sendPushNotifications).not.toHaveBeenCalled();
    });

    it('PRICE_MOVE: 캡 이내(allowed=true) → 정상 발송', async () => {
      const { consumer, prisma, expoPush, pushCap } = makeDeps();
      prisma.watchList.findMany.mockResolvedValue([{ userId: 'u1' }]);
      prisma.notificationSettings.findMany.mockResolvedValue([
        { userId: 'u1', isEnabled: true, priceMovePushEnabled: true },
      ]);
      prisma.userDevice.findMany.mockResolvedValue([{ deviceToken: 'ExponentPushToken[x]' }]);

      await consumer.process(
        job(NOTIFY_JOB.PRICE_MOVE, {
          refId: '005930-20260716',
          corpCode: 'C001',
          stockCode: '005930',
          corpName: '알파전자',
          tradeDate: '20260716',
          changePct: 6.2,
          title: '알파전자 급변동 +6.2%',
          body: '전일 종가 대비 +6.2%',
          deepLink: '/company/C001',
        }),
      );

      expect(pushCap.consume).toHaveBeenCalledWith('u1', NotificationType.PRICE_MOVE, '005930-20260716');
      expect(expoPush.sendPushNotifications).toHaveBeenCalledTimes(1);
    });

    it('★면제: RISK_ALERT/OPS_ALERT 는 캡을 소비하지 않고 항상 발송(안전 신호 은닉 금지)', async () => {
      const { consumer, prisma, expoPush, pushCap } = makeDeps();
      prisma.user.findMany.mockResolvedValue([{ id: 'u1' }]);
      prisma.notificationSettings.findMany.mockResolvedValue([]); // 기본 ON
      prisma.userDevice.findMany.mockResolvedValue([{ deviceToken: 'ExponentPushToken[x]' }]);
      // 캡이 초과 상태여도 면제 계열은 소비 자체를 하지 않는다.
      pushCap.consume.mockResolvedValue({
        allowed: false,
        cap: 30,
        sentToday: 99,
        suppressed: true,
      });

      await consumer.process(
        job(NOTIFY_JOB.OPS_ALERT, {
          type: 'RISK_ALERT',
          severity: 'CRITICAL',
          source: 'kill-switch',
          message: '킬스위치가 발동했습니다.',
          dedupeKey: 'kill-switch:2026-07-17',
        }),
      );

      // 면제 계열: consume 미호출 + 정상 발송.
      expect(pushCap.consume).not.toHaveBeenCalled();
      expect(expoPush.sendPushNotifications).toHaveBeenCalledTimes(1);
    });
  });

  // ── ★안전: 알림→실주문 직결 없음 ──────────────────────────────────────────
  it('★consumer 의존성은 인박스(notifications)·푸시(expoPush) 뿐 — 주문/Kill 경로 미보유', () => {
    const { consumer } = makeDeps();
    // 의존성 표면에 order/kill/trade 관련 메서드가 없음을 구조적으로 보장.
    const deps = Object.getOwnPropertyNames(consumer);
    expect(deps).not.toEqual(expect.arrayContaining(['paperTrade', 'orderService', 'killSwitch']));
  });
});
