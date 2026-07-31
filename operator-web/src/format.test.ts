import { describe, expect, it } from 'vitest';
import { formatMoney, shortHash, statusTone } from './format';

describe('operator format', () => {
  it('큰 금액과 긴 hash를 폭 제한 표기로 바꾼다', () => {
    expect(formatMoney(20_000_000)).toContain('20,000,000');
    expect(shortHash('1234567890abcdefghijkl')).toBe('12345678…ijkl');
  });

  it('위험 상태는 의미 기반 tone으로 분류한다', () => {
    expect(statusTone('BROKEN')).toBe('bad');
    expect(statusTone('MATCHED')).toBe('good');
  });
});
