import {
  rcpNoFloorFromDate,
  resolveCursor,
  isNewByCursor,
  countNewByCursor,
  newCountMapFromGrouped,
} from './watchlist.util';

describe('watchlist.util (DAR-185 신규 공시 카운트 — rcpNo 커서)', () => {
  describe('rcpNoFloorFromDate', () => {
    it('UTC 시각의 KST 일자 0시 floor(YYYYMMDD000000)를 만든다', () => {
      // 2026-06-12T03:00:00Z = 2026-06-12 12:00:00 KST → 일자 20260612
      const d = new Date('2026-06-12T03:00:00.000Z');
      expect(rcpNoFloorFromDate(d)).toBe('20260612000000');
    });

    it('UTC 자정 직전은 KST 다음 날 일자로 넘어간다(+9h)', () => {
      // 2026-06-11T20:30:00Z = 2026-06-12 05:30:00 KST → 일자 20260612
      const d = new Date('2026-06-11T20:30:00.000Z');
      expect(rcpNoFloorFromDate(d)).toBe('20260612000000');
    });

    it('월/일을 제로패딩한다', () => {
      // 2026-01-05T00:01:02Z = 2026-01-05 09:01:02 KST → 일자 20260105
      const d = new Date('2026-01-05T00:01:02.000Z');
      expect(rcpNoFloorFromDate(d)).toBe('20260105000000');
    });
  });

  describe('resolveCursor', () => {
    const createdAt = new Date('2026-06-12T03:00:00.000Z'); // KST 20260612

    it('조회 이력(rcpNo)이 있으면 그 rcpNo 를 커서로 쓴다', () => {
      expect(resolveCursor('20260612000123', createdAt)).toBe('20260612000123');
    });

    it('조회 이력이 없으면(null) 등록일 floor 로 폴백한다', () => {
      expect(resolveCursor(null, createdAt)).toBe('20260612000000');
    });

    it('undefined 도 floor 로 폴백한다', () => {
      expect(resolveCursor(undefined, createdAt)).toBe('20260612000000');
    });
  });

  describe('isNewByCursor (Postgres varchar > 와 동일한 사전식 비교)', () => {
    // 사용자가 20260612000300 공시까지 본 상태(커서)
    const cursor = '20260612000300';

    it('커서보다 큰 rcpNo(같은 날 이후 접수)는 신규 — DAR-185 핵심', () => {
      // 같은 날(20260612) 뒤에 접수된 공시: 14자리 rcpNo 라 정확히 비교된다.
      expect(isNewByCursor('20260612000301', cursor)).toBe(true);
    });

    it('다음 날 접수된 rcpNo 는 신규', () => {
      expect(isNewByCursor('20260613000001', cursor)).toBe(true);
    });

    it('커서와 같은 rcpNo(이미 본 마지막 공시)는 신규 아님 → 조회 즉시 배지 0', () => {
      expect(isNewByCursor('20260612000300', cursor)).toBe(false);
    });

    it('커서보다 작은 rcpNo(같은 날 먼저 접수, 이미 봄)는 신규 아님', () => {
      expect(isNewByCursor('20260612000299', cursor)).toBe(false);
    });

    it('이전 날짜 rcpNo 는 신규 아님', () => {
      expect(isNewByCursor('20260601000999', cursor)).toBe(false);
    });
  });

  describe('등록일 floor 폴백 의미(실데이터: 등록 당일 공시도 신규)', () => {
    // DAR-185 회귀 핵심: rcpDt(8자리) 시절에는 등록일 당일 공시가 floor 와 같은 일자라
    // 14자리 임계의 접두사가 되어 항상 누락됐다. 이제 floor 가 ...000000 이고 실 rcpNo 의
    // 일련번호는 000001 이상이라 등록 당일 접수 공시가 신규로 잡힌다.
    const floor = resolveCursor(null, new Date('2026-06-12T03:00:00.000Z')); // 20260612000000

    it('등록 당일(20260612) 접수 공시는 floor 보다 커서 신규', () => {
      expect(isNewByCursor('20260612000001', floor)).toBe(true);
    });

    it('등록 전날 공시는 신규 아님', () => {
      expect(isNewByCursor('20260611000999', floor)).toBe(false);
    });
  });

  describe('countNewByCursor', () => {
    it('커서 이후 공시 건수만 집계한다', () => {
      const cursor = '20260612000300';
      const rcpNos = [
        '20260613000001', // 신규(다음 날)
        '20260612000400', // 신규(같은 날 이후)
        '20260612000300', // 이미 봄(커서와 동일)
        '20260612000100', // 이미 봄(같은 날 먼저)
        '20260601000001', // 과거
        '20260615000002', // 신규
      ];
      expect(countNewByCursor(rcpNos, cursor)).toBe(3);
    });

    it('빈 목록은 0', () => {
      expect(countNewByCursor([], '20260612000000')).toBe(0);
    });

    it('조회 직후(커서=최신 rcpNo)면 더 큰 공시가 없어 0(배지 없음)', () => {
      const cursor = '20260612000400';
      expect(
        countNewByCursor(['20260612000400', '20260612000100'], cursor),
      ).toBe(0);
    });
  });

  describe('newCountMapFromGrouped (DAR-214 grouped count 결과 매핑)', () => {
    it('corpCode → count Map 으로 정규화한다', () => {
      const map = newCountMapFromGrouped([
        { corpCode: 'A', count: 2 },
        { corpCode: 'B', count: 0 },
      ]);
      expect(map.get('A')).toBe(2);
      expect(map.get('B')).toBe(0);
    });

    it('COUNT 가 bigint 로 와도 number 로 변환한다', () => {
      const map = newCountMapFromGrouped([
        { corpCode: 'A', count: BigInt(5) },
      ]);
      expect(map.get('A')).toBe(5);
      expect(typeof map.get('A')).toBe('number');
    });

    it('빈 결과는 빈 Map (호출부에서 ?? 0 폴백)', () => {
      const map = newCountMapFromGrouped([]);
      expect(map.size).toBe(0);
      expect(map.get('Z') ?? 0).toBe(0);
    });
  });
});
