// DAR-379 — AI 평가 백필 드레이너의 예산 게이팅·배치 산정·멱등 발행·graceful 검증.
import { AiBackfillDrainService } from './ai-backfill-drain.service';
import { AiCostLimitGuardService } from '../cost-gate/ai-cost-limit-guard.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AiCostLimitStatus } from '../types/ai-analyst.types';
import { aiAnalyzeJobId, JOB } from '../../common/queues/queue.constants';
import { TITLE_ONLY_BACKFILL_MARKER } from '../../engine1-disclosure/pipeline/title-event-backfill.constants';

type Candidate = {
  rcpNo: string;
  corpCode: string;
  eventType: string;
  polarity: string;
  confidence: number;
  isAiAssisted: boolean;
};

function makeStatus(over: Partial<AiCostLimitStatus> = {}): AiCostLimitStatus {
  return {
    dailyCostUsd: 0,
    dailyLimitUsd: 1.0,
    dailyExceeded: false,
    monthlyCostUsd: 0,
    monthlyLimitUsd: 20.0,
    monthlyExceeded: false,
    forcedLevel: null,
    ...over,
  };
}

function makeCandidate(i: number): Candidate {
  return {
    rcpNo: `2026010${i}000001`,
    corpCode: `0012345${i}`,
    eventType: 'SUPPLY_CONTRACT',
    polarity: 'POSITIVE',
    confidence: 0.9,
    isAiAssisted: false,
  };
}

function makeGuard(status: AiCostLimitStatus) {
  return {
    getLimitStatus: jest.fn().mockResolvedValue(status),
  } as unknown as AiCostLimitGuardService;
}

function makePrisma(candidates: Candidate[]) {
  const findMany = jest.fn().mockResolvedValue(candidates);
  const prisma = {
    disclosureEvent: { findMany },
  } as unknown as PrismaService;
  return { prisma, findMany };
}

function makeQueue() {
  const add = jest.fn().mockResolvedValue(undefined);
  return { queue: { add } as any, add };
}

describe('AiBackfillDrainService (DAR-379)', () => {
  it('일 예산 소진 시 발행하지 않고 skippedByBudget=true (후보 조회조차 생략)', async () => {
    const guard = makeGuard(makeStatus({ dailyExceeded: true, dailyCostUsd: 1.0 }));
    const { prisma, findMany } = makePrisma([makeCandidate(1)]);
    const { queue, add } = makeQueue();
    const svc = new AiBackfillDrainService(prisma, guard, queue);

    const res = await svc.drainOnce();

    expect(res.skippedByBudget).toBe(true);
    expect(res.enqueued).toBe(0);
    expect(res.scanned).toBe(0);
    expect(findMany).not.toHaveBeenCalled();
    expect(add).not.toHaveBeenCalled();
  });

  it('월 예산 소진 시에도 발행하지 않는다', async () => {
    const guard = makeGuard(makeStatus({ monthlyExceeded: true, monthlyCostUsd: 20.0 }));
    const { prisma, findMany } = makePrisma([makeCandidate(1)]);
    const { queue } = makeQueue();
    const svc = new AiBackfillDrainService(prisma, guard, queue);

    const res = await svc.drainOnce();

    expect(res.skippedByBudget).toBe(true);
    expect(findMany).not.toHaveBeenCalled();
  });

  it('잔액이 추정단가로 0건이면(예: $0.995 소진) 발행 생략', async () => {
    // remaining = 1.0 - 0.995 = 0.005; floor(0.005/0.01)=0 → effectiveLimit 0 → skip
    const guard = makeGuard(makeStatus({ dailyCostUsd: 0.995 }));
    const { prisma, findMany } = makePrisma([makeCandidate(1)]);
    const { queue } = makeQueue();
    const svc = new AiBackfillDrainService(prisma, guard, queue);

    const res = await svc.drainOnce();

    expect(res.budgetBatchLimit).toBe(0);
    expect(res.skippedByBudget).toBe(true);
    expect(findMany).not.toHaveBeenCalled();
  });

  it('예산 여유 시 후보를 멱등 자연키(ai-<rcpNo>)로 큐에 발행하고 enqueued 반환', async () => {
    const candidates = [makeCandidate(1), makeCandidate(2), makeCandidate(3)];
    const guard = makeGuard(makeStatus({ dailyCostUsd: 0 }));
    const { prisma, findMany } = makePrisma(candidates);
    const { queue, add } = makeQueue();
    const svc = new AiBackfillDrainService(prisma, guard, queue);

    const res = await svc.drainOnce();

    expect(res.skippedByBudget).toBe(false);
    expect(res.scanned).toBe(3);
    expect(res.enqueued).toBe(3);
    // 예산 추정: floor((1.0-0)/0.01)=100, min(200,100)=100
    expect(res.budgetBatchLimit).toBe(100);
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 100, orderBy: { extractedAt: 'asc' } }),
    );
    expect(add).toHaveBeenCalledTimes(3);
    // 첫 발행: JOB.EVENT_EXTRACTED + jobId=ai-<rcpNo> + payload 매핑
    const [jobName, payload, opts] = add.mock.calls[0];
    expect(jobName).toBe(JOB.EVENT_EXTRACTED);
    expect(payload).toEqual({
      rcpNo: candidates[0].rcpNo,
      corpCode: candidates[0].corpCode,
      eventType: 'SUPPLY_CONTRACT',
      polarity: 'POSITIVE',
      confidence: 0.9,
      isAiAssisted: false,
    });
    expect(opts.jobId).toBe(aiAnalyzeJobId(candidates[0].rcpNo));
  });

  it('미분석 후보 0건이면 enqueued 0·skippedByBudget false(적체 없음)', async () => {
    const guard = makeGuard(makeStatus());
    const { prisma } = makePrisma([]);
    const { queue, add } = makeQueue();
    const svc = new AiBackfillDrainService(prisma, guard, queue);

    const res = await svc.drainOnce();

    expect(res.scanned).toBe(0);
    expect(res.enqueued).toBe(0);
    expect(res.skippedByBudget).toBe(false);
    expect(add).not.toHaveBeenCalled();
  });

  it('큐 미가용(null) 시 graceful — queueAvailable false·enqueued 0, 후보는 스캔', async () => {
    const candidates = [makeCandidate(1)];
    const guard = makeGuard(makeStatus());
    const { prisma } = makePrisma(candidates);
    const svc = new AiBackfillDrainService(prisma, guard, null);

    const res = await svc.drainOnce();

    expect(res.queueAvailable).toBe(false);
    expect(res.scanned).toBe(1);
    expect(res.enqueued).toBe(0);
    expect(res.skippedByBudget).toBe(false);
  });

  it('options.limit 은 예산 상한보다 더 작은 쪽으로 클램프된다(안전)', async () => {
    const candidates = [makeCandidate(1)];
    const guard = makeGuard(makeStatus({ dailyCostUsd: 0 }));
    const { prisma, findMany } = makePrisma(candidates);
    const { queue } = makeQueue();
    const svc = new AiBackfillDrainService(prisma, guard, queue);

    // 예산 상한 100, 명시 5 → min(5,100)=5
    await svc.drainOnce({ limit: 5 });

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 5 }),
    );
  });

  it('제목 기반 백필(TITLE_ONLY) 관측치는 후보에서 제외한다 — AI 예산 잠식 방지(W4)', async () => {
    const guard = makeGuard(makeStatus({ dailyCostUsd: 0 }));
    const { prisma, findMany } = makePrisma([]);
    const { queue } = makeQueue();
    const svc = new AiBackfillDrainService(prisma, guard, queue);

    await svc.drainOnce();

    const where = findMany.mock.calls[0][0].where;
    // null 분기 명시(기존 라이브 행 전부 보존) + 마커 동등 제외.
    expect(where.AND).toEqual([
      {
        OR: [
          { failReason: null },
          { failReason: { not: TITLE_ONLY_BACKFILL_MARKER } },
        ],
      },
    ]);
  });

  it('하드 캡(MAX_BATCH_PER_RUN=200) — 예산이 커도 200을 넘지 않는다', async () => {
    // 일 한도를 인위적으로 크게: remaining 큼 → affordable 큼 but 200 캡
    const guard = makeGuard(makeStatus({ dailyLimitUsd: 100, dailyCostUsd: 0 }));
    const { prisma, findMany } = makePrisma([]);
    const { queue } = makeQueue();
    const svc = new AiBackfillDrainService(prisma, guard, queue);

    const res = await svc.drainOnce();

    expect(res.budgetBatchLimit).toBe(200);
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 200 }),
    );
  });
});
