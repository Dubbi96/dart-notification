import { NotificationType, Prisma } from '@prisma/client';
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
    groupBy: jest.fn().mockResolvedValue([]),
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

  // ─── DAR-425: 경합(TOCTOU) 멱등 — 동일 (userId,type,refId) 다중 호출/동시 생성 → 정확히 1행 ─
  // 증상이었던 '체결 1건당 알림 x4' 는 실측상 4명 실사용자 브로드캐스트(refId당 사용자별 1건,
  // (userId,type,refId) 중복 0)였다. 진짜 중복은 check-then-act 경합 시에만 가능하므로, 그
  // 경합 경로(P2002)를 멱등 성공으로 흡수함을 회귀 고정한다.
  describe('createNotificationIfAbsent — DAR-425 경합 멱등(P2002 흡수)', () => {
    const p2002 = () =>
      new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
        code: 'P2002',
        clientVersion: 'test',
        meta: { target: ['userId', 'type', 'refId'] },
      });

    it('동시 생성 경합: findUnique=null 이지만 create 가 P2002 → 승자 행 재조회·created=false (중복 0)', async () => {
      const { service, prisma } = buildService();
      const winner = { id: 'winner-1', userId: 'u1', type: NotificationType.TRADE_ENTRY, refId: 'trade-1' };
      // 1차 findUnique: 아직 없음(둘 다 통과) → create 시도 → 경합 패배(P2002)
      prisma.notificationHistory.findUnique
        .mockResolvedValueOnce(null) // 진입 가드
        .mockResolvedValueOnce(winner); // P2002 후 승자 재조회
      prisma.notificationHistory.create.mockRejectedValueOnce(p2002());

      const { notification, created } = await service.createNotificationIfAbsent({
        userId: 'u1',
        type: NotificationType.TRADE_ENTRY,
        refId: 'trade-1',
      });

      expect(created).toBe(false); // 멱등: 푸시 재발송 안 함
      expect(notification).toBe(winner);
      expect(prisma.notificationHistory.create).toHaveBeenCalledTimes(1);
    });

    it('동일 refId 를 순차 2회 호출(잡 재시도 등) → 두번째는 created=false (refId당 1행)', async () => {
      const { service, prisma } = buildService();
      const row = { id: 'r1', userId: 'u1', type: NotificationType.TRADE_EXIT, refId: 'trade-2' };
      // 1회차: 없음 → 생성. 2회차: 존재 → 멱등 스킵.
      prisma.notificationHistory.findUnique
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(row);
      prisma.notificationHistory.create.mockResolvedValueOnce(row);

      const first = await service.createNotificationIfAbsent({
        userId: 'u1', type: NotificationType.TRADE_EXIT, refId: 'trade-2',
      });
      const second = await service.createNotificationIfAbsent({
        userId: 'u1', type: NotificationType.TRADE_EXIT, refId: 'trade-2',
      });

      expect(first.created).toBe(true);
      expect(second.created).toBe(false);
      expect(prisma.notificationHistory.create).toHaveBeenCalledTimes(1); // 1행만
    });

    it('P2002 가 아닌 오류는 흡수하지 않고 그대로 전파(데이터 손상 은폐 금지)', async () => {
      const { service, prisma } = buildService();
      prisma.notificationHistory.findUnique.mockResolvedValueOnce(null);
      prisma.notificationHistory.create.mockRejectedValueOnce(new Error('DB down'));

      await expect(
        service.createNotificationIfAbsent({
          userId: 'u1', type: NotificationType.SIGNAL, refId: 'sig-x',
        }),
      ).rejects.toThrow('DB down');
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

  describe('findAll — DAR-161 타입 필터 + 타입별 미읽음', () => {
    it('type 지정 시 where.type 에 반영되어 해당 타입만 조회', async () => {
      const { service, prisma } = buildService();
      prisma.notificationHistory.findMany.mockResolvedValueOnce([]);
      prisma.notificationHistory.count.mockResolvedValueOnce(0).mockResolvedValueOnce(0);

      await service.findAll('u1', { type: NotificationType.SIGNAL });

      const findArg = prisma.notificationHistory.findMany.mock.calls[0][0];
      expect(findArg.where).toMatchObject({ userId: 'u1', type: NotificationType.SIGNAL });
    });

    it('type 미지정 시 where 에 type 키 없음(전체 타입 조회)', async () => {
      const { service, prisma } = buildService();

      await service.findAll('u1', {});

      const findArg = prisma.notificationHistory.findMany.mock.calls[0][0];
      expect(findArg.where.type).toBeUndefined();
    });

    it('타입별 미읽음 맵은 모든 타입 키를 0으로 초기화하고 집계행으로 덮어쓴다', async () => {
      const { service, prisma } = buildService();
      // groupBy 는 미읽음이 있는 타입만 반환 — 누락 타입은 0 으로 채워져야 함.
      prisma.notificationHistory.groupBy.mockResolvedValueOnce([
        { type: NotificationType.DISCLOSURE, _count: { _all: 3 } },
        { type: NotificationType.SIGNAL, _count: { _all: 1 } },
      ]);

      const result = await service.findAll('u1', {});

      // 타입별 미읽음 집계는 항상 사용자 전체(미읽음) 기준 — 현재 선택 필터와 무관.
      const groupByArg = prisma.notificationHistory.groupBy.mock.calls[0][0];
      expect(groupByArg.where).toEqual({ userId: 'u1', isRead: false });

      expect(result.meta.unreadByType).toEqual({
        DISCLOSURE: 3,
        SIGNAL: 1,
        EXIT: 0,
        THESIS_VIOLATED: 0,
        // 갭분석 W2: 급등락 알림 타입 키.
        PRICE_MOVE: 0,
        // DAR-424: 라이브 페이퍼 체결 알림 타입 키.
        TRADE_ENTRY: 0,
        TRADE_EXIT: 0,
        // DAR-473(P01): 리스크·운영 알림 타입 키.
        RISK_ALERT: 0,
        OPS_ALERT: 0,
      });
    });
  });

  // ─── DAR-430: 카테고리(3 버킷) 필터 + 카테고리별 미읽음 ──────────────────────
  describe('findAll — DAR-430 카테고리 필터 + 카테고리별 미읽음', () => {
    it('category=signal 지정 시 where.type 에 신호 버킷(SIGNAL/EXIT/THESIS_VIOLATED) in 필터 반영', async () => {
      const { service, prisma } = buildService();
      prisma.notificationHistory.findMany.mockResolvedValueOnce([]);

      await service.findAll('u1', { category: 'signal' });

      const findArg = prisma.notificationHistory.findMany.mock.calls[0][0];
      expect(findArg.where).toMatchObject({
        userId: 'u1',
        type: {
          in: [
            NotificationType.SIGNAL,
            NotificationType.EXIT,
            NotificationType.THESIS_VIOLATED,
            // 갭분석 W2: 급등락 알림 — 신호 버킷.
            NotificationType.PRICE_MOVE,
          ],
        },
      });
    });

    it('category=trade 지정 시 체결 버킷(TRADE_ENTRY/TRADE_EXIT) in 필터', async () => {
      const { service, prisma } = buildService();

      await service.findAll('u1', { category: 'trade' });

      const findArg = prisma.notificationHistory.findMany.mock.calls[0][0];
      expect(findArg.where.type).toEqual({
        in: [NotificationType.TRADE_ENTRY, NotificationType.TRADE_EXIT],
      });
    });

    it('category 가 type 보다 우선(둘 다 지정 시 카테고리 버킷으로 조회)', async () => {
      const { service, prisma } = buildService();

      await service.findAll('u1', {
        category: 'disclosure',
        type: NotificationType.SIGNAL,
      });

      const findArg = prisma.notificationHistory.findMany.mock.calls[0][0];
      expect(findArg.where.type).toEqual({ in: [NotificationType.DISCLOSURE] });
    });

    it('카테고리별 미읽음 맵은 타입 집계를 3 버킷으로 합산한다', async () => {
      const { service, prisma } = buildService();
      prisma.notificationHistory.groupBy.mockResolvedValueOnce([
        { type: NotificationType.DISCLOSURE, _count: { _all: 3 } },
        { type: NotificationType.SIGNAL, _count: { _all: 1 } },
        { type: NotificationType.EXIT, _count: { _all: 2 } },
        { type: NotificationType.TRADE_ENTRY, _count: { _all: 4 } },
        { type: NotificationType.TRADE_EXIT, _count: { _all: 1 } },
      ]);

      const result = await service.findAll('u1', {});

      // 공시=3 / 신호=SIGNAL1+EXIT2=3 / 체결=ENTRY4+EXIT1=5 / 운영=0(DAR-473 P01 신규 버킷)
      expect(result.meta.unreadByCategory).toEqual({
        disclosure: 3,
        signal: 3,
        trade: 5,
        system: 0,
      });
    });
  });

  // ─── DAR-289: 페이지네이션 tie-break ─────────────────────────────────────────
  // sentAt 이 배치 발송으로 동값일 때, 유니크 tie-break(id) 없이는 동값 행 순서가
  // 미결정되어 페이지 경계에서 중복/누락이 난다. fake findMany 로 그 불안정성을 모델링.
  describe('findAll — 페이지네이션 tie-break (DAR-289)', () => {
    const sameTs = new Date('2026-06-15T00:00:00.000Z');
    const rows = [
      { id: 'n1', userId: 'u1', sentAt: sameTs },
      { id: 'n2', userId: 'u1', sentAt: sameTs },
      { id: 'n3', userId: 'u1', sentAt: sameTs },
      { id: 'n4', userId: 'u1', sentAt: sameTs },
    ];

    let callSeq = 0;
    const cmpBy =
      (orderBy: Array<Record<string, 'asc' | 'desc'>>) =>
      (a: Record<string, unknown>, b: Record<string, unknown>): number => {
        for (const o of orderBy) {
          const field = Object.keys(o)[0];
          const dir = o[field];
          const av = a[field] as string | Date;
          const bv = b[field] as string | Date;
          const c = av < bv ? -1 : av > bv ? 1 : 0;
          if (c !== 0) return dir === 'desc' ? -c : c;
        }
        return 0;
      };
    const unstableFindMany = (orderBy: any, skip = 0, take?: number) => {
      const cmp = cmpBy(Array.isArray(orderBy) ? orderBy : [orderBy]);
      const sorted = [...rows].sort(cmp);
      const seq = callSeq++;
      const groups: Array<Array<Record<string, unknown>>> = [];
      for (const r of sorted) {
        const last = groups[groups.length - 1];
        if (last && cmp(last[0], r) === 0) last.push(r);
        else groups.push([r]);
      }
      const flat = groups.flatMap((g) => {
        if (g.length <= 1) return g;
        const off = seq % g.length;
        return [...g.slice(off), ...g.slice(0, off)];
      });
      return flat.slice(skip, take == null ? undefined : skip + take);
    };

    const wire = (prisma: ReturnType<typeof makePrismaMock>) => {
      prisma.notificationHistory.findMany.mockImplementation(
        ({ orderBy, skip, take }: any) =>
          Promise.resolve(unstableFindMany(orderBy, skip, take)),
      );
      prisma.notificationHistory.count.mockResolvedValue(rows.length);
      prisma.notificationHistory.groupBy.mockResolvedValue([]);
    };

    it('동값 sentAt 다건에서 2페이지 연속 조회 시 union=전체·교집합=0', async () => {
      const { service, prisma } = buildService();
      callSeq = 0;
      wire(prisma);

      const p1 = await service.findAll('u1', { page: 1, limit: 2 } as any);
      const p2 = await service.findAll('u1', { page: 2, limit: 2 } as any);

      const ids1 = p1.items.map((n: any) => n.id);
      const ids2 = p2.items.map((n: any) => n.id);
      const union = new Set([...ids1, ...ids2]);
      const intersection = ids1.filter((id: string) => ids2.includes(id));

      expect(union.size).toBe(rows.length);
      expect(intersection).toHaveLength(0);
    });

    it('서비스는 유니크 tie-break(id)를 orderBy 마지막에 전달한다', async () => {
      const { service, prisma } = buildService();
      callSeq = 0;
      wire(prisma);

      await service.findAll('u1', { page: 1, limit: 2 } as any);
      const passed = prisma.notificationHistory.findMany.mock.calls[0][0].orderBy;
      expect(passed).toEqual([{ sentAt: 'desc' }, { id: 'desc' }]);
    });

    it('대조군: tie-break 없는 단일 키 정렬은 동일 fake 에서 중복/누락이 발생한다', () => {
      callSeq = 0;
      const single = [{ sentAt: 'desc' as const }];
      const page1 = unstableFindMany(single, 0, 2).map((n) => n.id as string);
      const page2 = unstableFindMany(single, 2, 2).map((n) => n.id as string);
      const union = new Set([...page1, ...page2]);
      const intersection = page1.filter((id) => page2.includes(id));
      expect(union.size).toBeLessThan(rows.length);
      expect(intersection.length).toBeGreaterThan(0);
    });
  });
});
