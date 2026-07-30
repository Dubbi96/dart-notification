import { readFileSync } from 'fs';
import { join } from 'path';

import {
  buildEditionDecision,
  buildEditionSignalPlan,
  isEntryReadyForEdition,
  SHORT_MOMENTUM_RULE,
} from '@utils/editionDecision';

import type { TradingSignal } from '@app-types/signal.types';

function signal(overrides: Partial<TradingSignal> = {}): TradingSignal {
  return {
    id: 'signal-1',
    corpCode: '00126380',
    corpName: '삼성전자',
    ticker: '005930',
    eventType: 'SUPPLY_CONTRACT',
    grade: 'BUY',
    buyScore: 48,
    summary: '대규모 공급계약과 거래량 흐름을 함께 확인한 신호입니다.',
    entryConditions: [
      { id: 'ma20', label: '현재가가 20일 이동평균선 위', required: true, met: true },
      { id: 'rsi', label: 'RSI 70 미만', required: true, met: true },
    ],
    riskFlags: [],
    createdAt: '2026-07-30T10:00:00.000Z',
    ...overrides,
  };
}

describe('editionDecision', () => {
  it('필수 조건이 존재하고 모두 충족돼야 조건 준비로 판정한다', () => {
    expect(isEntryReadyForEdition(signal())).toBe(true);
    expect(isEntryReadyForEdition(signal({ entryConditions: [] }))).toBe(false);
    expect(
      isEntryReadyForEdition(
        signal({
          entryConditions: [{ id: 'rsi', label: 'RSI 70 미만', required: true, met: false }],
        }),
      ),
    ).toBe(false);
  });

  it('조건 충족·리스크 없음이면 조건부 진입 검토와 단기 룰을 만든다', () => {
    const plan = buildEditionSignalPlan(signal());
    expect(plan.tone).toBe('ready');
    expect(plan.verdict).toBe('조건부 진입 검토');
    expect(plan.entryGuide).toContain('다음 진입 가능 거래일 시가');
    expect(plan.invalidationGuide).toContain('조건이 하나라도 깨지면');
    expect(plan.hasShortMomentumScenario).toBe(true);
    expect(SHORT_MOMENTUM_RULE).toEqual({
      minBuyScore: 40,
      takeProfitPct: 10,
      stopLossPct: -5,
      maxHoldDays: 5,
    });
  });

  it('미충족 조건이 있으면 조건 확인을 우선하고 단기 시나리오는 숨긴다', () => {
    const plan = buildEditionSignalPlan(
      signal({
        entryConditions: [
          { id: 'ma20', label: '현재가가 20일 이동평균선 위', required: true, met: false },
        ],
      }),
    );
    expect(plan.tone).toBe('check');
    expect(plan.verdict).toBe('조건 확인 전 대기');
    expect(plan.entryGuide).toBe('현재가가 20일 이동평균선 위');
    expect(plan.invalidationGuide).toBe('위 조건이 충족되지 않으면 진입 보류');
    expect(plan.hasShortMomentumScenario).toBe(false);
  });

  it('리스크가 있으면 충족 조건보다 리스크 확인을 우선하고 단기 시나리오는 숨긴다', () => {
    const plan = buildEditionSignalPlan(
      signal({
        riskFlags: [{ id: 'risk-1', label: '선행급등', severity: 'medium' }],
      }),
    );
    expect(plan.tone).toBe('risk');
    expect(plan.verdict).toBe('리스크 확인 전 대기');
    expect(plan.entryGuide).toBe('선행급등');
    expect(plan.invalidationGuide).toBe('선행급등');
    expect(plan.hasShortMomentumScenario).toBe(false);
  });

  it('에디션 전체를 준비·확인·리스크 수와 우선순위로 요약한다', () => {
    const waiting = signal({
      id: 'signal-2',
      corpName: 'SK하이닉스',
      entryConditions: [{ id: 'rsi', label: 'RSI 70 미만', required: true, met: false }],
    });
    const risky = signal({
      id: 'signal-3',
      corpName: '한미반도체',
      riskFlags: [{ id: 'risk', label: '선행급등', severity: 'medium' }],
    });

    const decision = buildEditionDecision([signal(), waiting, risky]);
    expect(decision.headline).toBe('1개만 조건부 진입 검토');
    expect(decision.readyCount).toBe(1);
    expect(decision.checkCount).toBe(2);
    expect(decision.riskCount).toBe(1);
    expect(decision.topPriority).toBe('1순위 삼성전자 · 조건부 진입 검토');
  });

  it('과거 에디션은 종합 의견의 시점을 당시로 명시한다', () => {
    expect(buildEditionDecision([signal()], true).eyebrow).toBe('당시의 종합 의견');
  });

  it('종합 의견의 우선순위는 점수 1위가 대기면 첫 조건 준비 종목을 가리킨다', () => {
    const waiting = signal({
      corpName: '점수상위대기',
      entryConditions: [{ id: 'rsi', label: 'RSI 70 미만', required: true, met: false }],
    });
    const ready = signal({ id: 'signal-2', corpName: '조건준비' });
    expect(buildEditionDecision([waiting, ready]).topPriority).toBe(
      '2순위 조건준비 · 조건부 진입 검토',
    );
  });

  it('단기 참고 시나리오는 백엔드 short-momentum 정본과 동기화된다', () => {
    const presetSource = readFileSync(
      join(
        __dirname,
        '../../../backend/src/engine3-quant-market/backtest/strategies/strategy-presets.ts',
      ),
      'utf8',
    );
    const start = presetSource.indexOf("key: 'short-momentum'");
    const end = presetSource.indexOf("key: 'conservative-value'", start);
    const block = presetSource.slice(start, end);

    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);
    expect(block).toContain(`minBuyScore: ${SHORT_MOMENTUM_RULE.minBuyScore}`);
    expect(block).toContain(`takeProfitPct: ${SHORT_MOMENTUM_RULE.takeProfitPct}`);
    expect(block).toContain(`stopLossPct: ${SHORT_MOMENTUM_RULE.stopLossPct}`);
    expect(block).toContain(`maxHoldDays: ${SHORT_MOMENTUM_RULE.maxHoldDays}`);
    expect(block).toContain("entryRule: 'NEXT_OPEN'");
  });
});
