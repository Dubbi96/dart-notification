import {
  formatRcpThreshold,
  isNewDisclosure,
  countNewDisclosures,
} from './watchlist.util';

describe('watchlist.util (DAR-165 신규 공시 카운트)', () => {
  describe('formatRcpThreshold', () => {
    it('UTC 시각을 KST 기준 YYYYMMDDHHmmss 문자열로 변환한다', () => {
      // 2026-06-12T03:00:00Z = 2026-06-12 12:00:00 KST
      const d = new Date('2026-06-12T03:00:00.000Z');
      expect(formatRcpThreshold(d)).toBe('20260612120000');
    });

    it('UTC 자정 직전이 KST 다음 날 오전으로 넘어간다(+9h)', () => {
      // 2026-06-11T20:30:00Z = 2026-06-12 05:30:00 KST
      const d = new Date('2026-06-11T20:30:00.000Z');
      expect(formatRcpThreshold(d)).toBe('20260612053000');
    });

    it('월/일/시/분/초를 제로패딩한다', () => {
      // 2026-01-05T00:01:02Z = 2026-01-05 09:01:02 KST
      const d = new Date('2026-01-05T00:01:02.000Z');
      expect(formatRcpThreshold(d)).toBe('20260105090102');
    });
  });

  describe('isNewDisclosure (Postgres varchar > 와 동일한 사전식 비교)', () => {
    const threshold = '20260612120000'; // 2026-06-12 12:00:00 KST

    it('임계 이후 시각의 14자리 rcpDt 는 신규', () => {
      expect(isNewDisclosure('20260612160000', threshold)).toBe(true);
    });

    it('임계 이전 시각의 14자리 rcpDt 는 신규 아님', () => {
      expect(isNewDisclosure('20260612090000', threshold)).toBe(false);
    });

    it('다음 날짜의 8자리 rcpDt 는 신규', () => {
      expect(isNewDisclosure('20260613', threshold)).toBe(true);
    });

    it('같은 날 8자리(=00:00:00 해석) rcpDt 는 정오 임계 기준 신규 아님', () => {
      expect(isNewDisclosure('20260612', threshold)).toBe(false);
    });

    it('이전 날짜 rcpDt 는 신규 아님', () => {
      expect(isNewDisclosure('20260601', threshold)).toBe(false);
    });
  });

  describe('countNewDisclosures', () => {
    it('임계 이후 공시 건수만 집계한다', () => {
      const rcpDts = [
        '20260613090000', // 신규
        '20260612160000', // 신규
        '20260612090000', // 과거
        '20260601', // 과거
        '20260615', // 신규
      ];
      expect(countNewDisclosures(rcpDts, '20260612120000')).toBe(3);
    });

    it('빈 목록은 0', () => {
      expect(countNewDisclosures([], '20260612120000')).toBe(0);
    });

    it('lastViewed=등록시각 직후 새 공시가 없으면 0(배지 없음)', () => {
      const threshold = formatRcpThreshold(new Date('2026-06-12T03:00:00.000Z'));
      expect(countNewDisclosures(['20260612090000', '20260611'], threshold)).toBe(0);
    });
  });
});
