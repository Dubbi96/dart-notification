import { PrismaService } from '../prisma/prisma.service';
import { TesterEventService } from './tester-event.service';
import { TESTER_EVENTS } from './dto/record-tester-event.dto';

/**
 * DAR-516 테스터 코호트 계측 — 서비스 단위 테스트(DB 무관, PrismaService 모킹).
 * record(흡수) · cohortMetrics(오픈율·재방문·클램프·0분모 방어)를 검증한다.
 */
describe('TesterEventService', () => {
  function makePrisma(overrides: Partial<Record<string, unknown>> = {}) {
    return {
      testerEvent: {
        create: jest.fn().mockResolvedValue({}),
        groupBy: jest.fn().mockResolvedValue([]),
      },
      $queryRaw: jest.fn().mockResolvedValue([
        {
          total_users: 0,
          edition_open_users: 0,
          push_open_users: 0,
          revisit_users: 0,
        },
      ]),
      ...overrides,
    } as unknown as PrismaService;
  }

  describe('record', () => {
    it('적재 성공 시 true 반환·userId·event 전달', async () => {
      const prisma = makePrisma();
      const svc = new TesterEventService(prisma);
      const ok = await svc.record('user-1', 'edition_open');
      expect(ok).toBe(true);
      expect((prisma as any).testerEvent.create).toHaveBeenCalledWith({
        data: { userId: 'user-1', event: 'edition_open' },
      });
    });

    it('적재 실패는 흡수하고 false 반환(계측이 호출자에게 5xx로 튀지 않음)', async () => {
      const prisma = makePrisma();
      (prisma as any).testerEvent.create.mockRejectedValueOnce(new Error('db down'));
      const svc = new TesterEventService(prisma);
      const ok = await svc.record('user-1', 'push_open');
      expect(ok).toBe(false);
    });
  });

  describe('cohortMetrics', () => {
    it('오픈율·재방문율 = 고유사용자 / 전체, 이벤트별 카운트 정렬', async () => {
      const prisma = makePrisma({
        $queryRaw: jest.fn().mockResolvedValue([
          {
            total_users: 10,
            edition_open_users: 8,
            push_open_users: 5,
            revisit_users: 4,
          },
        ]),
      });
      (prisma as any).testerEvent.groupBy = jest.fn().mockResolvedValue([
        { event: 'card_tap', _count: { _all: 30 } },
        { event: 'edition_open', _count: { _all: 42 } },
      ]);
      const svc = new TesterEventService(prisma);
      const m = await svc.cohortMetrics(14);

      expect(m.totalUsers).toBe(10);
      expect(m.editionOpenUsers).toBe(8);
      expect(m.pushOpenUsers).toBe(5);
      expect(m.revisitUsers).toBe(4);
      expect(m.openRate).toBe(0.8);
      expect(m.revisitRate).toBe(0.4);
      expect(m.windowDays).toBe(14);
      // 내림차순 정렬(가장 많은 이벤트 먼저).
      expect(m.byEvent).toEqual([
        { event: 'edition_open', count: 42 },
        { event: 'card_tap', count: 30 },
      ]);
    });

    it('활동 사용자 0명이면 분모 0 방어(비율 0, NaN/Infinity 없음)', async () => {
      const svc = new TesterEventService(makePrisma());
      const m = await svc.cohortMetrics(14);
      expect(m.totalUsers).toBe(0);
      expect(m.openRate).toBe(0);
      expect(m.revisitRate).toBe(0);
      expect(Number.isFinite(m.openRate)).toBe(true);
    });

    it('관측창은 1~90일로 클램프(0·과대값 방어)', async () => {
      const svc = new TesterEventService(makePrisma());
      expect((await svc.cohortMetrics(0)).windowDays).toBe(TesterEventService.DEFAULT_WINDOW_DAYS);
      expect((await svc.cohortMetrics(999)).windowDays).toBe(TesterEventService.MAX_WINDOW_DAYS);
      expect((await svc.cohortMetrics(7)).windowDays).toBe(7);
    });
  });

  describe('TESTER_EVENTS 화이트리스트(SSOT)', () => {
    it('계측 5지점 + iOS 게이트 설문 3응답 = 8종 고정', () => {
      expect(TESTER_EVENTS).toEqual([
        'edition_open',
        'card_tap',
        'push_open',
        'stats_section_view',
        'waitlist_cta',
        'survey_ios_shown',
        'survey_ios_answer_yes',
        'survey_ios_answer_no',
      ]);
    });
  });
});
