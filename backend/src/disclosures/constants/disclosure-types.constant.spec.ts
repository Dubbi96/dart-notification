import {
  isInvestmentRelevant,
  classifyInvestmentEventType,
} from './disclosure-types.constant';

describe('isInvestmentRelevant', () => {
  // ── 5종 매칭 케이스 ──────────────────────────────────────────────────────

  it('단일판매공급계약 보고서명을 true로 분류한다', () => {
    expect(isInvestmentRelevant('단일판매·공급계약체결')).toBe(true);
    expect(isInvestmentRelevant('공급계약 체결')).toBe(true);
    expect(isInvestmentRelevant('판매계약체결')).toBe(true);
  });

  it('자기주식취득 보고서명을 true로 분류한다', () => {
    expect(isInvestmentRelevant('자기주식 취득 결정')).toBe(true);
    expect(isInvestmentRelevant('자사주 소각 결정')).toBe(true);
    expect(isInvestmentRelevant('자기주식처분결정')).toBe(true);
  });

  it('현금배당결정 보고서명을 true로 분류한다', () => {
    expect(isInvestmentRelevant('현금배당 결정')).toBe(true);
    expect(isInvestmentRelevant('현물배당결정')).toBe(true);
    expect(isInvestmentRelevant('배당 결정')).toBe(true);
    expect(isInvestmentRelevant('배당금 지급')).toBe(true);
  });

  it('유상증자 보고서명을 true로 분류한다', () => {
    expect(isInvestmentRelevant('유상증자 결정')).toBe(true);
    expect(isInvestmentRelevant('주주배정 유상증자')).toBe(true);
    expect(isInvestmentRelevant('제3자 배정 증자')).toBe(true);
    expect(isInvestmentRelevant('일반공모 증자')).toBe(true);
  });

  it('전환사채발행 보고서명을 true로 분류한다', () => {
    expect(isInvestmentRelevant('전환사채권발행결정')).toBe(true);
    expect(isInvestmentRelevant('신주인수권부사채발행결정')).toBe(true);
    expect(isInvestmentRelevant('교환사채발행결정')).toBe(true);
    // CB/BW 약어 — 뒤에 공백 또는 괄호가 있어야 매칭
    expect(isInvestmentRelevant('CB (전환사채) 발행결정')).toBe(true);
    expect(isInvestmentRelevant('BW (신주인수권부사채) 발행결정')).toBe(true);
  });

  // ── 비매칭 케이스 ────────────────────────────────────────────────────────

  it('사업보고서(정기공시)를 false로 분류한다', () => {
    expect(isInvestmentRelevant('사업보고서')).toBe(false);
    expect(isInvestmentRelevant('반기보고서')).toBe(false);
    expect(isInvestmentRelevant('분기보고서')).toBe(false);
  });

  it('감사보고서를 false로 분류한다', () => {
    expect(isInvestmentRelevant('감사보고서')).toBe(false);
    expect(isInvestmentRelevant('내부회계관리제도 감사보고서')).toBe(false);
  });

  it('빈 문자열을 false로 분류한다', () => {
    expect(isInvestmentRelevant('')).toBe(false);
  });

  it('합병결정을 false로 분류한다', () => {
    expect(isInvestmentRelevant('합병결정')).toBe(false);
  });

  it('CB가 문자열 중간에 붙어있으면 false로 분류한다 (약어 오탐 방지)', () => {
    // "CB"가 단어 끝 또는 다른 글자에 붙어있는 경우: 매칭하지 않아야 함
    // 패턴: /CB[\s(]/ 이므로 "CB"만 단독으로 붙어있거나 알파벳이 따라오면 미매칭
    expect(isInvestmentRelevant('주식CB발행')).toBe(false);
    expect(isInvestmentRelevant('BCBS규제보고')).toBe(false);
  });
});

describe('classifyInvestmentEventType', () => {
  it('"자기주식 취득 결정"을 SHARE_BUYBACK으로 분류한다', () => {
    expect(classifyInvestmentEventType('자기주식 취득 결정')).toBe('SHARE_BUYBACK');
  });

  it('"자기주식 소각 결정"을 SHARE_CANCELLATION으로 분류한다', () => {
    expect(classifyInvestmentEventType('자기주식 소각 결정')).toBe('SHARE_CANCELLATION');
  });

  it('"자사주 소각 결정"을 SHARE_CANCELLATION으로 분류한다', () => {
    expect(classifyInvestmentEventType('자사주 소각 결정')).toBe('SHARE_CANCELLATION');
  });

  it('"전환사채권발행결정"을 CB_BW_ISSUANCE로 분류한다', () => {
    expect(classifyInvestmentEventType('전환사채권발행결정')).toBe('CB_BW_ISSUANCE');
  });

  it('"신주인수권부사채발행결정"을 CB_BW_ISSUANCE로 분류한다', () => {
    expect(classifyInvestmentEventType('신주인수권부사채발행결정')).toBe('CB_BW_ISSUANCE');
  });

  it('"교환사채발행결정"을 CB_BW_ISSUANCE로 분류한다', () => {
    expect(classifyInvestmentEventType('교환사채발행결정')).toBe('CB_BW_ISSUANCE');
  });

  it('"합병결정"을 null로 분류한다 (투자이벤트 아님)', () => {
    expect(classifyInvestmentEventType('합병결정')).toBeNull();
  });

  it('"사업보고서"를 null로 분류한다 (정기공시)', () => {
    expect(classifyInvestmentEventType('사업보고서')).toBeNull();
  });

  it('빈 문자열을 null로 분류한다', () => {
    expect(classifyInvestmentEventType('')).toBeNull();
  });

  it('"단일판매·공급계약체결"을 SUPPLY_CONTRACT로 분류한다', () => {
    expect(classifyInvestmentEventType('단일판매·공급계약체결')).toBe('SUPPLY_CONTRACT');
  });

  it('"현금배당 결정"을 DIVIDEND로 분류한다', () => {
    expect(classifyInvestmentEventType('현금배당 결정')).toBe('DIVIDEND');
  });

  it('"유상증자 결정"을 PAID_IN_CAPITAL_INCREASE로 분류한다', () => {
    expect(classifyInvestmentEventType('유상증자 결정')).toBe('PAID_IN_CAPITAL_INCREASE');
  });

  it('소각이 취득보다 우선하여 SHARE_CANCELLATION을 반환한다', () => {
    // 소각 조건이 취득 조건보다 먼저 체크되므로 "소각"이 포함되면 SHARE_CANCELLATION
    expect(classifyInvestmentEventType('자기주식소각결정')).toBe('SHARE_CANCELLATION');
  });
});
