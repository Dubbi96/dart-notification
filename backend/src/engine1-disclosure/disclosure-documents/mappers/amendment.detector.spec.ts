// backend/src/disclosure-documents/mappers/amendment.detector.spec.ts
import {
  isAmendment,
  isAmendmentByReportName,
  detectAmendment,
  extractOriginalRcpNo,
} from './amendment.detector';

describe('isAmendment', () => {
  it('[기재정정] 패턴을 감지해야 한다 (규칙 A-01)', () => {
    expect(isAmendment('[기재정정]')).toBe(true);
    expect(isAmendment('[기재정정] 원공시 접수번호: 20240601000001')).toBe(true);
  });

  it('[첨부정정] 패턴을 감지해야 한다', () => {
    expect(isAmendment('[첨부정정]')).toBe(true);
    expect(isAmendment('[첨부정정] 일부 첨부 수정')).toBe(true);
  });

  it('[자진정정] 패턴을 감지해야 한다', () => {
    expect(isAmendment('[자진정정]')).toBe(true);
  });

  it('[정정] 패턴을 감지해야 한다', () => {
    expect(isAmendment('[정정]')).toBe(true);
  });

  it('정정 신고 패턴을 감지해야 한다', () => {
    expect(isAmendment('정정 신고서')).toBe(true);
    expect(isAmendment('정정신고')).toBe(true);
  });

  it('정정 보고 패턴을 감지해야 한다', () => {
    expect(isAmendment('정정보고')).toBe(true);
  });

  it('정정 패턴이 없는 rmk는 false를 반환해야 한다', () => {
    expect(isAmendment('')).toBe(false);
    expect(isAmendment('일반 공시')).toBe(false);
    expect(isAmendment('유상증자')).toBe(false);
  });

  it('빈 문자열에 대해 false를 반환해야 한다', () => {
    expect(isAmendment('')).toBe(false);
  });
});

describe('isAmendmentByReportName', () => {
  it('[기재정정]이 포함된 reportName을 감지해야 한다 (규칙 A-02)', () => {
    expect(
      isAmendmentByReportName('[기재정정]단일판매·공급계약체결'),
    ).toBe(true);
  });

  it('[첨부정정]이 포함된 reportName을 감지해야 한다', () => {
    expect(isAmendmentByReportName('[첨부정정]자기주식취득결정')).toBe(true);
  });

  it('(정정) 패턴을 감지해야 한다', () => {
    expect(isAmendmentByReportName('현금배당결정(정정)')).toBe(true);
  });

  it('정정 신고서 패턴을 감지해야 한다', () => {
    expect(isAmendmentByReportName('유상증자정정신고서')).toBe(true);
  });

  it('정정 패턴 없는 reportName은 false를 반환해야 한다', () => {
    expect(isAmendmentByReportName('단일판매·공급계약체결')).toBe(false);
    expect(isAmendmentByReportName('자기주식취득결정')).toBe(false);
  });
});

describe('detectAmendment', () => {
  it('rmk OR reportName 중 하나라도 정정이면 true를 반환해야 한다', () => {
    expect(detectAmendment('[기재정정]', '단일판매·공급계약체결')).toBe(true);
    expect(detectAmendment('', '[기재정정]단일판매·공급계약체결')).toBe(true);
    expect(detectAmendment('[기재정정]', '[기재정정]단일판매·공급계약체결')).toBe(true);
  });

  it('둘 다 정정 패턴 없으면 false를 반환해야 한다', () => {
    expect(detectAmendment('', '단일판매·공급계약체결')).toBe(false);
  });
});

describe('extractOriginalRcpNo', () => {
  it('14자리 숫자를 추출해야 한다 (규칙 A-03)', () => {
    expect(
      extractOriginalRcpNo('[기재정정] 원본 접수번호: 20240101123456'),
    ).toBe('20240101123456');
  });

  it('다양한 형식의 rmk에서 14자리 숫자를 추출해야 한다', () => {
    expect(
      extractOriginalRcpNo('[첨부정정] (원접수번호: 20231215987654)'),
    ).toBe('20231215987654');
    expect(
      extractOriginalRcpNo('[자진정정] 원공시: 20240215001234'),
    ).toBe('20240215001234');
  });

  it('여러 14자리 숫자가 있으면 첫 번째를 반환해야 한다', () => {
    expect(
      extractOriginalRcpNo('20240101000001 수정 20240601000002'),
    ).toBe('20240101000001');
  });

  it('14자리 숫자가 없으면 null을 반환해야 한다', () => {
    expect(extractOriginalRcpNo('[기재정정] 원공시 없음')).toBeNull();
    expect(extractOriginalRcpNo('')).toBeNull();
    expect(extractOriginalRcpNo('[기재정정]')).toBeNull();
  });

  it('13자리나 15자리 숫자는 추출하지 않아야 한다', () => {
    expect(extractOriginalRcpNo('2024010112345')).toBeNull();   // 13자리
    expect(extractOriginalRcpNo('202401011234567')).toBeNull(); // 15자리
  });
});
