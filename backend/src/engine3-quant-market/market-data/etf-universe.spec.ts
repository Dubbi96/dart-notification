/**
 * etf-universe.spec.ts — ETF 유니버스 상수 무결성 (DAR-484 [견고화 W1·P10]).
 *
 * 검증: 4역할 전원 존재·6자리 단축코드·코드 유일·무레버리지 원칙(레버리지/인버스 배제)·이슈 지정 2종 고정.
 */

import {
  ETF_UNIVERSE,
  ETF_UNIVERSE_CODES,
  etfByRole,
  etfByCode,
  isNonLeveragedEtfName,
  EtfRole,
} from './etf-universe';

describe('ETF_UNIVERSE (DAR-484)', () => {
  it('4개 역할이 모두 정확히 1종씩 존재한다', () => {
    const roles: EtfRole[] = [
      'OFFENSE_INTL',
      'OFFENSE_DOMESTIC',
      'DEFENSE_BOND',
      'CASH_SHORT',
    ];
    for (const role of roles) {
      expect(ETF_UNIVERSE.filter((e) => e.role === role)).toHaveLength(1);
    }
    expect(ETF_UNIVERSE).toHaveLength(roles.length);
  });

  it('모든 코드는 6자리 숫자이고 유일하다', () => {
    for (const e of ETF_UNIVERSE) {
      expect(e.code).toMatch(/^\d{6}$/);
      expect(e.name.length).toBeGreaterThan(0);
      expect(e.basis.length).toBeGreaterThan(0);
    }
    expect(new Set(ETF_UNIVERSE_CODES).size).toBe(ETF_UNIVERSE_CODES.length);
  });

  it('무레버리지 원칙 — 레버리지·인버스 종목은 없다', () => {
    for (const e of ETF_UNIVERSE) {
      expect(isNonLeveragedEtfName(e.name)).toBe(true);
    }
  });

  it('이슈 지정 2종(공격A/공격B)이 코드로 고정돼 있다', () => {
    expect(etfByRole('OFFENSE_INTL')?.code).toBe('360750'); // TIGER 미국S&P500
    expect(etfByRole('OFFENSE_DOMESTIC')?.code).toBe('069500'); // KODEX 200
  });

  it('방어·현금성은 무레버리지 채권/단기채로 채워져 있다', () => {
    expect(etfByRole('DEFENSE_BOND')?.code).toMatch(/^\d{6}$/);
    expect(etfByRole('CASH_SHORT')?.code).toMatch(/^\d{6}$/);
  });

  it('etfByCode 로 조회된다', () => {
    expect(etfByCode('069500')?.role).toBe('OFFENSE_DOMESTIC');
    expect(etfByCode('999999')).toBeUndefined();
  });

  describe('isNonLeveragedEtfName', () => {
    it.each([
      'KODEX 레버리지',
      'KODEX 200선물인버스2X',
      'TIGER 200 INVERSE',
      'KODEX 코스닥150 곱버스',
      'ARIRANG 2배 레버리지',
    ])('레버리지/인버스 이름은 false: %s', (name) => {
      expect(isNonLeveragedEtfName(name)).toBe(false);
    });

    it.each(['KODEX 200', 'TIGER 미국S&P500', 'KODEX 단기채권'])(
      '단순 롱 이름은 true: %s',
      (name) => {
        expect(isNonLeveragedEtfName(name)).toBe(true);
      },
    );
  });
});
