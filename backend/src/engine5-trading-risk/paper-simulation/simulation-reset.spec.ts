/**
 * simulation-reset.spec.ts — 시스템 모의 클린 리셋 회귀 (DAR-429, DB 미사용)
 *
 * 오염(DAR-426 이전): 현금 -11.3M·자본초과 보유·리베이스로 entryDate 가 실거래일 아닌 삽입시각.
 * '원칙만 남기고 다시 시작' → resetSimulation 이 sim 포트폴리오를 초기상태로 되돌린다.
 *
 * DoD 회귀(결정론·mocked prisma·$transaction):
 *   (1) 리셋 후 현금 = INITIAL_CAPITAL(10,000,000) · OPEN 포지션 = 0.
 *   (2) 모든 삭제가 sim 포트폴리오(portfolioId) / sim thesis(positionThesisId) 범위로만 한정
 *       — DB 전역 파괴 없음, 타 트랙 무침범.
 *   (3) Position·PaperTrade·PortfolioRiskSnapshot·SignalEntryFunnelDaily 삭제 + 캐스케이드 카운트 반환.
 *   (4) 멱등: 비어 있는 포트폴리오 재실행 시 0건 삭제·현금 10M 유지.
 */

import { PaperSimulationService } from './paper-simulation.service';

const PF_ID = 'pf1';
const INITIAL = PaperSimulationService.INITIAL_CAPITAL; // 10,000,000

/**
 * @param positions sim 포트폴리오의 기존 포지션(오염분). positionThesisId 로 PaperTrade 한정.
 */
function makePrismaMock(
  positions: Array<{ id: string; positionThesisId: string | null }>,
) {
  const positionIds = positions.map((p) => p.id);
  const thesisIds = positions
    .map((p) => p.positionThesisId)
    .filter((x): x is string => !!x);

  // 캐스케이드 자식(스냅샷 2/포지션, Exit 1/포지션) — 카운트 검증용 결정값.
  const snapsTotal = positionIds.length * 2;
  const exitsTotal = positionIds.length * 1;

  const calls: Record<string, any[]> = {
    paperTradeDelete: [],
    pendingDelete: [],
    positionDelete: [],
    riskDelete: [],
    funnelDelete: [],
  };

  const tx = {
    position: {
      findMany: jest.fn(async ({ where }: { where?: any }) => {
        expect(where?.portfolioId).toBe(PF_ID); // ★범위 가드
        return positions;
      }),
      deleteMany: jest.fn(async ({ where }: { where?: any }) => {
        calls.positionDelete.push(where);
        expect(where?.portfolioId).toBe(PF_ID); // ★범위 가드
        return { count: positions.length };
      }),
    },
    positionDailySnapshot: {
      count: jest.fn(async ({ where }: { where?: any }) => {
        expect(where?.positionId?.in).toEqual(positionIds); // ★sim 포지션 한정
        return snapsTotal;
      }),
    },
    exitSignal: {
      count: jest.fn(async ({ where }: { where?: any }) => {
        expect(where?.positionId?.in).toEqual(positionIds); // ★sim 포지션 한정
        return exitsTotal;
      }),
    },
    paperTrade: {
      deleteMany: jest.fn(async ({ where }: { where?: any }) => {
        // 장외 체결 의미론(2026-07): 리셋은 ① thesis 연결 원장 + ② 시스템 모의 네임스페이스의
        //   매수 예약(PENDING)을 각각 범위 한정 삭제한다. where 형태로 두 경로를 분기 검증.
        if (where?.status === 'PENDING') {
          calls.pendingDelete.push(where);
          expect(where?.styleTag).toBe('paper-simulation'); // ★네임스페이스 한정(타 트랙 무침범)
          return { count: 0 };
        }
        calls.paperTradeDelete.push(where);
        expect(where?.positionThesisId?.in).toEqual(thesisIds); // ★sim thesis 한정
        return { count: thesisIds.length };
      }),
    },
    portfolioRiskSnapshot: {
      deleteMany: jest.fn(async ({ where }: { where?: any }) => {
        calls.riskDelete.push(where);
        expect(where?.portfolioId).toBe(PF_ID); // ★범위 가드
        return { count: 3 };
      }),
    },
    signalEntryFunnelDaily: {
      deleteMany: jest.fn(async ({ where }: { where?: any }) => {
        calls.funnelDelete.push(where);
        expect(where?.portfolioId).toBe(PF_ID); // ★범위 가드
        return { count: 4 };
      }),
    },
  };

  const prisma = {
    _calls: calls,
    user: {
      findFirst: jest.fn().mockResolvedValue({ id: 'u1' }),
      create: jest.fn().mockResolvedValue({ id: 'u1' }),
    },
    portfolio: {
      findFirst: jest.fn().mockResolvedValue({
        id: PF_ID,
        maxSinglePositionPct: 10,
        maxSectorPct: 30,
      }),
      create: jest.fn(),
    },
    // 인터랙티브 트랜잭션 — 콜백에 tx 위임 객체를 넘긴다(전부-or-전무).
    $transaction: jest.fn(async (cb: (tx: any) => Promise<unknown>) => cb(tx)),
    _tx: tx,
  };
  return prisma;
}

function makeService(prisma: ReturnType<typeof makePrismaMock>) {
  return new PaperSimulationService(prisma as never, {} as never);
}

describe('DAR-429 시스템 모의 클린 리셋 — 초기상태 복원·범위 한정·멱등', () => {
  it('오염 포지션(thesis 연결)을 삭제하고 현금=10M·0포지션으로 복원한다', async () => {
    const prisma = makePrismaMock([
      { id: 'pos1', positionThesisId: 'th1' },
      { id: 'pos2', positionThesisId: 'th2' },
      { id: 'pos3', positionThesisId: null }, // thesis 미연결 — PaperTrade 한정에서 제외
    ]);
    const svc = makeService(prisma);

    const r = await svc.resetSimulation();

    // (1) 리셋 후 불변식.
    expect(r.cashAfter).toBe(INITIAL);
    expect(r.openPositionsAfter).toBe(0);
    // (3) 삭제 + 캐스케이드 카운트.
    expect(r.deletedPositions).toBe(3);
    expect(r.deletedDailySnapshots).toBe(6); // 3 포지션 × 2
    expect(r.deletedExitSignals).toBe(3); // 3 포지션 × 1
    expect(r.deletedPaperTrades).toBe(2); // thesis 연결분(th1,th2)만
    expect(r.deletedRiskSnapshots).toBe(3);
    expect(r.deletedFunnelDaily).toBe(4);
    expect(r.portfolioId).toBe(PF_ID);
    // 트랜잭션 경유(부분 실패 롤백 보장).
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    // (2) PaperTrade 는 sim thesis 로만 한정.
    expect(prisma._calls.paperTradeDelete[0]).toEqual({
      positionThesisId: { in: ['th1', 'th2'] },
    });
    // (2-b) 매수 예약(PENDING)은 시스템 모의 네임스페이스(styleTag)로만 한정 삭제.
    expect(prisma._calls.pendingDelete).toHaveLength(1);
    expect(prisma._calls.pendingDelete[0]).toEqual({
      styleTag: 'paper-simulation',
      status: 'PENDING',
    });
    expect(r.deletedPendingEntries).toBe(0);
  });

  it('DAR-426 오염 시나리오(46 포지션·과레버리지) → 리셋 후 현금 10M·0포지션·thesis 한정 PaperTrade 삭제', async () => {
    // 이슈 실측: 46 포지션 보유로 현금 -11.3M(자본초과 과매수). 전부 thesis 연결됐다고 가정.
    const contaminated = Array.from({ length: 46 }, (_, i) => ({
      id: `pos${i}`,
      positionThesisId: `th${i}`,
    }));
    const prisma = makePrismaMock(contaminated);
    const svc = makeService(prisma);

    const r = await svc.resetSimulation();

    expect(r.deletedPositions).toBe(46);
    expect(r.deletedPaperTrades).toBe(46); // 전부 thesis 연결 → 전량 한정 삭제
    // ★오염(현금 음수·과매수) → 리셋 후 원칙적 초기상태로 복원.
    expect(r.cashAfter).toBe(INITIAL); // 10,000,000 (음수 아님)
    expect(r.openPositionsAfter).toBe(0);
  });

  it('멱등 — 비어 있는 포트폴리오 재실행 시 0건 삭제·현금 10M 유지, PaperTrade 삭제 미호출', async () => {
    const prisma = makePrismaMock([]); // 포지션 0
    const svc = makeService(prisma);

    const r = await svc.resetSimulation();

    expect(r.deletedPositions).toBe(0);
    expect(r.deletedDailySnapshots).toBe(0);
    expect(r.deletedExitSignals).toBe(0);
    expect(r.deletedPaperTrades).toBe(0);
    expect(r.cashAfter).toBe(INITIAL);
    expect(r.openPositionsAfter).toBe(0);
    // thesis 0 → thesis 한정 PaperTrade 삭제는 생략(불필요 쿼리 0). 예약(PENDING) 정리는
    //   포트폴리오 상태와 무관하게 항상 시도(멱등·0건) — styleTag 경로 1회만 호출.
    expect(prisma._calls.paperTradeDelete).toHaveLength(0);
    expect(prisma._calls.pendingDelete).toHaveLength(1);
    // 포트폴리오 범위 삭제는 항상 시도(멱등·0건).
    expect(prisma._tx.position.deleteMany).toHaveBeenCalledTimes(1);
    expect(prisma._tx.portfolioRiskSnapshot.deleteMany).toHaveBeenCalledTimes(1);
    expect(prisma._tx.signalEntryFunnelDaily.deleteMany).toHaveBeenCalledTimes(1);
  });
});
