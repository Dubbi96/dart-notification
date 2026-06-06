// SimulationOrchestratorService — 신호→진입 퍼널 계측 + 멱등 + in-memory 동작 동일성 (DAR-109)
//
// PrismaSimulationAdapter write 실구현(DAR-109)으로 orchestrator 가 실 DB에 누적 가능해졌다.
// DB 없는 결정론 단위 테스트는 InMemorySimulationAdapter 로 동일 계약을 검증한다:
//   1) 매수→스냅샷→리스크 스냅샷 한 사이클(기존 in-memory 동작 보존)
//   2) 신호→진입 퍼널(생성 신호→후보 통과→체결) 일별 기록
//   3) 멱등 — 같은 거래일 재실행 시 보유 종목 재진입 0, 퍼널은 1행으로 갱신(중복 없음)

import { SimulationOrchestratorService } from './simulation-orchestrator.service';
import { InMemorySimulationAdapter } from './adapters/in-memory-simulation.adapter';
import { DEFAULT_SIMULATION_CONFIG } from './domain/simulation.config';
import { buildFunnelReport } from './domain/signal-funnel';
import { BuyCandidate } from './domain/simulation.types';

function candidate(
  stockCode: string,
  entryPrice: number,
  buyScore = 80,
): BuyCandidate {
  return {
    tradingSignalId: `sig-${stockCode}`,
    rcpNo: `rcp-${stockCode}`,
    corpCode: `corp-${stockCode}`,
    stockCode,
    signal: 'BUY_CANDIDATE',
    buyScore,
    entryPrice,
  };
}

describe('SimulationOrchestratorService (DAR-109 퍼널·멱등·동일성)', () => {
  const TRADE_DATE = '20260101';

  function setup() {
    const adapter = new InMemorySimulationAdapter({
      initialCapital: DEFAULT_SIMULATION_CONFIG.initialCapital,
      candidatesByDate: {
        [TRADE_DATE]: [candidate('000111', 10000), candidate('000222', 20000)],
      },
      closeByStock: { '000111': 10000, '000222': 20000 },
      signalCountByDate: { [TRADE_DATE]: 7 }, // 당일 생성 신호 7건(후보 2건은 그중 BUY 등급)
    });
    const svc = new SimulationOrchestratorService(adapter);
    return { adapter, svc };
  }

  it('한 사이클 — 후보 2건 모두 모의매수, 리스크 스냅샷 적재(in-memory 동작 보존)', async () => {
    const { adapter, svc } = setup();
    const r = await svc.runDailySimulation(TRADE_DATE);

    expect(r.bought).toBe(2);
    expect(r.exited).toBe(0);
    expect((await adapter.getOpenPositions(adapter.portfolioId)).length).toBe(2);
    expect(adapter.riskSnapshots).toHaveLength(1);
    expect(adapter.riskSnapshots[0].openPositionCount).toBe(2);
  });

  it('신호→진입 퍼널 기록 — signalsGenerated/candidatesPassed/filled', async () => {
    const { adapter, svc } = setup();
    const r = await svc.runDailySimulation(TRADE_DATE);

    expect(r.signalsGenerated).toBe(7);
    expect(r.candidatesPassed).toBe(2);
    expect(r.bought).toBe(2);

    const history = await adapter.getFunnelHistory(adapter.portfolioId);
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({
      tradeDate: TRADE_DATE,
      signalsGenerated: 7,
      candidatesPassed: 2,
      filled: 2,
    });

    // 파생 전환율
    const { totals } = buildFunnelReport(history);
    expect(totals.adoptionRate).toBeCloseTo(2 / 7, 10); // 후보/신호
    expect(totals.fillRate).toBeCloseTo(1, 10); // 체결/후보 = 2/2
    expect(totals.conversionRate).toBeCloseTo(2 / 7, 10); // 체결/신호
  });

  it('멱등 — 같은 거래일 재실행 시 보유 종목 재진입 0, 퍼널은 1행으로 갱신', async () => {
    const { adapter, svc } = setup();
    await svc.runDailySimulation(TRADE_DATE);
    const second = await svc.runDailySimulation(TRADE_DATE);

    // 두 종목 모두 보유 중 → 후보에서 제외(중복 매수 방지)
    expect(second.candidatesPassed).toBe(0);
    expect(second.bought).toBe(0);
    expect((await adapter.getOpenPositions(adapter.portfolioId)).length).toBe(2);

    // 퍼널은 거래일 키로 멱등 — 재실행 후에도 1행, 최신 값 반영
    const history = await adapter.getFunnelHistory(adapter.portfolioId);
    expect(history).toHaveLength(1);
    expect(history[0].candidatesPassed).toBe(0);
    expect(history[0].filled).toBe(0);
    expect(history[0].signalsGenerated).toBe(7);
  });
});
