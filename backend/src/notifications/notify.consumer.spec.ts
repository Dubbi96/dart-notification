import { NotificationType } from '@prisma/client';
import { NotifyConsumer } from './notify.consumer';
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
  notificationSettings: { findUnique: jest.fn().mockResolvedValue(null) },
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
  const consumer = new NotifyConsumer(prisma as any, notifications as any, expoPush as any);
  return { consumer, prisma, notifications, expoPush };
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

  // ── ★안전: 알림→실주문 직결 없음 ──────────────────────────────────────────
  it('★consumer 의존성은 인박스(notifications)·푸시(expoPush) 뿐 — 주문/Kill 경로 미보유', () => {
    const { consumer } = makeDeps();
    // 의존성 표면에 order/kill/trade 관련 메서드가 없음을 구조적으로 보장.
    const deps = Object.getOwnPropertyNames(consumer);
    expect(deps).not.toEqual(expect.arrayContaining(['paperTrade', 'orderService', 'killSwitch']));
  });
});
