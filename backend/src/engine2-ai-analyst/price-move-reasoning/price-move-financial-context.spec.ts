import {
  ANNUAL_REPRT_CODE,
  buildFinancialContext,
  resolveEventScale,
  FinancialContextInput,
} from './price-move-financial-context';

const base: FinancialContextInput = {
  eventType: 'SUPPLY_CONTRACT',
  extractedData: { contractAmount: 123_000_000_000 }, // 1,230억
  annualRevenueWon: 1_000_000_000_000, // 1조
  annualRevenueYear: '2025',
};

describe('price-move-financial-context (DAR-528)', () => {
  describe('buildFinancialContext — 정상 산출', () => {
    it('계약 규모/연매출 비율을 한 줄로 산출한다(연도·금액 축약 포함)', () => {
      const line = buildFinancialContext(base);
      // 1,230억 / 1조 = 12.3%
      expect(line).toBe('이번 계약 규모는 2025 연매출의 약 12.3% (1230억 / 연매출 1조)');
    });

    it('사업연도 결측 시 연도 접두사 없이 산출한다', () => {
      const line = buildFinancialContext({ ...base, annualRevenueYear: null });
      expect(line).toBe('이번 계약 규모는 연매출의 약 12.3% (1230억 / 연매출 1조)');
    });

    it('아주 작은 비율은 "0.1% 미만"으로 정직 표기한다(과대·과소 표기 금지)', () => {
      const line = buildFinancialContext({
        ...base,
        extractedData: { contractAmount: 100_000_000 }, // 1억
        annualRevenueWon: 5_000_000_000_000, // 5조 → 0.002%
      });
      expect(line).toContain('0.1% 미만');
    });

    it('숫자 문자열 계약금액도 원 단위로 강제 변환한다', () => {
      const line = buildFinancialContext({ ...base, extractedData: { contractAmount: '123000000000' } });
      expect(line).toBe('이번 계약 규모는 2025 연매출의 약 12.3% (1230억 / 연매출 1조)');
    });
  });

  describe('★분모(연매출) 결측/불확실 → null (수용기준 핵심)', () => {
    it('연매출(분모)이 null 이면 null(표시 생략) — 수치 발명 금지', () => {
      expect(buildFinancialContext({ ...base, annualRevenueWon: null })).toBeNull();
    });

    it('연매출이 0 이면 null(0 분모 나눗셈 방지)', () => {
      expect(buildFinancialContext({ ...base, annualRevenueWon: 0 })).toBeNull();
    });

    it('연매출이 음수/비유한수면 null', () => {
      expect(buildFinancialContext({ ...base, annualRevenueWon: -1 })).toBeNull();
      expect(buildFinancialContext({ ...base, annualRevenueWon: Number.NaN })).toBeNull();
      expect(buildFinancialContext({ ...base, annualRevenueWon: Number.POSITIVE_INFINITY })).toBeNull();
    });
  });

  describe('분자(공시 규모) 결측/불확실 → null', () => {
    it('계약금액이 결측이면 null', () => {
      expect(buildFinancialContext({ ...base, extractedData: {} })).toBeNull();
      expect(buildFinancialContext({ ...base, extractedData: { contractAmount: null } })).toBeNull();
    });

    it('계약금액이 0·음수면 null(허위 분자 방지)', () => {
      expect(buildFinancialContext({ ...base, extractedData: { contractAmount: 0 } })).toBeNull();
      expect(buildFinancialContext({ ...base, extractedData: { contractAmount: -5 } })).toBeNull();
    });

    it('extractedData 가 객체가 아니면(배열·원시·null) null', () => {
      expect(buildFinancialContext({ ...base, extractedData: null })).toBeNull();
      expect(buildFinancialContext({ ...base, extractedData: [] })).toBeNull();
      expect(buildFinancialContext({ ...base, extractedData: '공급계약' })).toBeNull();
    });

    it('금액 형상이 검증되지 않은 이벤트 유형은 정직하게 생략(null)', () => {
      // 분모가 충분해도 분자 유형 미지원이면 표시하지 않는다.
      expect(buildFinancialContext({ ...base, eventType: 'DIVIDEND' })).toBeNull();
      expect(buildFinancialContext({ ...base, eventType: 'UNKNOWN' })).toBeNull();
    });
  });

  describe('resolveEventScale', () => {
    it('SUPPLY_CONTRACT contractAmount → 계약 규모 분자', () => {
      expect(resolveEventScale('SUPPLY_CONTRACT', { contractAmount: 500_000_000 })).toEqual({
        label: '계약 규모',
        amountWon: 500_000_000,
      });
    });

    it('미지원 유형·결측 금액 → null', () => {
      expect(resolveEventScale('SUPPLY_CONTRACT', { contractAmount: null })).toBeNull();
      expect(resolveEventScale('CAPITAL_INCREASE', { amount: 1 })).toBeNull();
      expect(resolveEventScale('SUPPLY_CONTRACT', undefined)).toBeNull();
    });
  });

  it('연간 보고서 코드 상수는 11011(연매출 분모 SSOT)', () => {
    expect(ANNUAL_REPRT_CODE).toBe('11011');
  });
});
