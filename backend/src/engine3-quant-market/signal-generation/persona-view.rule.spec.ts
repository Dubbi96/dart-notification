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
});
