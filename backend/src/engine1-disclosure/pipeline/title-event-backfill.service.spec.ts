import { EventType, ExtractionStatus, ParseStatus } from '@prisma/client';
import {
  DEFAULT_SCAN_LIMIT,
  MAX_SCAN_LIMIT,
  TITLE_BACKFILL_MIN_CONFIDENCE,
  TITLE_BACKFILL_PAGE_SIZE,
  TitleEventBackfillService,
} from './title-event-backfill.service';
import {
  TITLE_BACKFILL_SOURCE,
  TITLE_ONLY_BACKFILL_MARKER,
} from './title-event-backfill.constants';
import { REPORT_NAME_RULES } from '../disclosure-events/extractors/event-classifier';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * W4 신호 검증 — 제목 기반 과거 공시 이벤트 백필 단위 검증.
 * Prisma 는 모킹(결정론). DART/DB/파싱/AI 무접촉이 이 잡의 불변식이다.
 */
describe('TitleEventBackfillService (W4 신호 검증)', () => {
  function makeDeps() {
    const prisma = {
      disclosure: {
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
      },
      disclosureEvent: {
        createMany: jest.fn().mockResolvedValue({ count: 0 }),
        count: jest.fn().mockResolvedValue(0),
      },
    } as unknown as PrismaService & {
      disclosure: { findMany: jest.Mock; count: jest.Mock };
      disclosureEvent: { createMany: jest.Mock; count: jest.Mock };
    };
    const service = new TitleEventBackfillService(prisma);
    return { prisma, service };
  }

  const row = (rcpNo: string, reportName: string, rcpDt = '20180101') => ({
    rcpNo,
    corpCode: `C-${rcpNo}`,
    reportName,
    rcpDt,
  });

  describe('백필 대상 선정 쿼리 (멱등의 근원)', () => {
    it('isBackfill·이벤트 없음·비DONE 문서 술어로만 후보를 고른다 — 이벤트 기존재 행은 술어에서 스킵', async () => {
      const { prisma, service } = makeDeps();

      await service.backfillOnce();

      const call = prisma.disclosure.findMany.mock.calls[0][0];
      expect(call.where).toEqual({
        isBackfill: true,
        disclosureEvent: { is: null }, // ★이벤트 기존재 시 스킵 — 반복 실행 무해(멱등)
        AND: [
          {
            OR: [
              { document: { is: null } },
              // DONE 문서는 DAR-391 전체 수치 추출 경로 소유 — 제목 백필이 선점하지 않는다.
              { document: { parseStatus: { not: ParseStatus.DONE } } },
            ],
          },
        ],
      });
      expect(call.orderBy).toEqual([{ rcpDt: 'asc' }, { rcpNo: 'asc' }]);
      expect(call.select).toEqual({
        rcpNo: true,
        corpCode: true,
        reportName: true,
        rcpDt: true,
      });
    });

    it('createMany 는 skipDuplicates=true — 동시 실행 레이스에도 중복 생성 0', async () => {
      const { prisma, service } = makeDeps();
      prisma.disclosure.findMany.mockResolvedValueOnce([
        row('R1', '주요사항보고서(자기주식취득결정)'),
      ]);
      prisma.disclosureEvent.createMany.mockResolvedValueOnce({ count: 1 });

      const r = await service.backfillOnce();

      expect(prisma.disclosureEvent.createMany).toHaveBeenCalledWith(
        expect.objectContaining({ skipDuplicates: true }),
      );
      expect(r.created).toBe(1);
    });

    it('두 번째 실행에서 후보가 0건이면 createMany 를 호출하지 않는다(멱등 재실행 무해)', async () => {
      const { prisma, service } = makeDeps();
      // 1회차에 전부 이벤트가 생겼다면 2회차 술어(disclosureEvent is null)가 빈 결과를 준다.
      prisma.disclosure.findMany.mockResolvedValueOnce([]);

      const r = await service.backfillOnce();

      expect(r.scanned).toBe(0);
      expect(r.created).toBe(0);
      expect(r.exhausted).toBe(true);
      expect(prisma.disclosureEvent.createMany).not.toHaveBeenCalled();
    });

    it('keyset 커서: 다음 페이지 술어에 (rcpDt, rcpNo) > 직전 꼬리 조건을 전개한다', async () => {
      const { prisma, service } = makeDeps();
      const page1 = Array.from({ length: TITLE_BACKFILL_PAGE_SIZE }, (_, i) =>
        row(`P${String(i).padStart(4, '0')}`, '기타 미매칭 제목', '20170301'),
      );
      prisma.disclosure.findMany
        .mockResolvedValueOnce(page1)
        .mockResolvedValueOnce([]);

      await service.backfillOnce();

      expect(prisma.disclosure.findMany).toHaveBeenCalledTimes(2);
      const tail = page1[page1.length - 1];
      const secondWhere = prisma.disclosure.findMany.mock.calls[1][0].where;
      expect(secondWhere.AND[1]).toEqual({
        OR: [
          { rcpDt: { gt: tail.rcpDt } },
          { rcpDt: tail.rcpDt, rcpNo: { gt: tail.rcpNo } },
        ],
      });
    });

    it('startAfter 커서 옵션(rcpDt·rcpNo 동반)을 첫 페이지 술어에 반영한다 — 수동 재개', async () => {
      const { prisma, service } = makeDeps();

      await service.backfillOnce({
        startAfterRcpDt: '20190101',
        startAfterRcpNo: 'X999',
      });

      const firstWhere = prisma.disclosure.findMany.mock.calls[0][0].where;
      expect(firstWhere.AND[1]).toEqual({
        OR: [
          { rcpDt: { gt: '20190101' } },
          { rcpDt: '20190101', rcpNo: { gt: 'X999' } },
        ],
      });
    });

    it('scanLimit 을 하드 상한으로 클램프하고, 페이지 크기 이하면 take 로 그대로 쓴다', async () => {
      const { prisma, service } = makeDeps();
      prisma.disclosure.findMany.mockResolvedValue([]);

      await service.backfillOnce({ scanLimit: 7 });
      expect(prisma.disclosure.findMany.mock.calls[0][0].take).toBe(7);

      await service.backfillOnce({ scanLimit: MAX_SCAN_LIMIT * 10 });
      expect(prisma.disclosure.findMany.mock.calls[1][0].take).toBe(
        TITLE_BACKFILL_PAGE_SIZE,
      );
    });

    it('scanLimit=0 이면 스캔·생성 없이 잔여 카운트만 반환한다', async () => {
      const { prisma, service } = makeDeps();
      prisma.disclosure.count.mockResolvedValueOnce(42);

      const r = await service.backfillOnce({ scanLimit: 0 });

      expect(prisma.disclosure.findMany).not.toHaveBeenCalled();
      expect(r.scanned).toBe(0);
      expect(r.remainingCandidates).toBe(42);
    });
  });

  describe('분류 룰 재사용 경계 (event-classifier SSOT)', () => {
    it('라이브 룰 테이블과 동일한 eventType·polarity·confidence 로 이벤트를 생성한다', async () => {
      const { prisma, service } = makeDeps();
      prisma.disclosure.findMany.mockResolvedValueOnce([
        row('B1', '주요사항보고서(자기주식취득결정)'), // SHARE_BUYBACK 0.95
        row('B2', '유상증자결정(제3자배정)'), // THIRD_PARTY_ALLOTMENT 0.93
      ]);
      prisma.disclosureEvent.createMany.mockResolvedValueOnce({ count: 2 });

      const r = await service.backfillOnce();

      expect(r.matched).toBe(2);
      const data = prisma.disclosureEvent.createMany.mock.calls[0][0].data;
      expect(data).toEqual([
        expect.objectContaining({
          rcpNo: 'B1',
          corpCode: 'C-B1',
          eventType: EventType.SHARE_BUYBACK,
          polarity: 'POSITIVE',
          confidence: 0.95,
        }),
        expect.objectContaining({
          rcpNo: 'B2',
          eventType: EventType.THIRD_PARTY_ALLOTMENT,
          polarity: 'NEGATIVE',
          confidence: 0.93,
        }),
      ]);
    });

    it('생성 행은 SUCCESS + 관측 구분 마커(failReason·extractedData.backfillSource)를 갖는다 — 스키마 변경 0', async () => {
      const { prisma, service } = makeDeps();
      prisma.disclosure.findMany.mockResolvedValueOnce([
        row('M1', '단일판매ㆍ공급계약체결'),
      ]);
      prisma.disclosureEvent.createMany.mockResolvedValueOnce({ count: 1 });

      await service.backfillOnce();

      const [created] = prisma.disclosureEvent.createMany.mock.calls[0][0].data;
      expect(created).toEqual({
        rcpNo: 'M1',
        corpCode: 'C-M1',
        eventType: EventType.SUPPLY_CONTRACT,
        polarity: 'POSITIVE',
        confidence: 0.92,
        isAiAssisted: false, // AI 미개입(L0)
        extractionStatus: ExtractionStatus.SUCCESS, // Event Study(loadEvents=SUCCESS만) 편입
        extractedData: { backfillSource: TITLE_BACKFILL_SOURCE },
        failReason: TITLE_ONLY_BACKFILL_MARKER, // 라이브 관측과 분리 집계용 마커
      });
    });

    it('룰 미매칭 제목은 이벤트를 만들지 않는다(OTHER 오염 금지 — 파싱 경로에 위임)', async () => {
      const { prisma, service } = makeDeps();
      prisma.disclosure.findMany.mockResolvedValueOnce([
        row('U1', '완전히 다른 임의의 제목'),
      ]);

      const r = await service.backfillOnce();

      expect(r.skippedUnmatched).toBe(1);
      expect(r.matched).toBe(0);
      expect(prisma.disclosureEvent.createMany).not.toHaveBeenCalled();
    });

    it('confidence < 0.85(절차성·방향 미상 룰)는 건너뛴다 — 라이브 SUCCESS 임계와 경계 일치', async () => {
      const { prisma, service } = makeDeps();
      prisma.disclosure.findMany.mockResolvedValueOnce([
        row('L1', '주주총회소집공고'), // SHAREHOLDER_MEETING 0.80 < 0.85
        row('L2', '연결재무제표기준영업(잠정)실적'), // EARNINGS 0.72 < 0.85 (방향 미상 MIXED)
        row('L3', '무상증자결정'), // BONUS_ISSUE 0.85 == 임계(포함)
      ]);
      prisma.disclosureEvent.createMany.mockResolvedValueOnce({ count: 1 });

      const r = await service.backfillOnce();

      expect(r.skippedLowConfidence).toBe(2);
      expect(r.matched).toBe(1);
      const data = prisma.disclosureEvent.createMany.mock.calls[0][0].data;
      expect(data).toHaveLength(1);
      expect(data[0]).toEqual(
        expect.objectContaining({
          rcpNo: 'L3',
          eventType: EventType.BONUS_ISSUE,
          confidence: TITLE_BACKFILL_MIN_CONFIDENCE,
        }),
      );
    });

    it('임계(0.85)는 룰 테이블에 실제로 양쪽 구간이 존재하는 유효 경계다', () => {
      // 가드: 룰 테이블이 전부 ≥0.85 로 바뀌면(경계 무의미) 이 스펙이 재검토를 강제한다.
      const above = REPORT_NAME_RULES.filter(
        (rule) => rule.confidence >= TITLE_BACKFILL_MIN_CONFIDENCE,
      );
      const below = REPORT_NAME_RULES.filter(
        (rule) => rule.confidence < TITLE_BACKFILL_MIN_CONFIDENCE,
      );
      expect(above.length).toBeGreaterThan(0);
      expect(below.length).toBeGreaterThan(0);
    });
  });

  describe('결과 집계·진행 리포트', () => {
    it('마지막 페이지가 페이지 크기 미만이면 exhausted=true 와 마지막 커서를 보고한다', async () => {
      const { prisma, service } = makeDeps();
      prisma.disclosure.findMany.mockResolvedValueOnce([
        row('E1', '거래정지', '20160505'),
        row('E2', '아무 제목', '20160506'),
      ]);
      prisma.disclosureEvent.createMany.mockResolvedValueOnce({ count: 1 });
      prisma.disclosure.count.mockResolvedValueOnce(1);

      const r = await service.backfillOnce();

      expect(r).toEqual(
        expect.objectContaining({
          scanned: 2,
          matched: 1,
          created: 1,
          skippedUnmatched: 1,
          exhausted: true,
          lastRcpDt: '20160506',
          lastRcpNo: 'E2',
          remainingCandidates: 1,
        }),
      );
    });

    it('기본 scanLimit 은 DEFAULT_SCAN_LIMIT(전량 커버) — 미매칭 머리 정체 방지', () => {
      // 커서를 영속하지 않으므로(스키마 변경 금지) 기본 상한이 백필 전량을 덮어야
      // 미매칭 행 머리에 걸려 진척이 멈추지 않는다 — 설계 전제를 상수로 고정.
      expect(DEFAULT_SCAN_LIMIT).toBeGreaterThanOrEqual(200_000);
      expect(MAX_SCAN_LIMIT).toBeGreaterThanOrEqual(DEFAULT_SCAN_LIMIT);
    });

    it('getProgress 는 잔여 후보·전체 무이벤트·마커 기준 생성 누계를 분리 집계한다', async () => {
      const { prisma, service } = makeDeps();
      prisma.disclosure.count
        .mockResolvedValueOnce(300) // backfillWithoutEvent
        .mockResolvedValueOnce(120); // titleBackfillCandidates
      prisma.disclosureEvent.count.mockResolvedValueOnce(80);

      const p = await service.getProgress();

      expect(p).toEqual({
        backfillWithoutEvent: 300,
        titleBackfillCandidates: 120,
        titleOnlyEventsCreated: 80,
      });
      expect(prisma.disclosureEvent.count).toHaveBeenCalledWith({
        where: { failReason: TITLE_ONLY_BACKFILL_MARKER },
      });
    });
  });
});
