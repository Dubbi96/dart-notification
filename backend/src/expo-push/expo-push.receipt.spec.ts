import { ExpoPushService } from './expo-push.service';
import { ExpoReceiptConsumer } from './expo-receipt.consumer';
import {
  EXPO_RECEIPT_JOB,
  EXPO_RECEIPT_CHECK_DELAY_MS,
} from '../common/queues/queue.constants';

/**
 * DAR-182 — Expo push receipt 검증 durable화 단위 테스트.
 *
 * DoD 핵심 보호:
 *  1) durable enqueue: 발송 후 receipt 확인이 BullMQ delayed job(delay 15분)으로
 *     예약된다 — 휘발성 setTimeout 이 아니라 Redis 영속이므로 재시작을 견딘다.
 *  2) 재시작 시뮬: 잡을 예약한 프로세스가 죽어도(=setTimeout 소멸), 잡 payload 만으로
 *     새 프로세스의 consumer 가 receipt 처리 + dead-token 정리를 완수한다.
 *  3) receipt 단계 dead-token 정리: getPushNotificationReceiptsAsync 가
 *     DeviceNotRegistered 를 돌려주면 해당 토큰을 UserDevice 에서 삭제한다.
 *  4) 회귀: status:ok ticket 이 없으면 enqueue 하지 않는다.
 */

// 가짜 Expo SDK — 서비스 내부 this.expo 를 대체한다.
const makeFakeExpo = (overrides: Partial<Record<string, jest.Mock>> = {}) => ({
  chunkPushNotifications: jest.fn((m: unknown[]) => [m]),
  sendPushNotificationsAsync: jest.fn(),
  chunkPushNotificationReceiptIds: jest.fn((ids: string[]) => [ids]),
  getPushNotificationReceiptsAsync: jest.fn().mockResolvedValue({}),
  ...overrides,
});

const makeService = (opts: {
  queue?: { add: jest.Mock } | null;
  expo?: ReturnType<typeof makeFakeExpo>;
}) => {
  const devicesService = { removeByDeviceToken: jest.fn().mockResolvedValue(undefined) };
  const configService = { get: jest.fn().mockReturnValue(undefined) };
  const service = new ExpoPushService(
    configService as any,
    devicesService as any,
    (opts.queue ?? null) as any,
  );
  const expo = opts.expo ?? makeFakeExpo();
  (service as any).expo = expo;
  return { service, devicesService, expo };
};

describe('ExpoPushService — receipt durable화 (DAR-182)', () => {
  describe('durable enqueue', () => {
    it('status:ok ticket 발송 시 receipt 검증을 delay 15분 BullMQ 잡으로 예약', async () => {
      const queue = { add: jest.fn().mockResolvedValue(undefined) };
      const expo = makeFakeExpo({
        sendPushNotificationsAsync: jest
          .fn()
          .mockResolvedValue([{ status: 'ok', id: 'receipt-1' }]),
      });
      const { service } = makeService({ queue, expo });

      await service.sendPushNotifications([{ to: 'ExponentPushToken[abc]', body: 'hi' } as any]);

      expect(queue.add).toHaveBeenCalledTimes(1);
      const [jobName, payload, options] = queue.add.mock.calls[0];
      expect(jobName).toBe(EXPO_RECEIPT_JOB.CHECK);
      expect(payload).toEqual({
        ticketIds: [{ id: 'receipt-1', token: 'ExponentPushToken[abc]' }],
      });
      // ★durable: delay 로 예약 — 프로세스 메모리 setTimeout 이 아니라 Redis 영속.
      expect(options.delay).toBe(EXPO_RECEIPT_CHECK_DELAY_MS);
      expect(options.attempts).toBe(3);
    });

    it('status:ok ticket 이 없으면 잡을 enqueue 하지 않음(회귀)', async () => {
      const queue = { add: jest.fn().mockResolvedValue(undefined) };
      const expo = makeFakeExpo({
        sendPushNotificationsAsync: jest
          .fn()
          .mockResolvedValue([
            { status: 'error', details: { error: 'DeviceNotRegistered' } },
          ]),
      });
      const { service } = makeService({ queue, expo });

      await service.sendPushNotifications([
        { to: 'ExponentPushToken[dead]', body: 'hi' } as any,
      ]);

      expect(queue.add).not.toHaveBeenCalled();
    });

    it('enqueue 실패 시에도 발송 경로는 throw 하지 않음(graceful)', async () => {
      const queue = { add: jest.fn().mockRejectedValue(new Error('redis down')) };
      const expo = makeFakeExpo({
        sendPushNotificationsAsync: jest
          .fn()
          .mockResolvedValue([{ status: 'ok', id: 'receipt-1' }]),
      });
      const { service } = makeService({ queue, expo });

      await expect(
        service.sendPushNotifications([{ to: 'ExponentPushToken[abc]', body: 'hi' } as any]),
      ).resolves.toBeDefined();
    });
  });

  describe('checkReceipts — dead-token 정리', () => {
    it('receipt 가 DeviceNotRegistered 면 해당 토큰을 UserDevice 에서 삭제', async () => {
      const expo = makeFakeExpo({
        getPushNotificationReceiptsAsync: jest.fn().mockResolvedValue({
          'receipt-1': { status: 'error', details: { error: 'DeviceNotRegistered' } },
        }),
      });
      const { service, devicesService } = makeService({ queue: null, expo });

      await service.checkReceipts([{ id: 'receipt-1', token: 'ExponentPushToken[dead]' }]);

      expect(devicesService.removeByDeviceToken).toHaveBeenCalledWith('ExponentPushToken[dead]');
    });

    it('정상 receipt(status:ok)는 토큰을 삭제하지 않음', async () => {
      const expo = makeFakeExpo({
        getPushNotificationReceiptsAsync: jest
          .fn()
          .mockResolvedValue({ 'receipt-1': { status: 'ok' } }),
      });
      const { service, devicesService } = makeService({ queue: null, expo });

      await service.checkReceipts([{ id: 'receipt-1', token: 'ExponentPushToken[live]' }]);

      expect(devicesService.removeByDeviceToken).not.toHaveBeenCalled();
    });

    it('빈 배치는 receipt 조회조차 하지 않음(no-op)', async () => {
      const expo = makeFakeExpo();
      const { service } = makeService({ queue: null, expo });

      await service.checkReceipts([]);

      expect(expo.getPushNotificationReceiptsAsync).not.toHaveBeenCalled();
    });
  });

  describe('재시작 시뮬레이션 — 잡 payload 만으로 새 프로세스가 정리 완수', () => {
    it('예약 프로세스가 죽어도 영속 잡 payload 로 새 consumer 가 dead-token 정리', async () => {
      // 1) 프로세스 A: 발송 → 잡 enqueue(잡 payload 가 Redis 에 영속됐다고 가정).
      const queue = { add: jest.fn().mockResolvedValue(undefined) };
      const expoA = makeFakeExpo({
        sendPushNotificationsAsync: jest
          .fn()
          .mockResolvedValue([{ status: 'ok', id: 'receipt-1' }]),
      });
      const { service: serviceA } = makeService({ queue, expo: expoA });
      await serviceA.sendPushNotifications([
        { to: 'ExponentPushToken[dead]', body: 'hi' } as any,
      ]);
      const [, persistedPayload] = queue.add.mock.calls[0];
      // 프로세스 A 종료 — setTimeout 이었다면 여기서 예약이 소멸했을 것.

      // 2) 프로세스 B(재시작): 새 서비스/consumer 인스턴스가 영속 잡을 집어 처리.
      //    이번엔 receipt 단계에서 DeviceNotRegistered 가 드러난다(ticket 단계엔 없었음).
      const expoB = makeFakeExpo({
        getPushNotificationReceiptsAsync: jest.fn().mockResolvedValue({
          'receipt-1': { status: 'error', details: { error: 'DeviceNotRegistered' } },
        }),
      });
      const { service: serviceB, devicesService: devicesB } = makeService({
        queue: null,
        expo: expoB,
      });
      const consumer = new ExpoReceiptConsumer(serviceB);

      await consumer.process({ name: EXPO_RECEIPT_JOB.CHECK, data: persistedPayload } as any);

      // ★재시작에도 dead-token 이 정리됨 — 휘발성 setTimeout 이었다면 누락됐을 케이스.
      expect(devicesB.removeByDeviceToken).toHaveBeenCalledWith('ExponentPushToken[dead]');
    });

    it('알 수 없는 잡 이름은 무시(no-op)', async () => {
      const { service } = makeService({ queue: null });
      const spy = jest.spyOn(service, 'checkReceipts');
      const consumer = new ExpoReceiptConsumer(service);

      await consumer.process({ name: 'unknown.job', data: {} } as any);

      expect(spy).not.toHaveBeenCalled();
    });
  });
});
