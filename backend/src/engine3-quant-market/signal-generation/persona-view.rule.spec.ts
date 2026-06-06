import { derivePersonaViews } from './persona-view.rule';
import { PERSONA_TYPES } from '../buy-signal/config/buy-signal.config';

/**
 * DAR-41: persona view 파생 규칙 — 순수 Rule, 결정론적.
 */
describe('derivePersonaViews (DAR-41)', () => {
  it('4 Persona 전부에 대해 view 를 결정론적으로 반환한다', () => {
    const views = derivePersonaViews('SHARE_BUYBACK', 'POSITIVE');
    expect(views).toHaveLength(PERSONA_TYPES.length);
    expect(views.map((v) => v.persona).sort()).toEqual(
      [...PERSONA_TYPES].sort(),
    );
    // 동일 입력 → 동일 출력 (결정론)
    expect(derivePersonaViews('SHARE_BUYBACK', 'POSITIVE')).toEqual(views);
  });

  it('VALUE 는 자기주식취득(POSITIVE)에 우호적(POSITIVE view)이다', () => {
    const views = derivePersonaViews('SHARE_BUYBACK', 'POSITIVE');
    const value = views.find((v) => v.persona === 'VALUE');
    expect(value?.view).toBe('POSITIVE');
  });

  it('비선호(NEUTRAL affinity) persona 는 POSITIVE 공시에 WATCH 를 준다', () => {
    const views = derivePersonaViews('SHARE_BUYBACK', 'POSITIVE');
    const growth = views.find((v) => v.persona === 'GROWTH');
    // GROWTH 선호 목록에 SHARE_BUYBACK 없음 → NEUTRAL affinity → WATCH
    expect(growth?.view).toBe('WATCH');
  });

  it('희석성 이벤트(유상증자) NEGATIVE 는 보수 persona 에 NEGATIVE view', () => {
    const views = derivePersonaViews('PAID_IN_CAPITAL_INCREASE', 'NEGATIVE');
    const growth = views.find((v) => v.persona === 'GROWTH');
    expect(growth?.view).toBe('NEGATIVE');
  });

  it('UNKNOWN polarity 는 모든 persona 에 NEUTRAL view', () => {
    const views = derivePersonaViews('SUPPLY_CONTRACT', 'UNKNOWN');
    expect(views.every((v) => v.view === 'NEUTRAL')).toBe(true);
  });

  it('view 는 항상 허용된 4 값 중 하나다', () => {
    const allowed = new Set(['POSITIVE', 'WATCH', 'NEUTRAL', 'NEGATIVE']);
    for (const evt of ['SUPPLY_CONTRACT', 'CB_ISSUANCE', 'OTHER']) {
      for (const pol of ['POSITIVE', 'NEGATIVE', 'MIXED', 'UNKNOWN']) {
        for (const v of derivePersonaViews(evt, pol)) {
          expect(allowed.has(v.view)).toBe(true);
        }
      }
    }
  });

  // DAR-79: 매수/임팩트 판단에 절대 금액이 아닌 규모 정규화 비율을 우선 반영
  describe('임팩트 규모 보정 (DAR-79)', () => {
    const valueOf = (vs: ReturnType<typeof derivePersonaViews>, p: string) =>
      vs.find((v) => v.persona === p)?.view;

    it('impact 미지정 → 기존 동작 그대로(회귀 0): VALUE 가 자기주식취득에 POSITIVE', () => {
      const withImpact = derivePersonaViews('SHARE_BUYBACK', 'POSITIVE');
      const noImpact = derivePersonaViews('SHARE_BUYBACK', 'POSITIVE', undefined);
      expect(valueOf(withImpact, 'VALUE')).toBe('POSITIVE');
      expect(noImpact).toEqual(withImpact);
    });

    it('상대비율이 미미(<1%)하면 우호 긍정 view 를 POSITIVE→WATCH 로 보정', () => {
      const views = derivePersonaViews('SHARE_BUYBACK', 'POSITIVE', {
        relativeRatio: 0.3, // 0.3% — 규모 미미
        absoluteAmount: 50_000_000_000, // 절대 금액은 크지만 비율 우선
      });
      expect(valueOf(views, 'VALUE')).toBe('WATCH');
    });

    it('상대비율이 유의(≥1%)하면 POSITIVE 유지', () => {
      const views = derivePersonaViews('SHARE_BUYBACK', 'POSITIVE', {
        relativeRatio: 5,
        absoluteAmount: 1_000_000,
      });
      expect(valueOf(views, 'VALUE')).toBe('POSITIVE');
    });

    it('비율 결측 시 절대 금액으로 폴백: 큰 금액 → POSITIVE 유지', () => {
      const views = derivePersonaViews('SHARE_BUYBACK', 'POSITIVE', {
        relativeRatio: null,
        absoluteAmount: 10_000_000_000, // 100억 ≥ 임계치
      });
      expect(valueOf(views, 'VALUE')).toBe('POSITIVE');
    });

    it('비율 결측 + 절대 금액도 미미 → WATCH 로 보정', () => {
      const views = derivePersonaViews('SHARE_BUYBACK', 'POSITIVE', {
        relativeRatio: null,
        absoluteAmount: 100_000_000, // 1억 < 임계치(10억)
      });
      expect(valueOf(views, 'VALUE')).toBe('WATCH');
    });

    it('비율·절대 금액 모두 결측 → 규모 미반영(기존 POSITIVE 유지)', () => {
      const views = derivePersonaViews('SHARE_BUYBACK', 'POSITIVE', {
        relativeRatio: null,
        absoluteAmount: null,
      });
      expect(valueOf(views, 'VALUE')).toBe('POSITIVE');
    });

    it('비우호 persona(GROWTH의 SHARE_BUYBACK)는 규모와 무관하게 WATCH 그대로', () => {
      const low = derivePersonaViews('SHARE_BUYBACK', 'POSITIVE', { relativeRatio: 0.1 });
      const high = derivePersonaViews('SHARE_BUYBACK', 'POSITIVE', { relativeRatio: 50 });
      expect(valueOf(low, 'GROWTH')).toBe('WATCH');
      expect(valueOf(high, 'GROWTH')).toBe('WATCH');
    });

    it('NEGATIVE polarity 에는 임팩트 보정이 영향을 주지 않는다', () => {
      const base = derivePersonaViews('PAID_IN_CAPITAL_INCREASE', 'NEGATIVE');
      const withImpact = derivePersonaViews('PAID_IN_CAPITAL_INCREASE', 'NEGATIVE', {
        relativeRatio: 0.1,
      });
      expect(withImpact).toEqual(base);
    });
  });
});
