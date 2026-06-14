import {
  KST_TIMEZONE,
  formatKstDateDashed,
  formatKstDateCompact,
  kstYear,
  kstMonth,
  kstDayStart,
  kstMonthStart,
} from './kst';

/**
 * DAR-199 회귀 가드 — 날짜 포맷의 KST 고정(시스템 TZ 무관).
 *
 * 모든 단정은 **절대 시각(UTC 'Z')** 입력으로 작성한다. `Intl.DateTimeFormat`은
 * 명시한 `timeZone: 'Asia/Seoul'`로만 환산하므로 `process.env.TZ`(UTC/Seoul/NY)에
 * 무관하게 동일 결과를 낸다 → TZ 독립 단정. CI(ubuntu UTC, DAR-132)에서도 동일.
 *
 * 핵심 버그 재현: UTC 새벽(KST 00~09시) 구간은 UTC 날짜가 KST 전일이다. 로컬 TZ
 * getFullYear/Month/Date 를 쓰면 이 구간에 전일을 반환해 당일 공시·일봉이 누락됐다.
 */
describe('KST 날짜 유틸 (DAR-199, TZ 독립)', () => {
  it('타임존 상수는 Asia/Seoul', () => {
    expect(KST_TIMEZONE).toBe('Asia/Seoul');
  });

  describe('UTC 새벽(=KST 전일+α) 경계 — 버그 핵심 구간', () => {
    // 2026-06-14T18:00:00Z = 2026-06-15 03:00 KST. UTC는 06-14, KST는 06-15.
    const dawn = new Date('2026-06-14T18:00:00Z');
    it('formatKstDateCompact는 KST 당일(20260615)', () => {
      expect(formatKstDateCompact(dawn)).toBe('20260615');
    });
    it('formatKstDateDashed는 KST 당일(2026-06-15)', () => {
      expect(formatKstDateDashed(dawn)).toBe('2026-06-15');
    });
    it('로컬 getDate 기반이었다면 UTC 전일(20260614)이 나왔어야 함 — 회귀 대조', () => {
      // 동일 시각의 "버그 동작"을 UTC 가정으로 재현해 차이를 못박는다.
      const utcCompact = `${dawn.getUTCFullYear()}${String(
        dawn.getUTCMonth() + 1,
      ).padStart(2, '0')}${String(dawn.getUTCDate()).padStart(2, '0')}`;
      expect(utcCompact).toBe('20260614'); // 옛 버그 결과
      expect(formatKstDateCompact(dawn)).not.toBe(utcCompact); // 새 동작은 다름
    });
  });

  describe('자정 경계', () => {
    it('KST 00:30(=UTC 전일 15:30)도 당일로 묶임', () => {
      expect(formatKstDateCompact(new Date('2026-06-14T15:30:00Z'))).toBe(
        '20260615',
      );
    });
    it('KST 23:59(=UTC 14:59)는 같은 날', () => {
      expect(formatKstDateCompact(new Date('2026-06-15T14:59:59Z'))).toBe(
        '20260615',
      );
    });
    it('KST 다음날 00:00(=UTC 15:00)은 익일', () => {
      expect(formatKstDateCompact(new Date('2026-06-15T15:00:00Z'))).toBe(
        '20260616',
      );
    });
  });

  describe('연/월 경계 — kstYear/kstMonth', () => {
    it('연말 UTC 20:00(=KST 익년 01-01 05:00)은 다음 해', () => {
      const d = new Date('2025-12-31T20:00:00Z');
      expect(kstYear(d)).toBe(2026);
      expect(kstMonth(d)).toBe(1);
      expect(d.getUTCFullYear()).toBe(2025); // UTC는 아직 전년 — 버그 대조
    });
    it('월말 UTC 20:00(=KST 익월 01일 05:00)은 다음 달 (실적시즌 경계)', () => {
      const d = new Date('2026-04-30T20:00:00Z');
      expect(kstMonth(d)).toBe(5); // 실적시즌(3·5·8·11) 진입 — KST 기준
      expect(d.getUTCMonth() + 1).toBe(4); // UTC는 아직 4월 — 버그 대조
    });
    it('평시 정오는 그대로', () => {
      const d = new Date('2026-08-10T03:00:00Z'); // KST 12:00
      expect(kstYear(d)).toBe(2026);
      expect(kstMonth(d)).toBe(8);
    });
  });

  /**
   * DAR-243 — 비용 한도 윈도 경계의 KST 고정.
   *
   * KST 자정/월초의 절대 시각은 UTC로는 전일/전월 15:00이다(KST=UTC+9, DST 없음).
   * createdAt(UTC 저장)과 비교할 경계가 이 절대 시각이어야 일/월 윈도가 9시간
   * 어긋나지 않는다. 단정은 모두 절대 시각('Z')이라 process.env.TZ에 무관하다.
   */
  describe('한도 윈도 경계 — kstDayStart/kstMonthStart (DAR-243, TZ 독립)', () => {
    it('kstDayStart는 KST 당일 00:00 = UTC 전일 15:00', () => {
      // 2026-06-14T18:00Z = KST 06-15 03:00 → 그 날 KST 자정은 06-14 15:00Z
      const dawn = new Date('2026-06-14T18:00:00Z');
      expect(kstDayStart(dawn).toISOString()).toBe('2026-06-14T15:00:00.000Z');
    });

    it('UTC 자정 가정(옛 버그)이었다면 9시간 빠른 경계가 잡혔어야 함 — 회귀 대조', () => {
      const dawn = new Date('2026-06-14T18:00:00Z');
      const kstBoundary = kstDayStart(dawn).getTime();
      // 옛 setHours(0,0,0,0)을 UTC로 해석하면 06-14 00:00Z가 경계였다.
      const buggyUtcBoundary = new Date('2026-06-14T00:00:00Z').getTime();
      const NINE_HOURS_MS = 9 * 60 * 60 * 1000;
      expect(kstBoundary - buggyUtcBoundary).toBe(15 * 60 * 60 * 1000);
      // KST 자정은 UTC 자정보다 9시간 *이르다*(전일 15:00) — 경계 어긋남의 핵심.
      const kstMidnightAsUtcDay = new Date('2026-06-15T00:00:00Z').getTime();
      expect(kstMidnightAsUtcDay - kstBoundary).toBe(NINE_HOURS_MS);
    });

    it('KST 자정 직후(00:30=UTC 전일 15:30)도 같은 KST 당일 경계로 묶임', () => {
      const justAfter = new Date('2026-06-14T15:30:00Z'); // KST 06-15 00:30
      // KST 06-15의 자정 = UTC 06-14 15:00. 경계는 입력보다 이르다(이후로 포함).
      expect(kstDayStart(justAfter).toISOString()).toBe(
        '2026-06-14T15:00:00.000Z',
      );
      expect(justAfter.getTime()).toBeGreaterThanOrEqual(
        kstDayStart(justAfter).getTime(),
      );
    });

    it('KST 자정 직전(23:59=UTC 14:59)은 같은 날 경계로 묶임', () => {
      const justBefore = new Date('2026-06-15T14:59:59Z'); // KST 06-15 23:59
      expect(kstDayStart(justBefore).toISOString()).toBe(
        '2026-06-14T15:00:00.000Z',
      );
    });

    it('kstMonthStart는 KST 1일 00:00 = UTC 전월 말일 15:00', () => {
      // 2026-06-14T18:00Z = KST 06-15 → 6월 KST 월초는 05-31 15:00Z
      const d = new Date('2026-06-14T18:00:00Z');
      expect(kstMonthStart(d).toISOString()).toBe('2026-05-31T15:00:00.000Z');
    });

    it('월말 UTC 새벽(KST 익월 진입)은 새 달의 월초 경계', () => {
      // 2026-05-31T20:00Z = KST 06-01 05:00 → 6월 월초 = 05-31 15:00Z
      const d = new Date('2026-05-31T20:00:00Z');
      expect(kstMonthStart(d).toISOString()).toBe('2026-05-31T15:00:00.000Z');
      expect(d.getUTCMonth() + 1).toBe(5); // UTC는 아직 5월 — 버그 대조
    });

    it('연말 경계: KST 익년 1월은 전년 12-31 15:00Z 월초', () => {
      const d = new Date('2025-12-31T20:00:00Z'); // KST 2026-01-01 05:00
      expect(kstMonthStart(d).toISOString()).toBe('2025-12-31T15:00:00.000Z');
    });
  });
});
