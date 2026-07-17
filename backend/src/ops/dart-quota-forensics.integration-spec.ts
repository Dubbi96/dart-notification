/**
 * dart-quota-forensics.integration-spec.ts — 실 Postgres 통합테스트 (DAR-536)
 *
 * `DartQuotaForensicsService` 의 `$queryRaw` 3본(문서 fetch·재무·지분)이 **실제 DB 컬럼**
 * (따옴표 camelCase — DAR-519 회귀 유형)·FILTER 야간 경계·Prisma.raw 합성과 정합하는지,
 * 그리고 수집 로그/크론 타임라인/재기동 마커/쿼터 상태의 전 계열이 실 DB 왕복으로
 * 기대 정량을 산출하는지 검증한다. 단위 스펙은 $queryRaw 를 모킹해 컬럼명을 검증하지 못한다.
 *
 * ★ 격리: withRollback 안에서 seed(Company·Disclosure·Document·CollectionLog·CronRunLog·
 *   Financial·Insider·QuotaState) 후 서비스를 tx 로 구성해 같은 트랜잭션에서 조회, 끝나면
 *   전부 롤백(커밋 0·잔여 row 0 — afterAll 에서 baseline 불변 확인). 데모 DB 무변경.
 * ★ 원거리 미래 일자(20990620 KST) seed — 데모/실 데이터와 시간창이 절대 겹치지 않아
 *   카운트가 결정론적이다(시한부 테스트 아님: 절대 일자 하나를 조회하는 성질만 사용).
 * 실행: npm run test:integration (DATABASE_URL 필요).
 */

import { PrismaService } from '../prisma/prisma.service';
import { withRollback } from '../../test/integration/with-rollback';
import { DartQuotaForensicsService } from './dart-quota-forensics.service';
import { DartQuotaForensicsReport } from './dart-quota-forensics.types';

const prisma = new PrismaService();

const TAG = 'DAR536';
/** 감사 대상 KST 일자(원거리 미래 — 데모 데이터 무간섭). */
const DAY = '20990620';
/** 기준 시각: 익일 10:00 KST — 유예(30분) 밖이라 RUNNING 고착이 마커로 잡힌다. */
const NOW = new Date('2099-06-21T01:00:00.000Z');

/** KST 벽시계(해당 일) → UTC Date. */
function kstUtc(h: number, mi: number, dayOffset = 0): Date {
  return new Date(Date.UTC(2099, 5, 20 + dayOffset, h, mi) - 9 * 60 * 60 * 1000);
}

describe('DartQuotaForensicsService.getForensics (실 Postgres 통합)', () => {
  let baselineCollectionLogs: number;
  let baselineInsider: number;
  let report: DartQuotaForensicsReport;

  beforeAll(async () => {
    await prisma.$connect();
    baselineCollectionLogs = await prisma.disclosureCollectionLog.count();
    baselineInsider = await prisma.insiderHoldingChange.count();

    report = await withRollback(prisma, async (tx) => {
      // ── FK 부모 ──
      await tx.company.create({
        data: { corpCode: `${TAG}TC`, corpName: `${TAG} 테스트기업` },
      });

      // ── 문서 fetch: 백필(03:10 야간) 1건 + 라이브(10:00 주간) 1건 ──
      await tx.disclosure.createMany({
        data: [
          {
            rcpNo: `${TAG}-BF-1`,
            corpCode: `${TAG}TC`,
            corpName: `${TAG} 테스트기업`,
            reportName: '과거 백필 공시',
            rcpDt: DAY,
            flrName: 't',
            rmk: '',
            disclosureType: '기타',
            isBackfill: true,
          },
          {
            rcpNo: `${TAG}-LV-1`,
            corpCode: `${TAG}TC`,
            corpName: `${TAG} 테스트기업`,
            reportName: '라이브 공시',
            rcpDt: DAY,
            flrName: 't',
            rmk: '',
            disclosureType: '기타',
            isBackfill: false,
          },
        ],
      });
      await tx.disclosureDocument.createMany({
        data: [
          { rcpNo: `${TAG}-BF-1`, corpCode: `${TAG}TC`, fetchedAt: kstUtc(3, 10) },
          { rcpNo: `${TAG}-LV-1`, corpCode: `${TAG}TC`, fetchedAt: kstUtc(10, 0) },
        ],
      });

      // ── 목록 수집: forward(00:05, 250건→3콜)·백필확장(01:00, 0건→1콜)·RUNNING 고착(03:20) ──
      await tx.disclosureCollectionLog.createMany({
        data: [
          {
            startedAt: kstUtc(0, 5),
            endedAt: kstUtc(0, 6),
            bgnDe: DAY,
            endDe: DAY,
            triggeredBy: 'CRON',
            status: 'SUCCESS',
            fetchedCount: 250,
          },
          {
            startedAt: kstUtc(1, 0),
            endedAt: kstUtc(1, 30),
            bgnDe: '20190101',
            endDe: '20190130',
            triggeredBy: 'BACKFILL_EXTEND',
            status: 'PARTIAL',
            fetchedCount: 0,
          },
          {
            startedAt: kstUtc(3, 20),
            bgnDe: DAY,
            endDe: DAY,
            triggeredBy: 'CRON',
            status: 'RUNNING', // endedAt null — 실행 중 프로세스 사망 마커
            fetchedCount: 0,
          },
        ],
      });

      // ── 크론 타임라인: DART 유관(이벤트 백필) + DART 0콜(tables 오프로드) ──
      await tx.cronRunLog.createMany({
        data: [
          {
            jobKey: 'event.backfill-drain',
            status: 'SUCCESS',
            itemCount: 200,
            startedAt: kstUtc(3, 0),
            finishedAt: kstUtc(3, 9),
          },
          {
            jobKey: 'tables.offload-drain',
            status: 'SUCCESS',
            itemCount: 40,
            startedAt: kstUtc(2, 0),
            finishedAt: kstUtc(2, 1),
          },
        ],
      });

      // ── 재무(04:00)·지분(03:30) — updatedAt 은 @updatedAt 자동이라 raw UPDATE 로 고정 ──
      const fin = await tx.companyFinancial.create({
        data: { corpCode: `${TAG}TC`, bsnsYear: '2098', reprtCode: '11011' },
      });
      await tx.$executeRaw`
        UPDATE company_financials SET "updatedAt" = ${kstUtc(4, 0)} WHERE id = ${fin.id}`;
      const ins = await tx.insiderHoldingChange.create({
        data: {
          source: 'MAJOR_STOCK',
          rcptNo: `${TAG}-INS-1`,
          corpCode: `${TAG}TC`,
          reporter: `${TAG} 보고자`,
          tradeType: 'BUY',
        },
      });
      await tx.$executeRaw`
        UPDATE insider_holding_changes SET "updatedAt" = ${kstUtc(3, 30)} WHERE id = ${ins.id}`;

      // ── DAR-532 쿼터 상태(당일 행) ──
      await tx.dartQuotaState.create({
        data: { day: DAY, callsToday: 14_200, quotaExhausted: true },
      });

      const service = new DartQuotaForensicsService(tx as unknown as PrismaService);
      return service.getForensics(DAY, NOW);
    });
  });

  afterAll(async () => {
    // 롤백 검증 — 커밋 0·잔여 row 0(데모 DB 무변경).
    expect(await prisma.disclosureCollectionLog.count()).toBe(baselineCollectionLogs);
    expect(await prisma.insiderHoldingChange.count()).toBe(baselineInsider);
    expect(await prisma.dartQuotaState.findUnique({ where: { day: DAY } })).toBeNull();
    await prisma.$disconnect();
  });

  it('경로별 야간 정량 — list forward 4(고착 RUNNING 포함)·백필확장 1·문서백필 1·재무 1·지분 1', () => {
    const byKey = Object.fromEntries(report.night.paths.map((p) => [p.path, p.estimatedCalls]));
    expect(byKey.LIST_FORWARD).toBe(4); // 3(250건) + 1(RUNNING 최소 1콜)
    expect(byKey.LIST_BACKFILL_EXTEND).toBe(1);
    expect(byKey.DOC_FETCH_BACKFILL).toBe(1);
    expect(byKey.DOC_FETCH_LIVE).toBe(0); // 라이브 fetch 는 10시(주간)
    expect(byKey.FINANCIALS).toBe(1);
    expect(byKey.INSIDER_HOLDINGS).toBe(1);
    expect(byKey.TABLES_LAZY_FETCH).toBe(0);
    expect(report.night.totalEstimatedCalls).toBe(8);
    expect(report.night.topPaths[0].path).toBe('LIST_FORWARD');
  });

  it('시간대 분포 — 03시(문서백필+지분+고착 list)=3 · 10시 라이브 문서 1(야간 창 밖)', () => {
    const h3 = report.hourly.find((h) => h.hour === '03');
    expect(h3?.byPath.DOC_FETCH_BACKFILL).toBe(1);
    expect(h3?.byPath.INSIDER_HOLDINGS).toBe(1);
    expect(h3?.byPath.LIST_FORWARD).toBe(1);
    expect(h3?.total).toBe(3);
    expect(report.hourly.find((h) => h.hour === '04')?.byPath.FINANCIALS).toBe(1);
    expect(report.hourly.find((h) => h.hour === '10')?.byPath.DOC_FETCH_LIVE).toBe(1);
  });

  it('재기동 마커 — 수집 로그 RUNNING 고착 1건(03:20 KST)', () => {
    expect(report.restartMarkers.count).toBe(1);
    expect(report.restartMarkers.markers[0]).toMatchObject({
      source: 'disclosure_collection_logs',
      startedAtKst: '2099-06-20 03:20:00',
    });
  });

  it('쿼터 상태·크론 타임라인·가설 판정(소비 8콜 + 마커 1건 → INCONCLUSIVE)', () => {
    expect(report.quotaState).toMatchObject({
      found: true,
      callsToday: 14_200,
      quotaExhausted: true,
    });
    const timeline = Object.fromEntries(
      report.cronTimeline.map((t) => [t.jobKey, t.dartRelevant]),
    );
    expect(timeline['event.backfill-drain']).toBe(true);
    expect(timeline['tables.offload-drain']).toBe(false);
    expect(report.hypothesis.verdict).toBe('INCONCLUSIVE');
    expect(report.hypothesis.restartMarkerCount).toBe(1);
  });
});
