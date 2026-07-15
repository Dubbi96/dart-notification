/**
 * investor-flow-published-date.spec.ts — 공매도 잔고 공표일(T+2 영업일) 계산 (갭분석 W16).
 *
 * 검증: 평일 한복판·주말 걸침·KRX 휴장일(대체공휴일·추석 연휴) 걸침에서 publishedDate 가
 * 정확히 'T+2 번째 영업일'로 계산되는지 — lookahead 불가침의 스키마 단계 강제 근거.
 */

import { computeShortBalancePublishedDate } from './investor-flow-source';

describe('computeShortBalancePublishedDate (W16 — T+2 영업일)', () => {
  it('평일 한복판 — 월(20260713) 거래분은 수(20260715) 공표', () => {
    expect(computeShortBalancePublishedDate('20260713')).toBe('20260715');
  });

  it('주말 걸침 — 목(20260716) 거래분은 금 다음 월(20260720) 공표', () => {
    expect(computeShortBalancePublishedDate('20260716')).toBe('20260720');
  });

  it('주말 걸침 — 금(20260710) 거래분은 월·화 순회로 화(20260714) 공표', () => {
    expect(computeShortBalancePublishedDate('20260710')).toBe('20260714');
  });

  it('대체공휴일 걸침 — 목(20260813) 거래분은 광복절 대체휴일(8/17 월) 건너 화(20260818) 공표', () => {
    // T+1 = 금 20260814, T+2 후보 토·일·월(0817 휴장) 전부 스킵 → 화 20260818.
    expect(computeShortBalancePublishedDate('20260813')).toBe('20260818');
  });

  it('연휴 걸침 — 수(20260923) 거래분은 추석 연휴(9/24~9/26)+주말 건너 화(20260929) 공표', () => {
    // T+1 = 월 20260928(연휴 후 첫 거래일), T+2 = 화 20260929.
    expect(computeShortBalancePublishedDate('20260923')).toBe('20260929');
  });

  it('항상 tradeDate 보다 미래(문자열 사전식 = 날짜순) — as-of 조회의 최소 불변식', () => {
    for (const d of ['20260102', '20260430', '20260630', '20261229']) {
      expect(computeShortBalancePublishedDate(d) > d).toBe(true);
    }
  });
});
