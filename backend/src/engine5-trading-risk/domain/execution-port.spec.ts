// Engine5 — ExecutionPort / PaperExecutionAdapter 테스트 (DAR-498 §3)
import { PaperExecutionAdapter, ExecutionOrder } from './execution-port';
import { DEFAULT_FILL_PARAMS, simulateFill } from './fill-simulator';

const order = (over: Partial<ExecutionOrder> = {}): ExecutionOrder => ({
  corpCode: 'C1',
  stockCode: '005930',
  side: 'BUY',
  orderedShares: 100,
  referencePrice: 70_000,
  dayVolume: 1_000_000,
  ...over,
});

describe('PaperExecutionAdapter', () => {
  const adapter = new PaperExecutionAdapter();

  it('adapterName = paper-sim (M12 KIS 치환 추적 라벨)', () => {
    expect(adapter.adapterName).toBe('paper-sim');
  });

  it('fill-simulator 위임: submitAndConfirm 결과가 simulateFill 과 동일(결정론적)', async () => {
    const o = order();
    const outcome = await adapter.submitAndConfirm(o, DEFAULT_FILL_PARAMS);
    const direct = simulateFill(
      {
        direction: o.side,
        orderedShares: o.orderedShares,
        entryPrice: o.referencePrice,
        dayVolume: o.dayVolume,
      },
      DEFAULT_FILL_PARAMS,
    );
    expect(outcome.filledShares).toBe(direct.filledShares);
    expect(outcome.filledPrice).toBe(direct.filledPrice);
    expect(outcome.commission).toBe(direct.commission);
    expect(outcome.tax).toBe(direct.tax);
    expect(outcome.slippageCost).toBe(direct.slippageCost);
    expect(outcome.status).toBe(direct.status);
  });

  it('동일 입력 반복 호출은 동일 결과(순수·부수효과 0)', async () => {
    const a = await adapter.submitAndConfirm(order());
    const b = await adapter.submitAndConfirm(order());
    expect(a).toEqual(b);
  });

  it('BUY 체결가 ≥ 기준가(슬리피지 불리 방향)', async () => {
    const outcome = await adapter.submitAndConfirm(order({ referencePrice: 10_000 }));
    expect(outcome.filledPrice).toBeGreaterThanOrEqual(10_000);
    expect(outcome.filledShares).toBeGreaterThan(0);
  });
});
