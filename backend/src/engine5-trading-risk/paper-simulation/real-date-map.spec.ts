/**
 * real-date-map.spec.ts — REAL 매핑 모드 거래일 매핑 단위테스트 (DAR-137, 순수 함수)
 *
 * 검증: 시뮬 연도→실 연도 offset 매핑, MMDD 보존(일별 전진=실가 변동), 2/29 클램프,
 *   형식 불량 graceful, realYearOffset 환경 파싱.
 */

import {
  DEFAULT_REAL_YEAR_OFFSET,
  mapSimDateToRealDate,
  realYearOffset,
} from './real-date-map';

const ORIGINAL_OFFSET = process.env.PAPER_SIM_REAL_YEAR_OFFSET;

afterEach(() => {
  if (ORIGINAL_OFFSET === undefined) delete process.env.PAPER_SIM_REAL_YEAR_OFFSET;
  else process.env.PAPER_SIM_REAL_YEAR_OFFSET = ORIGINAL_OFFSET;
});

describe('mapSimDateToRealDate — 시뮬→실 거래일 매핑(DAR-137)', () => {
  it('연도만 offset 만큼 과거로, MMDD 보존', () => {
    expect(mapSimDateToRealDate('20260608', 1)).toBe('20250608');
    expect(mapSimDateToRealDate('20260102', 1)).toBe('20250102');
    expect(mapSimDateToRealDate('20260608', 2)).toBe('20240608');
  });

  it('일별 전진은 매핑 후에도 전진(실가 변동 가능)', () => {
    const d1 = mapSimDateToRealDate('20260608', 1);
    const d2 = mapSimDateToRealDate('20260609', 1);
    expect(d2 > d1).toBe(true);
    expect(d1).toBe('20250608');
    expect(d2).toBe('20250609');
  });

  it('2/29 → 대상연도 비윤년이면 2/28 클램프', () => {
    // 2028(윤) → offset1 → 2027(비윤) → 0228
    expect(mapSimDateToRealDate('20280229', 1)).toBe('20270228');
    // 2028(윤) → offset4 → 2024(윤) → 0229 유지
    expect(mapSimDateToRealDate('20280229', 4)).toBe('20240229');
  });

  it('offset<1 은 최소 1로 클램프', () => {
    expect(mapSimDateToRealDate('20260608', 0)).toBe('20250608');
    expect(mapSimDateToRealDate('20260608', -3)).toBe('20250608');
  });

  it('형식 불량(8자리 아님)은 입력 그대로 반환(graceful)', () => {
    expect(mapSimDateToRealDate('2026-06-08', 1)).toBe('2026-06-08');
    expect(mapSimDateToRealDate('', 1)).toBe('');
    expect(mapSimDateToRealDate('20260', 1)).toBe('20260');
  });
});

describe('realYearOffset — 환경 파싱', () => {
  it('미설정/불량은 기본값', () => {
    delete process.env.PAPER_SIM_REAL_YEAR_OFFSET;
    expect(realYearOffset()).toBe(DEFAULT_REAL_YEAR_OFFSET);
    process.env.PAPER_SIM_REAL_YEAR_OFFSET = 'abc';
    expect(realYearOffset()).toBe(DEFAULT_REAL_YEAR_OFFSET);
    process.env.PAPER_SIM_REAL_YEAR_OFFSET = '0';
    expect(realYearOffset()).toBe(DEFAULT_REAL_YEAR_OFFSET);
  });

  it('정수≥1 은 그 값', () => {
    process.env.PAPER_SIM_REAL_YEAR_OFFSET = '1';
    expect(realYearOffset()).toBe(1);
    process.env.PAPER_SIM_REAL_YEAR_OFFSET = '3';
    expect(realYearOffset()).toBe(3);
  });
});
