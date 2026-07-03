import {
  KRX_HOLIDAYS,
  KRX_HALF_DAYS,
  DEFAULT_MARKET_SESSION,
  isHoliday,
  isWeekend,
  isWeekendDate,
  isTradingDay,
  nextTradingDay,
  prevTradingDay,
  isHalfDay,
  getMarketSession,
  lastTradingDayOfMonth,
  isLastTradingDayOfMonth,
} from './market-calendar';

/**
 * DAR-481 — MarketCalendar 단일 모듈 SSOT 검증.
 *
 * 3대 축:
 *  A) 2026 공휴일 보강(시한성 버그 해소) — 하반기 공휴일이 비거래일로 판정되는가.
 *  B) 거래일 판정 수렴 '결과 동치성'(이슈 DoD 필수) — 리팩터가 기존 3곳 의미를 보존하는가.
 *  C) 반일장 스키마·월말 거래일(데이터 폴백) 신규 기능.
 *
 * 날짜는 정적 하드코딩이나 '연도 커버리지'는 특정 2026 항목으로 고정 → 2027 자동실패 없음
 * (harness/KNOWN_FAILURES: 절대날짜 시한부 테스트 금지 준수).
 */
describe('MarketCalendar (DAR-481)', () => {
  // ── A) 2026 공휴일 보강 — 시한성 버그 해소 ──────────────────────────────
  describe('A. 2026 하반기 공휴일 보강(하드코딩 5건 → 전체)', () => {
    // 이슈가 지목한 '가장 이른 위험일': 8/15 광복절(토) 대체 8/17(월).
    it('8/17 광복절 대체공휴일(월)은 비거래일 — 이전엔 거래일로 오인(버그)', () => {
      expect(isTradingDay('20260817')).toBe(false);
      expect(isHoliday('20260817')).toBe(true);
    });

    it.each([
      ['20260302', '삼일절 대체(월)'],
      ['20260501', '근로자의날(금)'],
      ['20260525', '부처님오신날 대체(월)'],
      ['20260817', '광복절 대체(월)'],
      ['20260924', '추석 연휴(목)'],
      ['20260925', '추석(금)'],
      ['20261005', '개천절 대체(월)'],
      ['20261009', '한글날(금)'],
      ['20261231', '연말 최종휴장일(목)'],
    ])('%s (%s) 는 평일이지만 비거래일', (ymd) => {
      expect(isTradingDay(ymd)).toBe(false);
    });

    it('추석 9/26(토)는 대체공휴일 없음 — 설날·추석은 일요일 겹칠 때만 대체', () => {
      // 9/28(월)은 정상 거래일이어야 한다(오등록 방지).
      expect(isTradingDay('20260928')).toBe(true);
      expect(isHoliday('20260928')).toBe(false);
    });

    it('정상 거래일은 참(경계 확인): 12/30(수, 폐장일)·8/18(화)', () => {
      expect(isTradingDay('20261230')).toBe(true); // 연말 마지막 거래일
      expect(isTradingDay('20260818')).toBe(true); // 광복절 대체 다음날
    });
  });

  // ── B) 결과 동치성(refactor 무행동 변경 + 의도된 delta 격리) ─────────────
  describe('B. 결과 동치성 — 기존 3곳 의미 보존', () => {
    /**
     * Site 1) d0-calculator(평일 && 공휴일) 위임 동치성.
     * 참조 오라클: 리팩터 전 로직(2024·2025 목록 + 2026 옛 5건) 을 재구성해, 2026 신규
     * 보강분을 제외한 모든 날짜에서 old==new 임을 증명하고, 신규 보강분에서만 delta(버그→수정)를
     * 격리한다.
     */
    const OLD_2026 = new Set([
      '20260101', '20260216', '20260217', '20260218', '20260301', '20260505', '20261225',
    ]);
    // 리팩터 전 목록(2024·2025 는 동결이라 신·구 동일) + 옛 2026.
    const oldHolidaySet = new Set<string>([...KRX_HOLIDAYS].filter((d) => !d.startsWith('2026')));
    for (const d of OLD_2026) oldHolidaySet.add(d);

    const oldDow = (ymd: string): number => {
      const y = Number(ymd.slice(0, 4));
      const m = Number(ymd.slice(4, 6));
      const dd = Number(ymd.slice(6, 8));
      return new Date(y, m - 1, dd).getDay(); // 옛 구현: 로컬 Date.getDay()
    };
    const oldIsTradingDay = (ymd: string): boolean => {
      if (oldHolidaySet.has(ymd)) return false;
      const dow = oldDow(ymd);
      return dow >= 1 && dow <= 5;
    };

    // 2026 신규 보강 '평일' 항목(= 의도된 delta: old=거래일(버그), new=비거래일).
    const NEW_2026_WEEKDAY_ADDS = ['20260302', '20260501', '20260525', '20260817', '20260924', '20260925', '20261005', '20261009', '20261231'];

    it('2026 전 일자 스윕: 신규 보강분 외 모든 날짜에서 old==new(무행동 변경)', () => {
      const delta = new Set(NEW_2026_WEEKDAY_ADDS);
      let checked = 0;
      for (let m = 1; m <= 12; m++) {
        const daysInMonth = new Date(2026, m, 0).getDate();
        for (let d = 1; d <= daysInMonth; d++) {
          const ymd = `2026${String(m).padStart(2, '0')}${String(d).padStart(2, '0')}`;
          if (delta.has(ymd)) continue; // delta 는 아래에서 별도 검증
          expect(isTradingDay(ymd)).toBe(oldIsTradingDay(ymd));
          checked++;
        }
      }
      expect(checked).toBeGreaterThan(350); // 사실상 연중 전일 커버
    });

    it('신규 보강분(delta): 옛 구현은 거래일 오판, 새 구현은 비거래일', () => {
      for (const ymd of NEW_2026_WEEKDAY_ADDS) {
        expect(oldIsTradingDay(ymd)).toBe(true); // 버그 재현
        expect(isTradingDay(ymd)).toBe(false); // 수정 확인
      }
    });

    it('2024·2025(동결 이력)은 old==new 전부 동치', () => {
      for (const year of [2024, 2025]) {
        for (let m = 1; m <= 12; m++) {
          const daysInMonth = new Date(year, m, 0).getDate();
          for (let d = 1; d <= daysInMonth; d++) {
            const ymd = `${year}${String(m).padStart(2, '0')}${String(d).padStart(2, '0')}`;
            expect(isTradingDay(ymd)).toBe(oldIsTradingDay(ymd));
          }
        }
      }
    });

    /** Site 3) krx-api.isWeekend / kst weekend-only 위임 동치성 — getDay 기반 그대로. */
    it('isWeekendDate 는 기존 getDay() 규칙과 동치(주말=토·일)', () => {
      const samples = [
        new Date('2026-08-15T00:00:00Z'), // 토
        new Date('2026-08-16T00:00:00Z'), // 일
        new Date('2026-08-17T00:00:00Z'), // 월(대체공휴일이나 '주말'판정은 false)
        new Date('2026-08-14T00:00:00Z'), // 금
      ];
      for (const dt of samples) {
        const legacy = dt.getDay() === 0 || dt.getDay() === 6;
        expect(isWeekendDate(dt)).toBe(legacy);
      }
      // 주말 판정은 공휴일 미반영(대체공휴일 월요일은 '주말' 아님) — 기존 스케줄러 의미 보존.
      expect(isWeekendDate(new Date('2026-08-17T00:00:00Z'))).toBe(false);
    });

    it('isWeekend(YYYYMMDD)은 요일 기반(공휴일 미반영)', () => {
      expect(isWeekend('20260815')).toBe(true); // 토
      expect(isWeekend('20260817')).toBe(false); // 월(공휴일이나 주말 아님)
      expect(isWeekend('20260814')).toBe(false); // 금
    });
  });

  // ── B-2) 기존 event-study.spec.ts 기대치 회귀(2025) ─────────────────────
  describe('B-2. 2025 회귀(기존 스펙 기대치 보존)', () => {
    it('isTradingDay 2025 표본', () => {
      expect(isTradingDay('20250101')).toBe(false); // 신정
      expect(isTradingDay('20250104')).toBe(false); // 토
      expect(isTradingDay('20250105')).toBe(false); // 일
      expect(isTradingDay('20250102')).toBe(true); // 목
      expect(isTradingDay('20250301')).toBe(false); // 삼일절(토)
    });
    it('nextTradingDay 2025 표본', () => {
      expect(nextTradingDay('20250103')).toBe('20250106'); // 금→월
      expect(nextTradingDay('20250101')).toBe('20250102'); // 신정→목
      expect(nextTradingDay('20250102')).toBe('20250103');
    });
  });

  // ── B-3) M10 클록 보호 증거: nextTradingDay 는 항상 실거래일 반환 ─────────
  describe('B-3. M10 매매행동 무변경 증거(paper-sim entryDate 라벨)', () => {
    /**
     * paper-sim 은 예약 entryDate=nextTradingDay(tradeDate) 로 라벨링한다. 보강 전엔 누락
     * 공휴일(예: 8/17)을 '다음 거래일'로 반환할 수 있었다(휴장일 라벨). 보강 후엔 항상 실제
     * 거래일을 반환한다 → 체결기는 실거래일에만 당일시가로 체결하므로 '체결일·체결가'는 불변,
     * 라벨(entryDate)만 실거래일로 교정된다(데이터층 교정, 매매행동 무변경).
     */
    it('nextTradingDay 결과는 언제나 거래일(주말·공휴일 아님)', () => {
      // 8/13(목) 접수 → 8/14(금)이 다음 거래일. 8/15(토)·8/17(월 대체) 스킵 검증은 아래.
      expect(isTradingDay(nextTradingDay('20260813'))).toBe(true);
      // 8/14(금) 접수 → 다음 거래일은 8/15(토)·8/16(일)·8/17(월대체) 모두 스킵 → 8/18(화).
      expect(nextTradingDay('20260814')).toBe('20260818');
      expect(isTradingDay('20260818')).toBe(true);
      // 광복절 대체(8/17) 접수 자체는 없더라도, 어떤 입력이든 반환은 거래일.
      const sweep = ['20260228', '20260501', '20260924', '20261009', '20261231'];
      for (const d of sweep) {
        const nt = nextTradingDay(d);
        expect(isTradingDay(nt)).toBe(true);
      }
    });

    it('prevTradingDay 도 항상 거래일', () => {
      expect(prevTradingDay('20260818')).toBe('20260814'); // 화→(월대체·주말 스킵)→금
      expect(isTradingDay(prevTradingDay('20260302'))).toBe(true);
    });
  });

  // ── C) 반일장 스키마·판정 + 세션 ────────────────────────────────────────
  describe('C. 반일장(수능 지연개장) 스키마·판정', () => {
    it('수능일(2026-11-19) 은 거래일이며 반일장(지연개장) 세션', () => {
      expect(isTradingDay('20261119')).toBe(true);
      expect(isHalfDay('20261119')).toBe(true);
      expect(getMarketSession('20261119')).toEqual({ openMin: 600, closeMin: 990 }); // 10:00~16:30
    });
    it('정규 거래일은 기본 세션(09:00~15:30)', () => {
      expect(isHalfDay('20260818')).toBe(false);
      expect(getMarketSession('20260818')).toEqual(DEFAULT_MARKET_SESSION);
    });
    it('비거래일은 세션 null', () => {
      expect(getMarketSession('20260817')).toBeNull(); // 공휴일
      expect(getMarketSession('20260815')).toBeNull(); // 토
    });
    it('반일장 맵은 정규장 hot-path 에 영향 없음(M10) — 스키마만 존재', () => {
      // KRX_HALF_DAYS 는 신규 세션-인지 소비자용. 현재 등록은 수능일 1건.
      expect(KRX_HALF_DAYS.has('20261119')).toBe(true);
    });
  });

  // ── C-2) 월말 거래일 판정(데이터 주도 폴백) ─────────────────────────────
  describe('C-2. 월 마지막 거래일(P13 전제, 데이터 주도 폴백)', () => {
    it('캘린더 규칙: 2026-12 마지막 거래일=12/30(31일 연말휴장 스킵)', () => {
      expect(lastTradingDayOfMonth(2026, 12)).toBe('20261230');
    });
    it('캘린더 규칙: 2026-08 마지막 거래일=8/31(월)', () => {
      // 8/31 은 월요일·비공휴일 → 그대로.
      expect(lastTradingDayOfMonth(2026, 8)).toBe('20260831');
    });
    it('캘린더 규칙: 2026-05 마지막 거래일=5/29(금) (5/30·31 주말)', () => {
      expect(lastTradingDayOfMonth(2026, 5)).toBe('20260529');
    });
    it('데이터 주도(권위): 실재 일봉 최대값 우선 — 캘린더 불완전 오발화 방지', () => {
      // 캘린더가 12/30 을 마지막으로 보더라도, 실재 일봉이 12/29 까지면 12/29 가 정답.
      const actual = ['20261228', '20261229']; // 12/30 데이터 아직 없음(가정)
      expect(lastTradingDayOfMonth(2026, 12, { actualTradingDays: actual })).toBe('20261229');
    });
    it('데이터에 타월 날짜 섞여도 해당 월만 필터', () => {
      const actual = ['20260130', '20260227', '20260226']; // 2월 대상
      expect(lastTradingDayOfMonth(2026, 2, { actualTradingDays: actual })).toBe('20260227');
    });
    it('빈 데이터면 캘린더 폴백', () => {
      expect(lastTradingDayOfMonth(2026, 12, { actualTradingDays: [] })).toBe('20261230');
    });
    it('isLastTradingDayOfMonth 판정', () => {
      expect(isLastTradingDayOfMonth('20261230')).toBe(true);
      expect(isLastTradingDayOfMonth('20261229')).toBe(false);
      // 데이터 주도: 12/29 가 실질 마지막이면 true.
      expect(
        isLastTradingDayOfMonth('20261229', { actualTradingDays: ['20261228', '20261229'] }),
      ).toBe(true);
    });
  });

  // ── D) 입력 방어 ────────────────────────────────────────────────────────
  describe('D. 입력 검증', () => {
    it('형식 불량 YYYYMMDD 는 명확한 에러', () => {
      expect(() => isTradingDay('2026-08-17')).toThrow(/YYYYMMDD/);
      expect(() => isTradingDay('bad')).toThrow(/YYYYMMDD/);
    });
    it('month 범위 밖은 에러', () => {
      expect(() => lastTradingDayOfMonth(2026, 13)).toThrow();
      expect(() => lastTradingDayOfMonth(2026, 0)).toThrow();
    });
  });
});
