import {
  DEVICE_SWING_RULE,
  evaluateEditionOnDevice,
  evaluateSignalOnDevice,
} from '@utils/deviceRuleDecision';

import type { TradingSignal } from '@app-types/signal.types';

jest.mock('expo-crypto', () => {
  return {
    CryptoDigestAlgorithm: { SHA256: 'SHA-256' },
    digestStringAsync: async (_algorithm: string, value: string) =>
      mockCreateHash('sha256').update(value).digest('hex'),
  };
});

function signal(overrides: Partial<TradingSignal> = {}): TradingSignal {
  return {
    id: 'signal-1',
    corpCode: '00126380',
    corpName: '삼성전자',
    ticker: '005930',
    eventType: 'SUPPLY_CONTRACT',
    grade: 'BUY',
    buyScore: 72,
    summary: '공급계약과 가격 흐름을 함께 확인한 신호입니다.',
    entryConditions: [
      { id: 'ma20', label: '종가가 20일 이동평균선 위', required: true, met: true },
      { id: 'rsi', label: 'RSI 과열 아님', required: true, met: true },
    ],
    riskFlags: [],
    referencePrice: {
      tradeDate: '20260731',
      closePrice: 71_000,
      highPrice: 72_000,
      lowPrice: 70_000,
      source: 'STOCK_DAILY_PRICE',
    },
    createdAt: '2026-07-31T10:00:00.000Z',
    ...overrides,
  };
}

describe('deviceRuleDecision', () => {
  it('조건·리스크·가격이 준비되면 기기에서 숫자 Shadow 플랜을 계산한다', async () => {
    const result = await evaluateSignalOnDevice(signal(), '20260731');

    expect(result.tone).toBe('READY');
    expect(result.evaluation.receipt.status).toBe('COMPLETED');
    expect(result.evaluation.receipt.score).toBe(72);
    expect(result.receiptHash).toBe(
      'f813e900e799e5a4e3431d0233a818c5373fe7166181ad09cfababfb592add69',
    );
    expect(result.pricePlan).toMatchObject({
      entryLow: 69_600,
      entryHigh: 71_000,
      stopPrice: 67_500,
      takeProfitPrice: 78_100,
      takeProfitPct: 10,
      stopLossPct: -5,
      partialExitPct: 50,
      maxHoldDays: 5,
    });
  });

  it('가격이 없으면 Hard Risk 누락으로 차단하고 숫자를 만들지 않는다', async () => {
    const result = await evaluateSignalOnDevice(signal({ referencePrice: null }), '20260731');

    expect(result.tone).toBe('DATA_UNAVAILABLE');
    expect(result.evaluation.receipt.status).toBe('BLOCKED');
    expect(result.pricePlan).toBeNull();
    expect(result.evaluation.receipt.blockReasonCodes).toContain(
      'HARD_RISK_MISSING_FEATURE:risk.reference-price',
    );
  });

  it('리스크 플래그가 하나라도 있으면 보수적으로 계획을 차단한다', async () => {
    const result = await evaluateSignalOnDevice(
      signal({ riskFlags: [{ id: 'surge', label: '선행급등', severity: 'medium' }] }),
      '20260731',
    );

    expect(result.tone).toBe('RISK');
    expect(result.evaluation.receipt.status).toBe('BLOCKED');
    expect(result.pricePlan).toBeNull();
    expect(result.invalidation).toBe('선행급등');
  });

  it('필수 진입 조건이 미충족이면 점수는 보존하되 진입 계획을 만들지 않는다', async () => {
    const result = await evaluateSignalOnDevice(
      signal({
        entryConditions: [
          { id: 'ma20', label: '종가가 20일 이동평균선 위', required: true, met: false },
        ],
      }),
      '20260731',
    );

    expect(result.tone).toBe('CHECK');
    expect(result.evaluation.receipt.status).toBe('COMPLETED');
    expect(result.pricePlan).toBeNull();
    expect(result.primaryCondition).toBe('종가가 20일 이동평균선 위');
  });

  it('같은 입력은 receipt와 에디션 종합 의견이 결정적으로 같다', async () => {
    const first = await evaluateEditionOnDevice([signal()], '20260731');
    const second = await evaluateEditionOnDevice([signal()], '20260731');

    expect(first.decisions[0].receiptHash).toBe(second.decisions[0].receiptHash);
    expect(first.headline).toBe('1개는 가격·조건을 함께 확인할 단계예요');
    expect(DEVICE_SWING_RULE).toMatchObject({
      takeProfitPct: 10,
      stopLossPct: -5,
      maxHoldDays: 5,
    });
  });
});
import { createHash as mockCreateHash } from 'crypto';
