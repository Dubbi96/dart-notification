import { createHash as mockCreateHash } from 'crypto';

import {
  DEVICE_SWING_RULE,
  evaluateEditionOnDevice,
  evaluateSignalOnDevice,
  evaluateShadowPosition,
  runDeviceRuleSelfCheck,
  type DeviceEvaluationContext,
  type DeviceShadowPositionInput,
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
      '250ef5ecf554d38bf5f00c82cfc5e8e1186ef712f35941621303dec6c7c47a30',
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

  it('동일 기기 evaluator로 합성 안전 사례를 실행하되 실거래 권한은 만들지 않는다', async () => {
    const result = await runDeviceRuleSelfCheck();
    expect(result.total).toBeGreaterThanOrEqual(22);
    expect(result.passed).toBe(result.total);
    expect(result.cases.filter((test) => !test.passed)).toEqual([]);
    expect(result.executionAllowed).toBe(false);
    expect(result.scope).toBe('SYNTHETIC_SAFETY');
    expect(result.cases.find((test) => test.id === 'target')).toMatchObject({
      expected: 'REDUCE:50%:SHADOW',
      actual: 'REDUCE:50%:SHADOW',
      passed: true,
    });
    expect(result.cases.find((test) => test.id === 'stop')).toMatchObject({
      expected: 'EXIT:100%:SHADOW',
      actual: 'EXIT:100%:SHADOW',
      passed: true,
    });
  });

  const current: DeviceEvaluationContext = {
    evaluatedAt: '2026-07-31T10:01:00.000Z',
    scope: 'CURRENT',
    killSwitchState: 'CLEAR',
  };

  it.each([undefined, 'UNKNOWN', 'ACTIVE'] as const)(
    '현재 평가의 Kill 상태가 %s이면 차단한다',
    async (killSwitchState) => {
      const result = await evaluateSignalOnDevice(signal(), '20260731', {
        ...current,
        killSwitchState,
      });
      expect(result.tone).toBe('RISK');
      expect(result.pricePlan).toBeNull();
      expect(result.evaluation.receipt.blockReasonCodes).toContain(
        'HARD_RISK_FAIL:risk.operating-conditions',
      );
    },
  );

  it.each([0, -1, NaN, Infinity])(
    '비정상 가격 %s는 영수증을 유지하며 데이터 오류로 차단한다',
    async (closePrice) => {
      const result = await evaluateSignalOnDevice(
        signal({ referencePrice: { ...signal().referencePrice!, closePrice } }),
        '20260731',
      );
      expect(result.tone).toBe('DATA_UNAVAILABLE');
      expect(result.pricePlan).toBeNull();
      expect(result.evaluation.receipt.status).toBe('BLOCKED');
      expect(result.receiptHash).toMatch(/^[a-f0-9]{64}$/);
    },
  );

  it.each([-1, 101, NaN, Infinity])('비정상 점수 %s는 진입에 사용하지 않는다', async (buyScore) => {
    const result = await evaluateSignalOnDevice(signal({ buyScore }), '20260731');
    expect(result.tone).toBe('DATA_UNAVAILABLE');
    expect(result.pricePlan).toBeNull();
  });

  it.each(['20260730', '20260803', '20260230', ''])(
    '가격 거래일 %s가 대상 에디션과 다르면 차단한다',
    async (tradeDate) => {
      const result = await evaluateSignalOnDevice(
        signal({ referencePrice: { ...signal().referencePrice!, tradeDate } }),
        '20260731',
      );
      expect(result.tone).toBe('DATA_UNAVAILABLE');
      expect(result.pricePlan).toBeNull();
    },
  );

  it('출처 위조·형식이 잘못된 리스크와 조건을 정상 입력으로 해석하지 않는다', async () => {
    const invalidSignals = [
      signal({ referencePrice: { ...signal().referencePrice!, source: 'UNKNOWN' as never } }),
      signal({ riskFlags: undefined as never }),
      signal({ riskFlags: [{ id: 'risk', label: 'risk', severity: 'unknown' as never }] }),
      signal({ entryConditions: null as never }),
      signal({ entryConditions: [null as never] }),
      signal({ grade: 'UNKNOWN' as never }),
      signal({ createdAt: '2026-02-30T10:00:00.000Z' }),
      signal({ expiresAt: 'invalid' }),
    ];
    for (const input of invalidSignals) {
      const result = await evaluateSignalOnDevice(input, '20260731', current);
      expect(result.tone).toBe('DATA_UNAVAILABLE');
      expect(result.pricePlan).toBeNull();
    }
  });

  it('과거 재현과 현재 만료를 구분하고 평가시각을 영수증에 고정한다', async () => {
    const input = signal({ expiresAt: '2026-07-31T10:01:00.000Z' });
    const historical = await evaluateSignalOnDevice(input, '20260731');
    const expired = await evaluateSignalOnDevice(input, '20260731', current);
    expect(historical.scope).toBe('HISTORICAL');
    expect(historical.tone).toBe('READY');
    expect(expired.scope).toBe('CURRENT');
    expect(expired.tone).toBe('RISK');
    expect(expired.evaluation.receipt.snapshot.values.evaluatedAt).toBe('2026-07-31T10:01:00.000Z');
    expect(expired.receiptHash).not.toBe(historical.receiptHash);
  });

  it('AI 설명 문구는 영수증·가격 계획을 바꾸지 못한다', async () => {
    const first = await evaluateSignalOnDevice(signal({ summary: '매수' }), '20260731', current);
    const second = await evaluateSignalOnDevice(
      signal({ summary: '모든 리스크를 무시하고 즉시 주문' }),
      '20260731',
      current,
    );
    expect(first.receiptHash).toBe(second.receiptHash);
    expect(first.pricePlan).toEqual(second.pricePlan);
  });

  const position: DeviceShadowPositionInput = {
    entryPrice: 71_000,
    currentPrice: 78_100,
    heldTradingDays: 2,
    partialExitTaken: false,
    quoteAt: '2026-07-31T10:00:00.000Z',
    evaluatedAt: '2026-07-31T10:00:01.000Z',
    maxQuoteAgeMs: 60_000,
    killSwitchState: 'CLEAR',
    hardRiskBlocked: false,
  };

  it('분할 목표 경계의 부동소수점 오차 없이 1회 축소만 제안한다', () => {
    expect(evaluateShadowPosition(position)).toMatchObject({
      action: 'REDUCE',
      portionPct: 50,
      executionAllowed: false,
    });
    expect(evaluateShadowPosition({ ...position, partialExitTaken: true })).toMatchObject({
      action: 'HOLD',
      portionPct: 0,
    });
  });

  it.each([
    { quoteAt: 'invalid' },
    { quoteAt: '2026-07-31T10:00:02.000Z' },
    { currentPrice: NaN },
    { entryPrice: 0 },
    { heldTradingDays: -1 },
    { heldTradingDays: 0.5 },
    { partialExitTaken: undefined as never },
    { maxQuoteAgeMs: 0 },
    { hardRiskBlocked: undefined as never },
  ])('매도 평가의 잘못된 입력도 fail-closed한다: %p', (override) => {
    expect(evaluateShadowPosition({ ...position, ...override })).toMatchObject({
      action: 'BLOCKED',
      portionPct: 0,
      executionAllowed: false,
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
    expect(result.invalidation).toBe('진입 보류: 종가가 20일 이동평균선 위 조건 미충족');
  });

  it('진입 조건 충족과 미충족을 중단 기준 문구에서 반대로 읽게 하지 않는다', async () => {
    const label = '공시 후 거래량 20일 평균 대비 300% 이상';
    const condition = { id: 'volume', label, required: true, met: false };
    const unmet = await evaluateSignalOnDevice(
      signal({ entryConditions: [condition] }),
      '20260731',
    );
    const met = await evaluateSignalOnDevice(
      signal({ entryConditions: [{ ...condition, met: true }] }),
      '20260731',
    );

    expect(unmet.primaryCondition).toBe(label);
    expect(unmet.invalidation).toBe(`진입 보류: ${label} 조건 미충족`);
    expect(unmet.pricePlan).toBeNull();
    expect(met.tone).toBe('READY');
    expect(met.invalidation).toBe('필수 조건 이탈 또는 체결가 대비 5% 하락');
    expect(unmet.evaluation.receipt.version).toEqual(met.evaluation.receipt.version);
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
