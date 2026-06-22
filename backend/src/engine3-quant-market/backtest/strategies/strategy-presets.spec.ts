import {
  STRATEGY_PRESETS,
  STRATEGY_KEYS,
  STRATEGY_INITIAL_CAPITAL,
  findPreset,
  summarizeRules,
} from './strategy-presets';

/**
 * DAR-404 — 전략 변형 프리셋 상수 검증.
 * 프리셋은 추후 calibration 으로 조정되므로 '값 고정'이 아니라 '불변식(구조·일관성)'을 검증한다.
 */
describe('STRATEGY_PRESETS (DAR-404)', () => {
  it('4종 전략이 정확히 정의되고 키가 유일하다', () => {
    expect(STRATEGY_PRESETS).toHaveLength(4);
    const keys = STRATEGY_PRESETS.map((p) => p.key);
    expect(new Set(keys).size).toBe(4);
    expect(keys).toEqual([
      'event-edge',
      'short-momentum',
      'conservative-value',
      'aggressive-diversified',
    ]);
    expect(STRATEGY_KEYS).toEqual(keys);
  });

  it('모든 프리셋이 완전한 StrategyParams 불변식을 만족한다', () => {
    for (const preset of STRATEGY_PRESETS) {
      expect(preset.label.length).toBeGreaterThan(0);
      expect(preset.description.length).toBeGreaterThan(0);
      const p = preset.params;
      expect(p.entryRule).toBe('NEXT_OPEN'); // lookahead 방지 — 다음 거래일 시가 진입 고정
      expect(p.initialCapital).toBe(STRATEGY_INITIAL_CAPITAL);
      expect(p.maxPositions).toBeGreaterThan(0);
      expect(p.minBuyScore).toBeGreaterThanOrEqual(0);
      expect(['EQUAL_WEIGHT', 'SCORE_WEIGHT']).toContain(p.sizeRule);
      // 손절은 음수, 익절은 양수, 최대보유는 양수.
      expect(p.exitRules.stopLossPct).toBeLessThan(0);
      expect(p.exitRules.takeProfitPct).toBeGreaterThan(0);
      expect(p.exitRules.maxHoldDays).toBeGreaterThan(0);
    }
  });

  it('각 프리셋의 핵심 파라미터가 이슈 설계와 일치한다', () => {
    const byKey = Object.fromEntries(STRATEGY_PRESETS.map((p) => [p.key, p.params]));

    // event-edge: robust 게이트로 eventTypes 동적 선별(정적 하드코딩 없음) · 점수가중 · 익절20/손절-10 · 20일
    // DAR-413: 임계 ≥35(상위 ~4%).
    expect(byKey['event-edge'].eventTypes).toBeUndefined();
    expect(findPreset('event-edge')!.robustEventGate).toBe(true);
    expect(byKey['event-edge'].minBuyScore).toBe(35);
    expect(byKey['event-edge'].sizeRule).toBe('SCORE_WEIGHT');
    expect(byKey['event-edge'].exitRules).toMatchObject({ takeProfitPct: 20, stopLossPct: -10, maxHoldDays: 20 });

    // short-momentum: ≥40(DAR-413, 상위 ~3%) · 익절10/손절-5 · 5일 · 균등
    expect(byKey['short-momentum'].minBuyScore).toBe(40);
    expect(byKey['short-momentum'].exitRules).toMatchObject({ takeProfitPct: 10, stopLossPct: -5, maxHoldDays: 5 });
    expect(byKey['short-momentum'].sizeRule).toBe('EQUAL_WEIGHT');

    // conservative-value: ≥50(DAR-413, 상위 ~0.6% 최고 확신) · 손절-10 · 20일 · 최대10 · 점수가중
    expect(byKey['conservative-value'].minBuyScore).toBe(50);
    expect(byKey['conservative-value'].exitRules.stopLossPct).toBe(-10);
    expect(byKey['conservative-value'].maxPositions).toBe(10);
    expect(byKey['conservative-value'].sizeRule).toBe('SCORE_WEIGHT');

    // aggressive-diversified: ≥30(DAR-413, 상위 ~6.6% 하한) · 손절-8 · 최대50 · 균등
    expect(byKey['aggressive-diversified'].minBuyScore).toBe(30);
    expect(byKey['aggressive-diversified'].exitRules.stopLossPct).toBe(-8);
    expect(byKey['aggressive-diversified'].maxPositions).toBe(50);
    expect(byKey['aggressive-diversified'].sizeRule).toBe('EQUAL_WEIGHT');
  });

  it('DAR-413: 임계값이 분포 기반 상대 엄격도 사다리(보수 > 단기 > 엣지 > 공격)를 만족한다', () => {
    const byKey = Object.fromEntries(STRATEGY_PRESETS.map((p) => [p.key, p.params]));
    // 상대적 엄격도(percentile rank) = 전략 정체성. 보수가치가 가장 엄격, 공격분산이 가장 넓다.
    expect(byKey['conservative-value'].minBuyScore).toBeGreaterThan(byKey['short-momentum'].minBuyScore);
    expect(byKey['short-momentum'].minBuyScore).toBeGreaterThan(byKey['event-edge'].minBuyScore);
    expect(byKey['event-edge'].minBuyScore).toBeGreaterThan(byKey['aggressive-diversified'].minBuyScore);
    // '아무거나 매수' 방지 하한 — 분포 상위 ~6.6%(≥30)보다 낮은 임계는 없다.
    for (const p of STRATEGY_PRESETS) {
      expect(p.params.minBuyScore).toBeGreaterThanOrEqual(30);
    }
    // 과거 비활성 임계(상위 0.01%, 연 1거래)였던 70 을 더 이상 쓰지 않는다.
    for (const p of STRATEGY_PRESETS) {
      expect(p.params.minBuyScore).toBeLessThan(70);
    }
  });

  it('findPreset 는 유효 키만 찾는다', () => {
    expect(findPreset('event-edge')?.label).toBe('이벤트엣지');
    expect(findPreset('nope')).toBeUndefined();
  });

  it('summarizeRules 가 핵심 룰을 한국어로 요약한다', () => {
    const summary = summarizeRules(findPreset('event-edge')!.params);
    expect(summary).toContain('점수 ≥35');
    expect(summary).toContain('익절 +20%');
    expect(summary).toContain('손절 -10%');
    expect(summary).toContain('점수가중배분');
  });

  it('robustEventGate 옵션이면 동적 선별 라벨을 표기한다(DAR-408)', () => {
    const summary = summarizeRules(findPreset('event-edge')!.params, { robustEventGate: true });
    expect(summary).toContain('robust 양-edge 이벤트 동적 선별');
    // event-edge 만 게이트, 나머지 3전략은 무변경
    expect(findPreset('short-momentum')!.robustEventGate).toBeUndefined();
    expect(findPreset('conservative-value')!.robustEventGate).toBeUndefined();
    expect(findPreset('aggressive-diversified')!.robustEventGate).toBeUndefined();
  });
});
