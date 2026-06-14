import { estimateCostUsd, isPricedModel, resolveModelPrice } from './estimate-cost';

/**
 * DAR-244: 모델 단가표 미매칭 시 estimateCostUsd가 DEFAULT_PRICE로 조용히 폴백한다.
 * 이 동작 자체는 유지하되, 폴백 여부(matched)를 호출부가 감지·경보할 수 있어야 한다.
 */
describe('[DAR-244] estimate-cost 모델 단가 해석', () => {
  describe('resolveModelPrice', () => {
    it('등록 모델(prefix 매칭)은 해당 단가 + matched=true', () => {
      const r = resolveModelPrice('gpt-4o-mini-2024-07-18');
      expect(r.matched).toBe(true);
      expect(r.price).toEqual({ in: 0.00015, out: 0.0006 });
    });

    it('미등록 모델(o4-mini 등 자유문자열)은 DEFAULT_PRICE + matched=false', () => {
      const r = resolveModelPrice('o4-mini');
      expect(r.matched).toBe(false);
      expect(r.price).toEqual({ in: 0.0005, out: 0.0015 });
    });

    it('model undefined도 미매칭으로 폴백(matched=false)', () => {
      const r = resolveModelPrice(undefined);
      expect(r.matched).toBe(false);
      expect(r.price).toEqual({ in: 0.0005, out: 0.0015 });
    });
  });

  describe('isPricedModel', () => {
    it.each([
      ['gpt-4o-mini', true],
      ['gpt-4o', true],
      ['claude-haiku-3-5', true],
      ['claude-sonnet-4', true],
      ['o4-mini', false],
      ['gemini-1.5-flash', false],
      ['', false],
      [undefined, false],
    ])('isPricedModel(%p) === %p', (model, expected) => {
      expect(isPricedModel(model as string | undefined)).toBe(expected);
    });
  });

  describe('estimateCostUsd', () => {
    it('등록 모델은 등록 단가로 계산(기존 동작 회귀 보존)', () => {
      // gpt-4o-mini: 400/1000*0.00015 + 150/1000*0.0006
      const cost = estimateCostUsd({ model: 'gpt-4o-mini', inputTokens: 400, outputTokens: 150 });
      expect(cost).toBeCloseTo((400 * 0.00015) / 1000 + (150 * 0.0006) / 1000, 10);
    });

    it('미등록 모델은 DEFAULT_PRICE로 계산(폴백 비용은 실청구와 다를 수 있음)', () => {
      const cost = estimateCostUsd({ model: 'o4-mini', inputTokens: 1000, outputTokens: 1000 });
      // DEFAULT_PRICE: 1*0.0005 + 1*0.0015
      expect(cost).toBeCloseTo(0.0005 + 0.0015, 10);
    });
  });
});
