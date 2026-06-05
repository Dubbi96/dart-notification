/**
 * position-thesis.spec.ts — M7 Position Thesis 엔진 Fixture 테스트 (DAR-11)
 *
 * 실제 DB/AI 없이 순수 Rule 함수·도메인 로직만 검증.
 * AI 금지영역: 이 테스트는 AI 개입 없는 Rule 로직만 다룬다.
 */

import { PositionThesisService } from './services/position-thesis.service';
import { InMemoryPositionThesisRepository } from './repositories/in-memory-position-thesis.repository';
import { validateInvalidConditions, isValidInvalidConditionType } from './domain/invalid-condition.types';
import { canTransition, MAX_WEIGHT_HARD_LIMIT } from './domain/position-thesis.types';
import type { InvalidCondition } from './domain/invalid-condition.types';
import type { TradingSignalInput } from './services/position-thesis.service';

// ─── Fixture helpers ─────────────────────────────────────────────────

function makeBuySignal(overrides: Partial<TradingSignalInput> = {}): TradingSignalInput {
  return {
    id: 'sig-001',
    rcpNo: 'RCP20260101000001',
    corpCode: '00126380',
    signal: 'BUY_CANDIDATE',
    entryConditionMet: ['현재가 > MA20', 'RSI < 70', '거래량비율 > 2'],
    riskFactors: [],
    signalSummary: '대규모 공급계약 공시, 매출 대비 24%',
    ...overrides,
  };
}

function makeValidInvalidConditions(): InvalidCondition[] {
  return [
    { type: 'AMENDMENT_NEGATIVE' },
    { type: 'PRICE_BELOW', value: 45000 },
    { type: 'STOP_LOSS_PCT', value: 8 },
    { type: 'VOLUME_COLLAPSE', threshold: 0.3 },
    { type: 'THESIS_METRIC_BREACH', metric: 'rsi14', threshold: 80 },
    { type: 'EVENT_STUDY_UNDERPERFORM', horizon: 'D5', threshold: 0 },
    { type: 'MAX_HOLD_DAYS', value: 20 },
  ];
}

// ─── 서비스 인스턴스 팩토리 ──────────────────────────────────────────

function makeService() {
  const repo = new InMemoryPositionThesisRepository();
  const service = new PositionThesisService(repo);
  return { service, repo };
}

// ─── 1. 신호 → Thesis 자동생성 1:1 ────────────────────────────────────

describe('PositionThesisService.createFromSignal', () => {
  it('BUY_CANDIDATE 신호에서 Thesis 1건 생성', async () => {
    const { service } = makeService();
    const signal = makeBuySignal();
    const thesis = await service.createFromSignal(signal);

    expect(thesis.tradingSignalId).toBe(signal.id);
    expect(thesis.rcpNo).toBe(signal.rcpNo);
    expect(thesis.corpCode).toBe(signal.corpCode);
    expect(thesis.status).toBe('ACTIVE');
  });

  it('STRONG_BUY_CANDIDATE 신호에서 Thesis 생성', async () => {
    const { service } = makeService();
    const signal = makeBuySignal({ signal: 'STRONG_BUY_CANDIDATE' });
    const thesis = await service.createFromSignal(signal);
    expect(thesis.status).toBe('ACTIVE');
  });

  it('같은 신호 ID로 두 번 호출 시 동일 Thesis 반환(중복 생성 방지)', async () => {
    const { service } = makeService();
    const signal = makeBuySignal();
    const first = await service.createFromSignal(signal);
    const second = await service.createFromSignal(signal);
    expect(first.id).toBe(second.id);
  });

  it('BUY 등급이 아닌 신호(WATCH)는 예외 발생', async () => {
    const { service } = makeService();
    const signal = makeBuySignal({ signal: 'WATCH' });
    await expect(service.createFromSignal(signal)).rejects.toThrow(
      'createFromSignal: signal must be BUY grade',
    );
  });

  it('AVOID 신호는 예외 발생', async () => {
    const { service } = makeService();
    const signal = makeBuySignal({ signal: 'AVOID' });
    await expect(service.createFromSignal(signal)).rejects.toThrow();
  });

  it('생성된 Thesis는 initialThesis 배열을 갖는다', async () => {
    const { service } = makeService();
    const thesis = await service.createFromSignal(makeBuySignal());
    expect(Array.isArray(thesis.initialThesis)).toBe(true);
    expect(thesis.initialThesis.length).toBeGreaterThan(0);
  });

  it('생성된 Thesis의 invalidConditions는 모두 기계 평가 가능 타입', async () => {
    const { service } = makeService();
    const thesis = await service.createFromSignal(makeBuySignal());
    expect(validateInvalidConditions(thesis.invalidConditions)).toBe(true);
  });

  it('maxWeight는 DEFAULT_MAX_WEIGHT(5.0)로 초기화', async () => {
    const { service } = makeService();
    const thesis = await service.createFromSignal(makeBuySignal());
    expect(thesis.maxWeight).toBeLessThanOrEqual(5.0);
  });

  it('maxWeight는 하드 상한(10%)을 초과할 수 없다', async () => {
    const { service } = makeService();
    const thesis = await service.createFromSignal(makeBuySignal(), { maxWeight: 999 });
    expect(thesis.maxWeight).toBeLessThanOrEqual(MAX_WEIGHT_HARD_LIMIT);
  });
});

// ─── 2. invalidConditions 기계 평가 가능성 ────────────────────────────

describe('InvalidCondition 타입 검증', () => {
  it('허용된 모든 타입은 isValidInvalidConditionType() = true', () => {
    const validTypes = [
      'PRICE_BELOW', 'PRICE_ABOVE', 'AMENDMENT_NEGATIVE',
      'THESIS_METRIC_BREACH', 'VOLUME_COLLAPSE', 'EVENT_STUDY_UNDERPERFORM',
      'STOP_LOSS_PCT', 'MAX_HOLD_DAYS',
    ];
    validTypes.forEach((t) => {
      expect(isValidInvalidConditionType(t)).toBe(true);
    });
  });

  it('추상 자연어 타입(ABSTRACT_TEXT)은 거부', () => {
    expect(isValidInvalidConditionType('ABSTRACT_TEXT')).toBe(false);
    expect(isValidInvalidConditionType('시장이 나빠질 때')).toBe(false);
    expect(isValidInvalidConditionType('')).toBe(false);
  });

  it('유효한 invalidConditions 배열은 validateInvalidConditions() = true', () => {
    expect(validateInvalidConditions(makeValidInvalidConditions())).toBe(true);
  });

  it('추상 자연어 포함 배열은 validateInvalidConditions() = false', () => {
    const invalid = [{ type: '주가가 많이 떨어지면', text: '자연어' }];
    expect(validateInvalidConditions(invalid)).toBe(false);
  });

  it('빈 배열은 validateInvalidConditions() = false', () => {
    expect(validateInvalidConditions([])).toBe(false);
  });

  it('null 포함 배열은 validateInvalidConditions() = false', () => {
    expect(validateInvalidConditions([null])).toBe(false);
  });

  it('PRICE_BELOW 조건은 value 필드와 함께 유효', async () => {
    const { service } = makeService();
    const conditions: InvalidCondition[] = [
      { type: 'PRICE_BELOW', value: 50000 },
    ];
    const thesis = await service.create({
      tradingSignalId: 'sig-x',
      rcpNo: 'RCP001',
      corpCode: 'CORP001',
      entryReason: '진입 사유',
      initialThesis: ['근거1'],
      invalidConditions: conditions,
    });
    expect(thesis.invalidConditions[0]).toMatchObject({ type: 'PRICE_BELOW', value: 50000 });
  });

  it('추상 자연어 invalidConditions로 create() 시 예외 발생', async () => {
    const { service } = makeService();
    await expect(
      service.create({
        tradingSignalId: 'sig-abstract',
        rcpNo: 'RCP001',
        corpCode: 'CORP001',
        entryReason: '진입 사유',
        initialThesis: ['근거1'],
        invalidConditions: [{ type: '추상적_조건' } as unknown as InvalidCondition],
      }),
    ).rejects.toThrow('machine-evaluable');
  });
});

// ─── 3. 생명주기 전이 ──────────────────────────────────────────────────

describe('ThesisStatus 생명주기 전이', () => {
  it('ACTIVE → INVALIDATED 전이 허용', () => {
    expect(canTransition('ACTIVE', 'INVALIDATED')).toBe(true);
  });

  it('ACTIVE → CLOSED 전이 허용', () => {
    expect(canTransition('ACTIVE', 'CLOSED')).toBe(true);
  });

  it('INVALIDATED → CLOSED 전이 허용', () => {
    expect(canTransition('INVALIDATED', 'CLOSED')).toBe(true);
  });

  it('INVALIDATED → ACTIVE 역방향 전이 금지', () => {
    expect(canTransition('INVALIDATED', 'ACTIVE')).toBe(false);
  });

  it('CLOSED → ACTIVE 역방향 전이 금지', () => {
    expect(canTransition('CLOSED', 'ACTIVE')).toBe(false);
  });

  it('CLOSED → INVALIDATED 역방향 전이 금지', () => {
    expect(canTransition('CLOSED', 'INVALIDATED')).toBe(false);
  });

  it('service.invalidate() — ACTIVE → INVALIDATED 상태 변경', async () => {
    const { service } = makeService();
    const thesis = await service.createFromSignal(makeBuySignal());
    const invalidated = await service.invalidate(thesis.id);
    expect(invalidated.status).toBe('INVALIDATED');
  });

  it('service.close() — ACTIVE → CLOSED 상태 변경', async () => {
    const { service } = makeService();
    const thesis = await service.createFromSignal(makeBuySignal());
    const closed = await service.close(thesis.id);
    expect(closed.status).toBe('CLOSED');
  });

  it('service.close() — INVALIDATED → CLOSED 상태 변경', async () => {
    const { service } = makeService();
    const thesis = await service.createFromSignal(makeBuySignal());
    await service.invalidate(thesis.id);
    const closed = await service.close(thesis.id);
    expect(closed.status).toBe('CLOSED');
  });

  it('INVALIDATED 상태에서 invalidate() 재호출 시 예외 발생', async () => {
    const { service } = makeService();
    const thesis = await service.createFromSignal(makeBuySignal());
    await service.invalidate(thesis.id);
    await expect(service.invalidate(thesis.id)).rejects.toThrow(
      'Cannot transition from INVALIDATED to INVALIDATED',
    );
  });

  it('CLOSED 상태에서 invalidate() 호출 시 예외 발생', async () => {
    const { service } = makeService();
    const thesis = await service.createFromSignal(makeBuySignal());
    await service.close(thesis.id);
    await expect(service.invalidate(thesis.id)).rejects.toThrow(
      'Cannot transition from CLOSED to INVALIDATED',
    );
  });
});

// ─── 4. 리포지토리 조회 ────────────────────────────────────────────────

describe('InMemoryPositionThesisRepository 조회', () => {
  it('findBySignalId 로 Thesis 조회', async () => {
    const { service } = makeService();
    const signal = makeBuySignal();
    await service.createFromSignal(signal);
    const found = await service.findBySignalId(signal.id);
    expect(found).not.toBeNull();
    expect(found!.tradingSignalId).toBe(signal.id);
  });

  it('findByStatus — ACTIVE 상태 필터', async () => {
    const { service } = makeService();
    await service.createFromSignal(makeBuySignal({ id: 'sig-a' }));
    await service.createFromSignal(makeBuySignal({ id: 'sig-b' }));

    const activeList = await service.findByStatus('ACTIVE');
    expect(activeList.length).toBeGreaterThanOrEqual(2);
    activeList.forEach((t) => expect(t.status).toBe('ACTIVE'));
  });

  it('findByStatus — INVALIDATED 상태 필터', async () => {
    const { service } = makeService();
    const t = await service.createFromSignal(makeBuySignal({ id: 'sig-c' }));
    await service.invalidate(t.id);

    const invalidatedList = await service.findByStatus('INVALIDATED');
    expect(invalidatedList.some((x) => x.id === t.id)).toBe(true);
  });

  it('존재하지 않는 ID는 findBySignalId null 반환', async () => {
    const { service } = makeService();
    expect(await service.findBySignalId('nonexistent')).toBeNull();
  });
});
