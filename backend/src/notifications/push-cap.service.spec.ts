import { NotificationType, Prisma } from '@prisma/client';
import {
  PushCapService,
  PUSH_DELIVERY_STATUS,
  DEFAULT_DAILY_PUSH_CAP,
  isCapExemptType,
  CAP_EXEMPT_TYPES,
} from './push-cap.service';

/**
 * PushCapService 단위 테스트 (DAR-514) — DoD 핵심 보호:
 *  - 캡 이내 → SENT 원장 + allowed.
 *  - 캡 초과 → SUPPRESSED_CAP 원장(억제 로그) + !allowed.
 *  - (userId,type,refId) 멱등 — 이미 결정된 통지는 재계상/재억제 0.
 *  - 설정 캡 우선(미설정 시 기본 캡). KST 일자 버킷.
 *  - 동시 소비 경합(P2002) 멱등 흡수.
 *  - 면제 계열(RISK/OPS)은 술어로 배제.
 */

const makePrisma = () => ({
  pushDeliveryLog: {
    findUnique: jest.fn().mockResolvedValue(null),
    create: jest.fn().mockResolvedValue({}),
    count: jest.fn().mockResolvedValue(0),
  },
  notificationSettings: {
    findUnique: jest.fn().mockResolvedValue(null),
  },
});

const make = () => {
  const prisma = makePrisma();
  const service = new PushCapService(prisma as any);
  return { service, prisma };
};

// 2026-07-17 10:00 KST(=2026-07-17 01:00 UTC) → kstDate '20260717'.
const NOW = new Date('2026-07-17T01:00:00Z');

describe('PushCapService (DAR-514)', () => {
  describe('consume — 캡 이내/초과', () => {
    it('캡 이내(sentToday<cap) → SENT 원장 + allowed=true', async () => {
      const { service, prisma } = make();
      prisma.pushDeliveryLog.count.mockResolvedValue(5); // 오늘 5건 발송, 기본 캡 30
      prisma.notificationSettings.findUnique.mockResolvedValue(null); // 기본 캡

      const d = await service.consume('u1', NotificationType.SIGNAL, 's1', NOW);

      expect(d).toMatchObject({ allowed: true, cap: DEFAULT_DAILY_PUSH_CAP, sentToday: 5, suppressed: false });
      expect(prisma.pushDeliveryLog.create).toHaveBeenCalledWith({
        data: {
          userId: 'u1',
          type: NotificationType.SIGNAL,
          refId: 's1',
          kstDate: '20260717', // KST 버킷(UTC 01:00 → KST 10:00 같은 날)
          status: PUSH_DELIVERY_STATUS.SENT,
        },
      });
    });

    it('캡 초과(sentToday>=cap) → SUPPRESSED_CAP 원장(억제 로그) + allowed=false', async () => {
      const { service, prisma } = make();
      prisma.pushDeliveryLog.count.mockResolvedValue(30); // 이미 캡(30) 도달
      prisma.notificationSettings.findUnique.mockResolvedValue({ dailyPushCap: 30 });

      const d = await service.consume('u1', NotificationType.DISCLOSURE, 'rcp-1', NOW);

      expect(d).toMatchObject({ allowed: false, cap: 30, sentToday: 30, suppressed: true });
      expect(prisma.pushDeliveryLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: PUSH_DELIVERY_STATUS.SUPPRESSED_CAP }),
        }),
      );
    });

    it('설정 캡 우선 — dailyPushCap=3, 이미 3건 → 억제', async () => {
      const { service, prisma } = make();
      prisma.notificationSettings.findUnique.mockResolvedValue({ dailyPushCap: 3 });
      prisma.pushDeliveryLog.count.mockResolvedValue(3);

      const d = await service.consume('u1', NotificationType.TRADE_ENTRY, 't1', NOW);
      expect(d.allowed).toBe(false);
      expect(d.cap).toBe(3);
    });

    it('경계: sentToday === cap-1 → 통과(마지막 1건)', async () => {
      const { service, prisma } = make();
      prisma.notificationSettings.findUnique.mockResolvedValue({ dailyPushCap: 10 });
      prisma.pushDeliveryLog.count.mockResolvedValue(9);

      const d = await service.consume('u1', NotificationType.SIGNAL, 's9', NOW);
      expect(d.allowed).toBe(true);
    });
  });

  describe('멱등 — 이미 결정된 통지', () => {
    it('기존 SENT 원장 → 재계상 없이 allowed=true(create 미호출)', async () => {
      const { service, prisma } = make();
      prisma.pushDeliveryLog.findUnique.mockResolvedValue({
        status: PUSH_DELIVERY_STATUS.SENT,
      });

      const d = await service.consume('u1', NotificationType.SIGNAL, 's1', NOW);
      expect(d.allowed).toBe(true);
      expect(d.suppressed).toBe(false);
      expect(prisma.pushDeliveryLog.create).not.toHaveBeenCalled();
    });

    it('기존 SUPPRESSED_CAP 원장 → allowed=false(재억제·재계상 0)', async () => {
      const { service, prisma } = make();
      prisma.pushDeliveryLog.findUnique.mockResolvedValue({
        status: PUSH_DELIVERY_STATUS.SUPPRESSED_CAP,
      });

      const d = await service.consume('u1', NotificationType.SIGNAL, 's1', NOW);
      expect(d.allowed).toBe(false);
      expect(d.suppressed).toBe(false); // '이번 호출로 새로 억제'가 아님
      expect(prisma.pushDeliveryLog.create).not.toHaveBeenCalled();
    });
  });

  describe('동시 소비 경합(P2002) 멱등 흡수', () => {
    it('create 가 P2002 → 승자 원장 재조회로 결정 재사용', async () => {
      const { service, prisma } = make();
      prisma.pushDeliveryLog.count.mockResolvedValue(0);
      prisma.pushDeliveryLog.create.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('dup', {
          code: 'P2002',
          clientVersion: 'x',
        }),
      );
      // 최초 findUnique=null(신규 판정), 경합 후 재조회=승자(SENT)
      prisma.pushDeliveryLog.findUnique
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ status: PUSH_DELIVERY_STATUS.SENT });

      const d = await service.consume('u1', NotificationType.SIGNAL, 's1', NOW);
      expect(d.allowed).toBe(true);
    });
  });

  describe('getUsage — 당일 관측치', () => {
    it('SENT/SUPPRESSED 카운트 + 캡 반환', async () => {
      const { service, prisma } = make();
      prisma.notificationSettings.findUnique.mockResolvedValue({ dailyPushCap: 30 });
      prisma.pushDeliveryLog.count
        .mockResolvedValueOnce(12) // sent
        .mockResolvedValueOnce(3); // suppressed

      const usage = await service.getUsage('u1', NOW);
      expect(usage).toEqual({ sent: 12, suppressed: 3, cap: 30 });
    });
  });

  describe('면제 계열 술어', () => {
    it('RISK_ALERT·OPS_ALERT 만 면제, 나머지는 비면제', () => {
      expect(isCapExemptType(NotificationType.RISK_ALERT)).toBe(true);
      expect(isCapExemptType(NotificationType.OPS_ALERT)).toBe(true);
      expect(isCapExemptType(NotificationType.DISCLOSURE)).toBe(false);
      expect(isCapExemptType(NotificationType.SIGNAL)).toBe(false);
      expect(isCapExemptType(NotificationType.TRADE_ENTRY)).toBe(false);
      expect(isCapExemptType(NotificationType.PRICE_MOVE)).toBe(false);
      expect(CAP_EXEMPT_TYPES.size).toBe(2);
    });
  });
});
