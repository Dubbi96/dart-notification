import { BadRequestException } from '@nestjs/common';
import { DevicesService } from './devices.service';

/**
 * DevicesService 단위 테스트 (DAR-136)
 *
 * 토큰 위생 보호:
 *  - 등록: Expo 토큰 형식 검증 — 깨진 토큰은 BadRequest, DB 미기록(쓰레기 누적 방지).
 *  - 유효 토큰은 deviceToken 유니크 upsert(멱등 — 동일 토큰 재등록 시 소유자/플랫폼 갱신).
 */

const makePrisma = () => ({
  userDevice: {
    upsert: jest.fn().mockImplementation(({ create }: any) => Promise.resolve({ id: 'd1', ...create })),
    deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
  },
});

const build = () => {
  const prisma = makePrisma();
  const service = new DevicesService(prisma as any);
  return { service, prisma };
};

describe('DevicesService (DAR-136 토큰 위생)', () => {
  describe('register — Expo 토큰 형식 검증', () => {
    it('유효한 ExponentPushToken 은 upsert(deviceToken 유니크, 멱등)', async () => {
      const { service, prisma } = build();
      const token = 'ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]';

      await service.register('u1', { deviceToken: token, platform: 'ios' });

      expect(prisma.userDevice.upsert).toHaveBeenCalledTimes(1);
      const arg = prisma.userDevice.upsert.mock.calls[0][0];
      expect(arg.where).toEqual({ deviceToken: token });
      expect(arg.update).toMatchObject({ userId: 'u1', platform: 'ios' });
    });

    it('형식이 깨진 토큰은 BadRequest 로 거부하고 DB 미기록', async () => {
      const { service, prisma } = build();

      await expect(
        service.register('u1', { deviceToken: 'not-a-real-token', platform: 'android' }),
      ).rejects.toBeInstanceOf(BadRequestException);

      expect(prisma.userDevice.upsert).not.toHaveBeenCalled();
    });

    it('빈 문자열 토큰도 거부', async () => {
      const { service, prisma } = build();
      await expect(
        service.register('u1', { deviceToken: '', platform: 'ios' }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.userDevice.upsert).not.toHaveBeenCalled();
    });
  });

  describe('remove — 소유자 스코프', () => {
    it('removeByDeviceToken 은 deviceToken 단독으로 삭제(만료 토큰 정리 경로)', async () => {
      const { service, prisma } = build();
      await service.removeByDeviceToken('ExponentPushToken[expired]');
      expect(prisma.userDevice.deleteMany).toHaveBeenCalledWith({
        where: { deviceToken: 'ExponentPushToken[expired]' },
      });
    });
  });
});
