import { parsePaginationInt } from './parse-pagination';

describe('parsePaginationInt (DAR-273)', () => {
  describe('정상 입력은 동작 동일', () => {
    it.each([
      ['20', 20],
      ['1', 1],
      ['100', 100],
      [' 42 ', 42], // 앞뒤 공백 허용
    ])('"%s" → %i', (raw, expected) => {
      expect(parsePaginationInt(raw, { default: 20, min: 1, max: 100 })).toBe(expected);
    });

    it('number 타입 입력도 그대로 보정한다', () => {
      expect(parsePaginationInt(50, { default: 20, min: 1, max: 100 })).toBe(50);
    });

    it('소수는 floor 한다', () => {
      expect(parsePaginationInt('20.9', { default: 20, min: 1, max: 100 })).toBe(20);
    });
  });

  describe('DoD: 잘못된 입력 안전화', () => {
    it('?limit=abc → default (NaN 누출 없음)', () => {
      expect(parsePaginationInt('abc', { default: 20, min: 1, max: 100 })).toBe(20);
    });

    it('?limit=-5 → min', () => {
      expect(parsePaginationInt('-5', { default: 20, min: 1, max: 100 })).toBe(1);
    });

    it('?limit=99999999 → max', () => {
      expect(parsePaginationInt('99999999', { default: 20, min: 1, max: 100 })).toBe(100);
    });

    it('0 → min (take:0 방지)', () => {
      expect(parsePaginationInt('0', { default: 20, min: 1, max: 100 })).toBe(1);
    });

    it('숫자 뒤 잡문자("20abc") → default (부분 파싱 금지)', () => {
      expect(parsePaginationInt('20abc', { default: 20, min: 1, max: 100 })).toBe(20);
    });

    it.each(['', '   ', undefined, null, NaN, Infinity, {}, []])(
      '무효값 %p → default',
      (raw) => {
        expect(parsePaginationInt(raw, { default: 20, min: 1, max: 100 })).toBe(20);
      },
    );
  });

  describe('default 미지정', () => {
    it('무효 입력 → undefined (미지정·무제한 의미 보존)', () => {
      expect(parsePaginationInt('abc', {})).toBeUndefined();
      expect(parsePaginationInt(undefined, {})).toBeUndefined();
    });

    it('유효 입력은 정수로(min 1) 보정', () => {
      expect(parsePaginationInt('7', {})).toBe(7);
      expect(parsePaginationInt('-3', {})).toBe(1);
    });

    it('max 미지정 시 상한 없음 (캡 해제 의미 보존)', () => {
      expect(parsePaginationInt('99999999', {})).toBe(99999999);
    });
  });

  describe('offset (min 0)', () => {
    it('음수 offset → 0', () => {
      expect(parsePaginationInt('-5', { default: 0, min: 0 })).toBe(0);
    });

    it('비숫자 offset → default 0', () => {
      expect(parsePaginationInt('abc', { default: 0, min: 0 })).toBe(0);
    });

    it('정상 offset 통과', () => {
      expect(parsePaginationInt('40', { default: 0, min: 0 })).toBe(40);
    });
  });
});
