/**
 * evaluation-corpus.service.spec.ts — 코퍼스 조립 서비스 검증 (DAR-379)
 *
 * DisclosureEvent ⨝ EventStudyObservation ⨝ DisclosureAnalysis 3소스 결합과
 * 실현결과 누락(미성숙) 흡수·limit 클램프를 mock Prisma 로 결정론 검증. read-only(쓰기 0).
 */
import { EvaluationCorpusService } from './evaluation-corpus.service';

function makePrisma(over: {
  events?: unknown[];
  observations?: unknown[];
  analyses?: unknown[];
} = {}) {
  const calls: { eventArgs?: unknown } = {};
  return {
    calls,
    prisma: {
      disclosureEvent: {
        findMany: jest.fn(async (args: unknown) => {
          calls.eventArgs = args;
          return over.events ?? [];
        }),
      },
      eventStudyObservation: {
        findMany: jest.fn(async () => over.observations ?? []),
      },
      disclosureAnalysis: {
        findMany: jest.fn(async () => over.analyses ?? []),
      },
      // 쓰기 메서드는 정의하지 않음 — read-only 보장(호출 시 TypeError)
    },
  };
}

describe('EvaluationCorpusService.getCorpus', () => {
  it('이벤트 없으면 빈 코퍼스(에러 아님)', async () => {
    const { prisma } = makePrisma({ events: [] });
    const svc = new EvaluationCorpusService(prisma as never);
    const report = await svc.getCorpus();
    expect(report.summary.totalRecords).toBe(0);
    expect(report.byEventType).toEqual([]);
  });

  it('3소스를 rcpNo 로 결합해 라벨·커버리지 산출', async () => {
    const events = [
      { rcpNo: 'r1', corpCode: 'c1', eventType: 'SUPPLY_CONTRACT', polarity: 'POSITIVE', confidence: 0.9, isAiAssisted: false },
      { rcpNo: 'r2', corpCode: 'c2', eventType: 'EARNINGS_SHOCK', polarity: 'NEGATIVE', confidence: 0.88, isAiAssisted: true },
      { rcpNo: 'r3', corpCode: 'c3', eventType: 'SUPPLY_CONTRACT', polarity: 'POSITIVE', confidence: 0.9, isAiAssisted: false }, // 관측치 없음(미성숙)
    ];
    const observations = [
      { rcpNo: 'r1', bucketKey: 'SUPPLY_CONTRACT__ALL', d0Date: '20260102', cumulativeAR: { d5: 4.0, d20: 6.0 }, maxDrawdown: -2, isUpD5: true, isCrashD5: false },
      { rcpNo: 'r2', bucketKey: 'EARNINGS_SHOCK__ALL', d0Date: '20260103', cumulativeAR: { d5: -8.0, d20: -9.0 }, maxDrawdown: -12, isUpD5: false, isCrashD5: true },
    ];
    const analyses = [
      { rcpNo: 'r1', task: 'summary' },
      { rcpNo: 'r1', task: 'event-classification' },
      { rcpNo: 'r2', task: 'summary' },
      // r3 은 AI 분석 없음
    ];

    const { prisma } = makePrisma({ events, observations, analyses });
    const svc = new EvaluationCorpusService(prisma as never);
    const report = await svc.getCorpus({ limit: 100 });

    expect(report.summary.totalRecords).toBe(3);
    // AI summary 커버리지: r1,r2 = 2/3
    expect(report.summary.withAiCount).toBe(2);
    expect(report.summary.aiCoveragePct).toBe(66.67);
    // 실현결과 커버리지: r1,r2 = 2/3 (r3 미성숙 제외)
    expect(report.summary.withOutcomeD5Count).toBe(2);
    expect(report.summary.outcomeCoverageD5Pct).toBe(66.67);
    // 라벨: r1 POSITIVE+ +4 → AGREE, r2 NEGATIVE+ -8 → AGREE, r3 outcome없음 → NEUTRAL
    expect(report.summary.agreeD5).toBe(2);
    expect(report.summary.divergeD5).toBe(0);
    expect(report.summary.neutralD5).toBe(1);
    expect(report.summary.hitRateD5).toBe(100);

    // SUPPLY_CONTRACT 그룹: r1(outcome), r3(미성숙) — recordCount 2, outcome 1
    const sc = report.byEventType.find((g) => g.key === 'SUPPLY_CONTRACT');
    expect(sc?.recordCount).toBe(2);
    expect(sc?.withOutcomeD5Count).toBe(1);
    expect(sc?.aiCoveragePct).toBe(50); // r1 만 summary
  });

  it('limit 을 [1,5000] 으로 클램프하고 eventType 필터를 전달', async () => {
    const { prisma, calls } = makePrisma({ events: [] });
    const svc = new EvaluationCorpusService(prisma as never);
    await svc.getCorpus({ limit: 999999, eventType: '  SUPPLY_CONTRACT  ' });
    const args = calls.eventArgs as { take: number; where: { eventType?: string } };
    expect(args.take).toBe(5000);
    expect(args.where.eventType).toBe('SUPPLY_CONTRACT');
  });
});
