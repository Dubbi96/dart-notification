// backend/src/engine1-disclosure/upcoming-events/upcoming-events.service.spec.ts
// DAR-538: 예정 이벤트 조회 서비스 단위 테스트 (prisma mock — 결정론 now 주입)

import { EventType, ExtractionStatus } from '@prisma/client';
import { UpcomingEventsService } from './upcoming-events.service';
import { PrismaService } from '../../prisma/prisma.service';

describe('UpcomingEventsService', () => {
  // 2026-07-17 00:00 UTC = 2026-07-17 09:00 KST → baseDate 2026-07-17
  const NOW = new Date('2026-07-17T00:00:00Z');

  const watchListFindMany = jest.fn();
  const disclosureEventFindMany = jest.fn();

  const prismaMock = {
    watchList: { findMany: watchListFindMany },
    disclosureEvent: { findMany: disclosureEventFindMany },
  } as unknown as PrismaService;

  const service = new UpcomingEventsService(prismaMock);

  const eventRow = (over: Record<string, unknown>) => ({
    rcpNo: '20260701000001',
    corpCode: '00126380',
    eventType: EventType.DIVIDEND_INCREASE,
    extractedData: { recordDate: '2026-08-10' },
    isAmendment: false,
    originalRcpNo: null,
    company: { corpName: '삼성전자', stockCode: '005930' },
    ...over,
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('관심기업이 없으면 DB 이벤트 조회 없이 빈 목록을 반환한다', async () => {
    watchListFindMany.mockResolvedValue([]);

    const result = await service.findForUser('user-1', { now: NOW });

    expect(result).toEqual({ baseDate: '2026-07-17', days: 90, items: [] });
    expect(disclosureEventFindMany).not.toHaveBeenCalled();
  });

  it('관심기업 corpCode·대상 eventType·SUCCESS/NEEDS_REVIEW로 조회를 한정한다', async () => {
    watchListFindMany.mockResolvedValue([{ corpCode: '00126380' }]);
    disclosureEventFindMany.mockResolvedValue([]);

    await service.findForUser('user-1', { now: NOW });

    const where = disclosureEventFindMany.mock.calls[0][0].where;
    expect(where.corpCode).toEqual({ in: ['00126380'] });
    expect(where.extractionStatus).toEqual({
      in: [ExtractionStatus.SUCCESS, ExtractionStatus.NEEDS_REVIEW],
    });
    expect(where.eventType.in).toEqual(
      expect.arrayContaining([EventType.DIVIDEND_INCREASE, EventType.SHARE_BUYBACK]),
    );
  });

  it('KST 오늘 기준 [baseDate, baseDate+days] 윈도의 이벤트만 dDay와 함께 반환한다', async () => {
    watchListFindMany.mockResolvedValue([{ corpCode: '00126380' }]);
    disclosureEventFindMany.mockResolvedValue([
      eventRow({ rcpNo: 'past', extractedData: { recordDate: '2026-07-16' } }),
      eventRow({ rcpNo: 'today', extractedData: { recordDate: '2026-07-17' } }),
      eventRow({ rcpNo: 'in30', extractedData: { recordDate: '2026-08-16' } }),
      eventRow({ rcpNo: 'beyond', extractedData: { recordDate: '2026-10-16' } }),
    ]);

    const result = await service.findForUser('user-1', { days: 90, now: NOW });

    expect(result.baseDate).toBe('2026-07-17');
    expect(result.items.map((i) => [i.rcpNo, i.dDay])).toEqual([
      ['today', 0],
      ['in30', 30],
    ]);
    expect(result.items[0]).toMatchObject({
      kind: 'DIVIDEND_RECORD',
      label: '배당 기준일',
      date: '2026-07-17',
      corpCode: '00126380',
      corpName: '삼성전자',
      stockCode: '005930',
      eventType: EventType.DIVIDEND_INCREASE,
    });
  });

  it('KST 자정 경계: UTC 16시(=KST 다음날 01시)면 baseDate가 다음날이다', async () => {
    watchListFindMany.mockResolvedValue([]);

    const result = await service.findForUser('user-1', {
      now: new Date('2026-07-17T16:00:00Z'),
    });

    expect(result.baseDate).toBe('2026-07-18');
  });

  it('days는 [1, 365]로 클램프된다', async () => {
    watchListFindMany.mockResolvedValue([]);

    expect((await service.findForUser('u', { days: 0, now: NOW })).days).toBe(1);
    expect((await service.findForUser('u', { days: 9999, now: NOW })).days).toBe(365);
    expect((await service.findForUser('u', { now: NOW })).days).toBe(90);
  });

  it('정정공시 supersede가 조회 경로에서도 적용된다', async () => {
    watchListFindMany.mockResolvedValue([{ corpCode: '00126380' }]);
    disclosureEventFindMany.mockResolvedValue([
      eventRow({ rcpNo: 'orig', extractedData: { recordDate: '2026-08-10' } }),
      eventRow({
        rcpNo: 'amend',
        isAmendment: true,
        originalRcpNo: 'orig',
        extractedData: { recordDate: '2026-08-20' },
      }),
    ]);

    const result = await service.findForUser('user-1', { now: NOW });

    expect(result.items).toHaveLength(1);
    expect(result.items[0].rcpNo).toBe('amend');
    expect(result.items[0].date).toBe('2026-08-20');
  });
});
