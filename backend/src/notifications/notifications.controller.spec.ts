import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';

/**
 * DAR-563: POST /notifications/seen 컨트롤러 배선 검증.
 * (뱃지 재정의 로직 자체는 notifications.service.spec.ts 가 담당.)
 */
describe('NotificationsController — POST /notifications/seen', () => {
  it('@CurrentUser로 얻은 userId를 markSeen에 전달하고 {success,data} 로 래핑한다', async () => {
    const markSeen = jest.fn().mockResolvedValue({ notificationsLastSeenAt: '2026-07-18T06:00:00.000Z' });
    const controller = new NotificationsController({ markSeen } as unknown as NotificationsService);

    const result = await controller.markSeen('user_123');

    expect(markSeen).toHaveBeenCalledWith('user_123');
    expect(result).toEqual({
      success: true,
      data: { notificationsLastSeenAt: '2026-07-18T06:00:00.000Z' },
    });
  });
});
