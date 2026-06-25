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
      // DAR-230: 배치 첫 ticketId 자연키 jobId 로 동일 배치 중복 적재 차단.
      expect(options.jobId).toBe('rcpt-receipt-1');
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

  // DAR-260 — 청크 send 실패 시 ticket↔message 정합 보존.
  //
  // chunkPushNotifications 가 메시지를 여러 청크로 나누고, 한 청크 send 가 throw 하면
  // 그 청크 ticket 이 통째로 누락된다. 과거엔 ticket 을 평탄 tickets[] 에 누적하고
  // messages[i] 인덱스로 짝지어, 첫 청크 실패 시 2번째 청크 ticket 이 1번째 청크
  // 메시지(토큰)와 어긋나 → DeviceNotRegistered 시 엉뚱한 토큰을 삭제했다.
  // 이제 ticket 을 그 출처 message 와 청크 단위로 쌍지어 추적해 정합을 보존한다.
  describe('청크 send 실패 시 ticket↔message 정합 (DAR-260)', () => {
    // ❶ ticket 단계: 첫 청크 send 실패 + 2번째 청크 DeviceNotRegistered →
    //    삭제 대상은 반드시 2번째 청크의 토큰(dead) 이어야 한다(1번째 청크 live 아님).
    it('첫 청크 실패 후 2번째 청크 DeviceNotRegistered 는 올바른 토큰(2번째 청크)을 삭제', async () => {
      const messages = [
        { to: 'ExponentPushToken[chunkA-live]', body: 'a' },
        { to: 'ExponentPushToken[chunkB-dead]', body: 'b' },
      ] as any[];
      const expo = makeFakeExpo({
        // 메시지를 메시지당 1개씩 별도 청크로 분할.
        chunkPushNotifications: jest.fn((m: unknown[]) => m.map((x) => [x])),
        sendPushNotificationsAsync: jest
          .fn()
          // 청크 A(첫 청크): 네트워크 실패 → throw → ticket 누락.
          .mockRejectedValueOnce(new Error('network down'))
          // 청크 B(2번째 청크): DeviceNotRegistered ticket 반환.
          .mockResolvedValueOnce([
            { status: 'error', details: { error: 'DeviceNotRegistered' } },
          ]),
      });
      const { service, devicesService } = makeService({ queue: null, expo });

      await service.sendPushNotifications(messages);

      // ★정합 보존: 삭제는 2번째 청크의 dead 토큰에만 일어나야 한다.
      expect(devicesService.removeByDeviceToken).toHaveBeenCalledTimes(1);
      expect(devicesService.removeByDeviceToken).toHaveBeenCalledWith(
        'ExponentPushToken[chunkB-dead]',
      );
      // 1번째 청크의 멀쩡한 토큰은 절대 삭제되지 않는다(오인삭제 회귀 가드).
      expect(devicesService.removeByDeviceToken).not.toHaveBeenCalledWith(
        'ExponentPushToken[chunkA-live]',
      );
    });

    // ❷ receipt 단계: 첫 청크 실패 후, 성공한 2번째 청크의 ok ticket 이
    //    enqueue 되는 payload 의 token 과 올바르게 짝지어져야 한다.
    it('첫 청크 실패 후 2번째 청크 ok ticket 은 올바른 토큰으로 receipt enqueue', async () => {
      const queue = { add: jest.fn().mockResolvedValue(undefined) };
      const messages = [
        { to: 'ExponentPushToken[chunkA]', body: 'a' },
        { to: 'ExponentPushToken[chunkB]', body: 'b' },
      ] as any[];
      const expo = makeFakeExpo({
        chunkPushNotifications: jest.fn((m: unknown[]) => m.map((x) => [x])),
        sendPushNotificationsAsync: jest
          .fn()
          .mockRejectedValueOnce(new Error('network down'))
          .mockResolvedValueOnce([{ status: 'ok', id: 'receipt-B' }]),
      });
      const { service } = makeService({ queue, expo });

      await service.sendPushNotifications(messages);

      expect(queue.add).toHaveBeenCalledTimes(1);
      const [, payload] = queue.add.mock.calls[0];
      // ★ok ticket(receipt-B)이 2번째 청크 토큰(chunkB)과 짝지어진다 —
      //   평탄 인덱스였다면 chunkA 토큰으로 어긋났을 케이스.
      expect(payload).toEqual({
        ticketIds: [{ id: 'receipt-B', token: 'ExponentPushToken[chunkB]' }],
      });
    });
  });

  // DAR-446 — 혼재 Expo 프로젝트 토큰으로 청크 일괄 발송이 거부될 때 메시지 단위 폴백.
  //
  // 한 요청에 서로 다른 프로젝트 토큰이 섞이면 Expo 가 "must be for the same project" 로
  // 요청 전체를 거부한다(prod 에서 dev 스냅샷 구토큰 + 현 APK 토큰 혼재로 관측). 종전엔
  // 그 청크의 멀쩡한 토큰까지 전부 푸시 누락 → 매수/매도 알림 전멸. 이제 이 충돌에 한해
  // 메시지 단위로 폴백해(개별 요청은 단일 프로젝트) 정상 토큰 전달을 보존한다.
  describe('혼재 프로젝트 토큰 — 청크 거부 시 메시지 단위 폴백 (DAR-446)', () => {
    it('"same project" 거부 시 메시지 단위 폴백 — 정상 토큰은 전달(receipt enqueue), 충돌 토큰만 스킵', async () => {
      const queue = { add: jest.fn().mockResolvedValue(undefined) };
      const messages = [
        { to: 'ExponentPushToken[projA-valid]', body: 'a' },
        { to: 'ExponentPushToken[projB-conflict]', body: 'b' },
      ] as any[];
      const expo = makeFakeExpo({
        chunkPushNotifications: jest.fn((m: unknown[]) => [m]), // 두 메시지가 한 청크
        sendPushNotificationsAsync: jest
          .fn()
          // ① 청크 일괄 → 혼재 프로젝트로 요청 전체 거부
          .mockRejectedValueOnce(
            new Error(
              'All push notification messages in the same request must be for the same project; check the details field to investigate conflicting tokens.',
            ),
          )
          // ② 폴백: projA 개별 → ok
          .mockResolvedValueOnce([{ status: 'ok', id: 'receipt-A' }])
          // ③ 폴백: projB 개별 → 또 거부(잘못된 프로젝트) → 스킵
          .mockRejectedValueOnce(new Error('not valid for this project')),
      });
      const { service } = makeService({ queue, expo });

      await service.sendPushNotifications(messages);

      // 일괄 1회 + 폴백 2회 = 3회.
      expect(expo.sendPushNotificationsAsync).toHaveBeenCalledTimes(3);
      // 정상 토큰(projA)만 ok ticket → receipt enqueue(전달 성공).
      expect(queue.add).toHaveBeenCalledTimes(1);
      const [, payload] = queue.add.mock.calls[0];
      expect(payload).toEqual({
        ticketIds: [{ id: 'receipt-A', token: 'ExponentPushToken[projA-valid]' }],
      });
    });

    it('프로젝트 충돌이 아닌 일반 오류는 폴백 없이 로그만 (DAR-260 거동 보존)', async () => {
      const messages = [
        { to: 'ExponentPushToken[a]', body: 'a' },
        { to: 'ExponentPushToken[b]', body: 'b' },
      ] as any[];
      const expo = makeFakeExpo({
        chunkPushNotifications: jest.fn((m: unknown[]) => [m]),
        sendPushNotificationsAsync: jest
          .fn()
          .mockRejectedValueOnce(new Error('network down')),
      });
      const { service } = makeService({ queue: null, expo });

      await service.sendPushNotifications(messages);

      // 일괄 1회만 — 네트워크 오류엔 메시지 단위 재시도 미발동.
      expect(expo.sendPushNotificationsAsync).toHaveBeenCalledTimes(1);
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
