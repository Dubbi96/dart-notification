import { NotificationType } from '@prisma/client';
import { NotificationsService } from './notifications.service';

/**
 * NotificationsService 단위 테스트 (DAR-84)
 *
 * 통합 알림 이력 모델 일반화 회귀 보호:
 *  - 다형 모델: DISCLOSURE 외 SIGNAL/EXIT/THESIS_VIOLATED 가 한 인박스에 공존 (disclosure 조인 null 허용)
 *  - 백필 등가: DISCLOSURE 행의 refId == disclosureRcpNo (마이그레이션 백필과 동일 불변식)
 *  - 공시 멱등: (userId, type, refId) 키로 중복 생성 0
 */

const makePrismaMock = () => ({
  notificationHistory: {
    findUnique: jest.fn().mockResolvedValue(null),
    findMany: jest.fn().mockResolvedValue([]),
    count: jest.fn().mockResolvedValue(0),
    create: jest.fn().mockImplementation(({ data }: any) => Promise.resolve({ id: 'new', ...data })),
    update: jest.fn(),
    delete: jest.fn(),
    findFirst: jest.fn(),
  },
});

const buildService = () => {
  const prisma = makePrismaMock();
  const service = new NotificationsService(prisma as any);
  return { service, prisma };
};

describe('NotificationsService (DAR-84 통합 인박스)', () => {
  describe('createNotification — 공시 멱등', () => {
    it('동일 (userId, type, refId) 가 이미 있으면 기존 행 반환·create 미호출 (중복 통지 0)', async () => {
      const { service, prisma } = buildService();
      const existing = { id: 'exist-1', userId: 'u1', type: NotificationType.DISCLOSURE, refId: 'rcp1' };
      prisma.notificationHistory.findUnique.mockResolvedValueOnce(existing);

      const result = await service.createNotification({
        userId: 'u1',
        type: NotificationType.DISCLOSURE,
        refId: 'rcp1',
      });

      expect(result).toBe(existing);
      expect(prisma.notificationHistory.create).not.toHaveBeenCalled();
      expect(prisma.notificationHistory.findUnique).toHaveBeenCalledWith({
        where: { userId_type_refId: { userId: 'u1', type: NotificationType.DISCLOSURE, refId: 'rcp1' } },
      });
    });

    it('신규 공시 알림은 disclosureRcpNo=refId 로 백필 등가 보장 (마이그레이션 백필 불변식)', async () => {
      const { service, prisma } = buildService();

      await service.createNotification({
        userId: 'u1',
        type: NotificationType.DISCLOSURE,
        refId: 'rcp-xyz',
        title: '삼성전자 새 공시',
        body: '분기보고서',
        deepLink: '/disclosure/rcp-xyz',
      });

      const arg = prisma.notificationHistory.create.mock.calls[0][0].data;
      expect(arg.type).toBe(NotificationType.DISCLOSURE);
      expect(arg.refId).toBe('rcp-xyz');
      expect(arg.disclosureRcpNo).toBe('rcp-xyz'); // 백필 등가: refId == disclosureRcpNo
      expect(arg.deepLink).toBe('/disclosure/rcp-xyz');
    });
  });

  describe('createNotificationIfAbsent — created 플래그(DAR-136 푸시 멱등 권위)', () => {
    it('신규 생성 시 created=true 와 함께 새 행 반환', async () => {
      const { service, prisma } = buildService();
      prisma.notificationHistory.findUnique.mockResolvedValueOnce(null);

      const { notification, created } = await service.createNotificationIfAbsent({
        userId: 'u1',
        type: NotificationType.SIGNAL,
        refId: 'sig-1',
      });

      expect(created).toBe(true);
      expect(prisma.notificationHistory.create).toHaveBeenCalledTimes(1);
      expect(notification.refId).toBe('sig-1');
    });

    it('이미 존재하면 created=false·기존 행 반환·create 미호출(중복 푸시 차단 근거)', async () => {
      const { service, prisma } = buildService();
      const existing = { id: 'exist-1', userId: 'u1', type: NotificationType.SIGNAL, refId: 'sig-1' };
      prisma.notificationHistory.findUnique.mockResolvedValueOnce(existing);

      const { notification, created } = await service.createNotificationIfAbsent({
        userId: 'u1',
        type: NotificationType.SIGNAL,
        refId: 'sig-1',
      });

      expect(created).toBe(false);
      expect(notification).toBe(existing);
      expect(prisma.notificationHistory.create).not.toHaveBeenCalled();
    });
  });

  describe('createNotification — 다형 타입', () => {
    it.each([
      [NotificationType.SIGNAL, 'signal-1', '/signal/signal-1'],
      [NotificationType.EXIT, 'pos-1', '/portfolio/pos-1'],
      [NotificationType.THESIS_VIOLATED, 'pos-2', '/portfolio/pos-2'],
    ])('%s 타입은 disclosureRcpNo=null (공시 FK 미강결합) 로 인박스에 수용', async (type, refId, deepLink) => {
      const { service, prisma } = buildService();

      await service.createNotification({
        userId: 'u1',
        type: type as NotificationType,
        refId,
        title: '통지',
        body: '본문',
        deepLink,
      });

      const arg = prisma.notificationHistory.create.mock.calls[0][0].data;
      expect(arg.type).toBe(type);
      expect(arg.refId).toBe(refId);
      expect(arg.disclosureRcpNo).toBeNull(); // 공시 외 타입은 FK 비움
      expect(arg.deepLink).toBe(deepLink);
    });
  });

  describe('findAll — 다형 인박스 조회', () => {
    it('DISCLOSURE(조인 有) 와 SIGNAL(조인 null) 행이 한 목록에 공존', async () => {
      const { service, prisma } = buildService();
      const rows = [
        {
          id: 'n1',
          userId: 'u1',
          type: NotificationType.DISCLOSURE,
          refId: 'rcp1',
          title: null,
          body: null,
          deepLink: null,
          disclosureRcpNo: 'rcp1',
          isRead: false,
          sentAt: new Date('2026-06-01'),
          disclosure: { rcpNo: 'rcp1', corpCode: 'c1', corpName: '삼성', reportName: '분기보고서', disclosureType: 'PERIODIC' },
        },
        {
          id: 'n2',
          userId: 'u1',
          type: NotificationType.SIGNAL,
          refId: 'sig1',
          title: '매수 신호',
          body: 'A등급',
          deepLink: '/signal/sig1',
          disclosureRcpNo: null,
          isRead: false,
          sentAt: new Date('2026-06-02'),
          disclosure: null, // 다형: 공시 조인 없음
        },
      ];
      prisma.notificationHistory.findMany.mockResolvedValueOnce(rows);
      prisma.notificationHistory.count
        .mockResolvedValueOnce(2) // total
        .mockResolvedValueOnce(2); // unread

      const result = await service.findAll('u1', {});

      expect(result.items).toHaveLength(2);
      expect(result.items[0].disclosure).not.toBeNull();
      expect(result.items[1].type).toBe(NotificationType.SIGNAL);
      expect(result.items[1].disclosure).toBeNull();
      expect(result.items[1].deepLink).toBe('/signal/sig1');
      expect(result.meta.unreadCount).toBe(2);
    });
  });
});
