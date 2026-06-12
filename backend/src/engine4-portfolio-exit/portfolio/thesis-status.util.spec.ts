import { mapThesisStatus } from './thesis-status.util';

describe('mapThesisStatus', () => {
  it('INVALIDATED(논리 훼손) → VIOLATED', () => {
    expect(mapThesisStatus('INVALIDATED')).toBe('VIOLATED');
  });

  it('CLOSED(청산 완료) → EXPIRED', () => {
    expect(mapThesisStatus('CLOSED')).toBe('EXPIRED');
  });

  it('ACTIVE → ACTIVE', () => {
    expect(mapThesisStatus('ACTIVE')).toBe('ACTIVE');
  });

  it('thesis 미연결(null/undefined) → ACTIVE 기본값', () => {
    expect(mapThesisStatus(null)).toBe('ACTIVE');
    expect(mapThesisStatus(undefined)).toBe('ACTIVE');
  });

  it('알 수 없는 값 → ACTIVE 기본값(throw 금지)', () => {
    expect(mapThesisStatus('SOMETHING_ELSE')).toBe('ACTIVE');
  });

  it('WATCHING은 DB 상태로 표현되지 않으므로 절대 산출하지 않는다', () => {
    const inputs = ['ACTIVE', 'INVALIDATED', 'CLOSED', null, undefined, 'x'];
    for (const s of inputs) {
      expect(mapThesisStatus(s)).not.toBe('WATCHING');
    }
  });
});
