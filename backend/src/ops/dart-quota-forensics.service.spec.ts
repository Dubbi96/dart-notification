import { BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  DartQuotaForensicsService,
  buildHourlyRows,
  buildHypothesisVerdict,
  estimateListCalls,
  formatKstTimestamp,
  kstDayBoundsUtc,
  kstHourIndex,
  normalizeForensicsDate,
} from './dart-quota-forensics.service';
import { DART_FORENSICS_PATHS, DartForensicsPathKey } from './dart-quota-forensics.types';

/**
 * DAR-536 DART 야간 쿼터 포렌식 — 결정론적 단위 테스트(DB 무관, 순수 함수 + 모킹).
 */

/** KST 벽시계 → UTC Date (테스트 픽스처 가독용). */
function kst(y: number, mo: number, d: number, h = 0, mi = 0): Date {
  return new Date(Date.UTC(y, mo - 1, d, h, mi) - 9 * 60 * 60 * 1000);
}

describe('dart-quota-forensics 순수 함수', () => {
  const NOW = kst(2026, 7, 17, 10, 0);

  it('normalizeForensicsDate — 기본 오늘(KST)·유효 통과·형식/실존 위반 400', () => {
    expect(normalizeForensicsDate(undefined, NOW)).toBe('20260717');
    expect(normalizeForensicsDate('', NOW)).toBe('20260717');
    expect(normalizeForensicsDate('20260715', NOW)).toBe('20260715');
    expect(() => normalizeForensicsDate('2026-07-15', NOW)).toThrow(BadRequestException);
    expect(() => normalizeForensicsDate('2026071', NOW)).toThrow(BadRequestException);
    expect(() => normalizeForensicsDate('20260231', NOW)).toThrow(BadRequestException); // 2/31 실존 X
  });

  it('kstDayBoundsUtc — KST 자정/08:30/익일 자정의 UTC 환산', () => {
    const b = kstDayBoundsUtc('20260715');
    expect(b.dayStartUtc.toISOString()).toBe('2026-07-14T15:00:00.000Z'); // KST 00:00
    expect(b.nightEndUtc.toISOString()).toBe('2026-07-14T23:30:00.000Z'); // KST 08:30
    expect(b.dayEndUtc.toISOString()).toBe('2026-07-15T15:00:00.000Z'); // 익일 KST 00:00
  });

  it('estimateListCalls — 1페이지=1콜·0건도 최소 1콜·페이지 경계', () => {
    expect(estimateListCalls(0)).toBe(1);
    expect(estimateListCalls(1)).toBe(1);
    expect(estimateListCalls(100)).toBe(1);
    expect(estimateListCalls(101)).toBe(2);
    expect(estimateListCalls(5000)).toBe(50);
    expect(estimateListCalls(NaN)).toBe(1);
  });

  it('kstHourIndex / formatKstTimestamp — KST 벽시계 규약', () => {
    expect(kstHourIndex(kst(2026, 7, 15, 0, 5))).toBe(0);
    expect(kstHourIndex(kst(2026, 7, 15, 23, 59))).toBe(23);
    expect(formatKstTimestamp(kst(2026, 7, 15, 3, 20))).toBe('2026-07-15 03:20:00');
  });

  it('buildHourlyRows — 고정 24행·경로 고정 순서·합계', () => {
    const byPath = Object.fromEntries(
      DART_FORENSICS_PATHS.map((p) => [p, new Array(24).fill(0)]),
    ) as Record<DartForensicsPathKey, number[]>;
    byPath.DOC_FETCH_BACKFILL[3] = 100;
    byPath.FINANCIALS[3] = 20;
    byPath.LIST_FORWARD[8] = 5;
    const rows = buildHourlyRows(byPath);
    expect(rows).toHaveLength(24);
    expect(rows[0].hour).toBe('00');
    expect(rows[23].hour).toBe('23');
    expect(rows[3].total).toBe(120);
    expect(rows[3].byPath.DOC_FETCH_BACKFILL).toBe(100);
    expect(rows[8].total).toBe(5);
    expect(rows[5].total).toBe(0);
    expect(rows[3].byPath.TABLES_LAZY_FETCH).toBe(0);
  });

  describe('buildHypothesisVerdict — 판정 규칙 전 분기', () => {
    it('소비 흔적 0건 → INCONCLUSIVE', () => {
      const v = buildHypothesisVerdict({
        nightEstimatedCalls: 0,
        restartMarkerCount: 0,
        quotaExhausted: null,
      });
      expect(v.verdict).toBe('INCONCLUSIVE');
      expect(v.budgetOverrunFactor).toBe(0);
    });

    it('벌크 상한 초과(하한 기준) → SUPPORTED + 마커 0건이면 멀티 인스턴스 병행 검토 사유', () => {
      const v = buildHypothesisVerdict({
        nightEstimatedCalls: 14_973,
        restartMarkerCount: 0,
        quotaExhausted: true,
      });
      expect(v.verdict).toBe('SUPPORTED');
      expect(v.budgetOverrunFactor).toBeCloseTo(1.07, 2);
      expect(v.reasons.some((r) => r.includes('멀티 인스턴스'))).toBe(true);
      expect(v.reasons.some((r) => r.includes('020/021'))).toBe(true);
    });

    it('마커 2건 이상 + 상한 50% 이상 소비 → SUPPORTED', () => {
      const v = buildHypothesisVerdict({
        nightEstimatedCalls: 8_000,
        restartMarkerCount: 3,
        quotaExhausted: null,
      });
      expect(v.verdict).toBe('SUPPORTED');
    });

    it('상한 내 소비 + 마커 0건 → REFUTED(해당 일자 한정)', () => {
      const v = buildHypothesisVerdict({
        nightEstimatedCalls: 300,
        restartMarkerCount: 0,
        quotaExhausted: false,
      });
      expect(v.verdict).toBe('REFUTED');
      expect(v.note).toContain('1일 한정');
    });

    it('마커 있으나 소비 임계 미달 → INCONCLUSIVE', () => {
      const v = buildHypothesisVerdict({
        nightEstimatedCalls: 300,
        restartMarkerCount: 1,
        quotaExhausted: null,
      });
      expect(v.verdict).toBe('INCONCLUSIVE');
    });
  });
});

describe('DartQuotaForensicsService (프리즈마 모킹)', () => {
  const NOW = kst(2026, 7, 17, 10, 0);
  const DAY = '20260715';

  /** 사건 야간 시나리오 픽스처 — 03시 백필 문서 fetch 폭주 + 야간 list/재무/지분 소비. */
  function buildPrisma(overrides?: {
    docRows?: unknown[];
    finRows?: unknown[];
    insiderRows?: unknown[];
    collectionLogs?: unknown[];
    stuckCronRows?: unknown[];
    quotaRow?: unknown;
  }) {
    const collectionLogs = overrides?.collectionLogs ?? [
      {
        startedAt: kst(2026, 7, 15, 0, 5),
        endedAt: kst(2026, 7, 15, 0, 6),
        bgnDe: '20260715',
        endDe: '20260715',
        triggeredBy: 'CRON',
        status: 'SUCCESS',
        fetchedCount: 250, // → 3콜
      },
      {
        startedAt: kst(2026, 7, 15, 1, 0),
        endedAt: kst(2026, 7, 15, 1, 30),
        bgnDe: '20190101',
        endDe: '20190130',
        triggeredBy: 'BACKFILL_EXTEND',
        status: 'PARTIAL',
        fetchedCount: 5000, // → 50콜
      },
      {
        startedAt: kst(2026, 7, 15, 9, 0), // 주간 — 야간 창 밖
        endedAt: kst(2026, 7, 15, 9, 1),
        bgnDe: '20260715',
        endDe: '20260715',
        triggeredBy: 'CRON',
        status: 'SUCCESS',
        fetchedCount: 80, // → 1콜(주간 귀속)
      },
    ];
    // $queryRaw 순서: 문서 fetch → 재무 → 지분 (Promise.all 인자 평가 순서로 결정론).
    const docRows = overrides?.docRows ?? [
      { hour: '03', isBackfill: true, cnt: 14_000, nightCnt: 14_000 },
      { hour: '10', isBackfill: false, cnt: 500, nightCnt: 0 },
    ];
    const finRows = overrides?.finRows ?? [{ hour: '04', cnt: 800, nightCnt: 800 }];
    const insiderRows = overrides?.insiderRows ?? [{ hour: '03', cnt: 120, nightCnt: 120 }];
    const stuckCronRows = overrides?.stuckCronRows ?? [
      {
        jobKey: 'event.backfill-drain',
        status: 'RUNNING',
        finishedAt: null,
        startedAt: kst(2026, 7, 15, 3, 20),
        itemCount: 0,
      },
    ];
    const timelineRows = [
      {
        jobKey: 'event.backfill-drain',
        startedAt: kst(2026, 7, 15, 3, 0),
        finishedAt: kst(2026, 7, 15, 3, 9),
        status: 'SUCCESS',
        itemCount: 200,
      },
      {
        jobKey: 'tables.offload-drain',
        startedAt: kst(2026, 7, 15, 2, 0),
        finishedAt: kst(2026, 7, 15, 2, 1),
        status: 'SUCCESS',
        itemCount: 40,
      },
    ];
    const quotaRow =
      overrides?.quotaRow !== undefined
        ? overrides.quotaRow
        : {
            day: DAY,
            callsToday: 18_800,
            quotaExhausted: true,
            updatedAt: kst(2026, 7, 15, 8, 10),
          };

    const $queryRaw = jest
      .fn()
      .mockResolvedValueOnce(docRows)
      .mockResolvedValueOnce(finRows)
      .mockResolvedValueOnce(insiderRows);
    return {
      dartQuotaState: { findUnique: jest.fn().mockResolvedValue(quotaRow) },
      disclosureCollectionLog: {
        // where.status='RUNNING' 은 재기동 마커 질의 — 본계열과 인자로 구별.
        findMany: jest.fn((args: { where?: { status?: string } }) =>
          Promise.resolve(args?.where?.status === 'RUNNING' ? [] : collectionLogs),
        ),
      },
      cronRunLog: {
        findMany: jest.fn((args: { where?: { status?: string } }) =>
          Promise.resolve(args?.where?.status === 'RUNNING' ? stuckCronRows : timelineRows),
        ),
      },
      financialCollectionLog: { findMany: jest.fn().mockResolvedValue([]) },
      $queryRaw,
    };
  }

  it('사건 야간 — 경로 정량·상위 3경로·시간대 분포·가설 SUPPORTED', async () => {
    const prisma = buildPrisma();
    const service = new DartQuotaForensicsService(prisma as unknown as PrismaService);
    const r = await service.getForensics(DAY, NOW);

    expect(r.date).toBe(DAY);
    expect(r.nightWindow).toEqual({ startKst: '00:00', endKst: '08:29' });

    // 야간 정량: list forward 3 + 백필확장 50 + 문서백필 14000 + 재무 800 + 지분 120 = 14973.
    const byKey = Object.fromEntries(r.night.paths.map((p) => [p.path, p.estimatedCalls]));
    expect(byKey.LIST_FORWARD).toBe(3);
    expect(byKey.LIST_BACKFILL_EXTEND).toBe(50);
    expect(byKey.DOC_FETCH_BACKFILL).toBe(14_000);
    expect(byKey.DOC_FETCH_LIVE).toBe(0); // 라이브 fetch 는 10시(주간)뿐
    expect(byKey.FINANCIALS).toBe(800);
    expect(byKey.INSIDER_HOLDINGS).toBe(120);
    expect(byKey.TABLES_LAZY_FETCH).toBe(0); // 구조적 0
    expect(r.night.totalEstimatedCalls).toBe(14_973);

    // DoD: 상위 경로 3건 정량.
    expect(r.night.topPaths.map((p) => p.path)).toEqual([
      'DOC_FETCH_BACKFILL',
      'FINANCIALS',
      'INSIDER_HOLDINGS',
    ]);

    // 시간대 분포: 03시 = 문서백필 14000 + 지분 120 / 09시 = 주간 forward 1콜 / 10시 = 라이브 500.
    const h3 = r.hourly.find((h) => h.hour === '03');
    expect(h3?.total).toBe(14_120);
    expect(r.hourly.find((h) => h.hour === '09')?.byPath.LIST_FORWARD).toBe(1);
    expect(r.hourly.find((h) => h.hour === '10')?.byPath.DOC_FETCH_LIVE).toBe(500);

    // 재기동 마커(RUNNING 고착 크론 1건) + 쿼터 상태.
    expect(r.restartMarkers.count).toBe(1);
    expect(r.restartMarkers.markers[0]).toMatchObject({
      source: 'cron_run_logs',
      key: 'event.backfill-drain',
      startedAtKst: '2026-07-15 03:20:00',
    });
    expect(r.quotaState).toMatchObject({ found: true, callsToday: 18_800, quotaExhausted: true });

    // 가설 판정: 하한 14,973 > 벌크 상한 14,000 → SUPPORTED.
    expect(r.hypothesis.verdict).toBe('SUPPORTED');
    expect(r.hypothesis.nightEstimatedCalls).toBe(14_973);
    expect(r.hypothesis.bulkCeiling).toBe(14_000);
    expect(r.hypothesis.restartMarkerCount).toBe(1);

    // 크론 타임라인: DART 유관 태깅(tables 오프로드는 반증 컨텍스트로 false).
    const timeline = Object.fromEntries(r.cronTimeline.map((t) => [t.jobKey, t.dartRelevant]));
    expect(timeline['event.backfill-drain']).toBe(true);
    expect(timeline['tables.offload-drain']).toBe(false);

    // 수집 실행 원자료 감사 추적.
    expect(r.collectionRuns).toHaveLength(3);
    expect(r.collectionRuns[1]).toMatchObject({
      triggeredBy: 'BACKFILL_EXTEND',
      status: 'PARTIAL',
      estimatedListCalls: 50,
    });
  });

  it('조용한 날 — 소비 0·쿼터 행 없음 → INCONCLUSIVE(정직 고지)', async () => {
    const prisma = buildPrisma({
      docRows: [],
      finRows: [],
      insiderRows: [],
      collectionLogs: [],
      stuckCronRows: [],
      quotaRow: null,
    });
    const service = new DartQuotaForensicsService(prisma as unknown as PrismaService);
    const r = await service.getForensics(DAY, NOW);
    expect(r.night.totalEstimatedCalls).toBe(0);
    expect(r.night.topPaths).toEqual([]);
    expect(r.quotaState.found).toBe(false);
    expect(r.hypothesis.verdict).toBe('INCONCLUSIVE');
    expect(r.hourly.every((h) => h.total === 0)).toBe(true);
  });

  it('상한 내 소비 + 마커 0건 → 해당 일자 REFUTED', async () => {
    const prisma = buildPrisma({
      docRows: [{ hour: '02', isBackfill: false, cnt: 300, nightCnt: 300 }],
      finRows: [],
      insiderRows: [],
      collectionLogs: [],
      stuckCronRows: [],
    });
    const service = new DartQuotaForensicsService(prisma as unknown as PrismaService);
    const r = await service.getForensics(DAY, NOW);
    expect(r.night.totalEstimatedCalls).toBe(300);
    expect(r.hypothesis.verdict).toBe('REFUTED');
  });

  it('dart_quota_state 조회 실패 시 found=false 로 리포트 본계열 유지(read-only 안전)', async () => {
    const prisma = buildPrisma({
      docRows: [],
      finRows: [],
      insiderRows: [],
      collectionLogs: [],
      stuckCronRows: [],
    });
    prisma.dartQuotaState.findUnique = jest
      .fn()
      .mockRejectedValue(new Error('relation "dart_quota_state" does not exist'));
    const service = new DartQuotaForensicsService(prisma as unknown as PrismaService);
    const r = await service.getForensics(DAY, NOW);
    expect(r.quotaState.found).toBe(false);
    expect(r.quotaState.note).toContain('조회 실패');
  });

  it('date 형식 위반 → BadRequestException(INVALID_DATE_PARAM)', async () => {
    const prisma = buildPrisma();
    const service = new DartQuotaForensicsService(prisma as unknown as PrismaService);
    await expect(service.getForensics('26-07-15', NOW)).rejects.toThrow(BadRequestException);
  });
});
