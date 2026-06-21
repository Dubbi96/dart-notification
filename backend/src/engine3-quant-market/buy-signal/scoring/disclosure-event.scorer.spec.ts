/**
 * disclosure-event.scorer.spec.ts — 공시 이벤트 점수 (DAR-410 회피룰 공백 보강 검증)
 *
 * 검증축: ① 미등재(base 0)였던 희석·재무부담 이벤트(SECURITIES_OFFERING/CONVERTIBLE_EXERCISE/
 *   DEBT_GUARANTEE)에 음(-) base 가 등재되어 음의 disclosure 점수를 산출하는지(등급 변별력 강화)
 *   ② polarity 보정이 기존 규약대로 적용되는지 ③ 기존 상수 회귀 0.
 */
import { scoreDisclosureEvent } from './disclosure-event.scorer';
import { EVENT_BASE_SCORES } from '../config/buy-signal.config';

describe('scoreDisclosureEvent — DAR-410 희석·재무부담 이벤트 보강', () => {
  it('신규 등재 이벤트 base 값(도메인 1차원칙·robust 음 실측에 정렬)', () => {
    expect(EVENT_BASE_SCORES.SECURITIES_OFFERING).toBe(-50);
    expect(EVENT_BASE_SCORES.CONVERTIBLE_EXERCISE).toBe(-35);
    expect(EVENT_BASE_SCORES.DEBT_GUARANTEE).toBe(-30);
  });

  it('UNKNOWN polarity → base 그대로 음(-) 점수(회피 변별력)', () => {
    // 과거: 미등재 → base 0(중립). 지금: 음수 → 매수점수 하향(거짓 NEUTRAL 방지).
    expect(scoreDisclosureEvent({ eventType: 'SECURITIES_OFFERING', polarity: 'UNKNOWN' })).toBe(-50);
    expect(scoreDisclosureEvent({ eventType: 'CONVERTIBLE_EXERCISE', polarity: 'UNKNOWN' })).toBe(-35);
  });

  it('미등재 이벤트는 여전히 0(폴백 불변)', () => {
    expect(scoreDisclosureEvent({ eventType: 'TOTALLY_UNKNOWN_EVENT', polarity: 'UNKNOWN' })).toBe(0);
  });

  it('기존 상수 회귀 0(대표 표본)', () => {
    expect(EVENT_BASE_SCORES.SUPPLY_CONTRACT).toBe(70);
    expect(EVENT_BASE_SCORES.DELISTING_RISK).toBe(-100); // ★window robust 완화 권고는 거부(불변)
    expect(scoreDisclosureEvent({ eventType: 'EARNINGS_SHOCK', polarity: 'NEGATIVE' })).toBe(-40); // -80*0.5
  });
});
