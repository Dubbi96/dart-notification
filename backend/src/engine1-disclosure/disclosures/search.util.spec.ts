import {
  tokenize,
  normalizePeriod,
  scoreDisclosure,
  compareRecency,
  type ScorableDisclosure,
} from './search.util';

describe('search.util (DAR-45 SEO식 검색)', () => {
  describe('tokenize', () => {
    it('공백 단위로 분해한다', () => {
      expect(tokenize('삼성 유상증자')).toEqual(['삼성', '유상증자']);
    });

    it('연속 공백·앞뒤 공백을 정리한다', () => {
      expect(tokenize('  삼성   유상증자 ')).toEqual(['삼성', '유상증자']);
    });

    it('소문자로 정규화하고 중복을 제거한다', () => {
      expect(tokenize('AB ab CD')).toEqual(['ab', 'cd']);
    });

    it('빈/undefined 입력은 빈 배열', () => {
      expect(tokenize('')).toEqual([]);
      expect(tokenize('   ')).toEqual([]);
      expect(tokenize(undefined)).toEqual([]);
    });
  });

  describe('normalizePeriod', () => {
    it('from만 있으면 gte만', () => {
      expect(normalizePeriod('20240101', undefined)).toEqual({ gte: '20240101' });
    });

    it('to 8자리는 그날 끝까지 포함하도록 999999를 덧붙인다', () => {
      expect(normalizePeriod(undefined, '20241231')).toEqual({ lte: '20241231999999' });
    });

    it('to 보정값은 그날의 타임스탬프(YYYYMMDDHHmmss)보다 사전식으로 크거나 같다', () => {
      const { lte } = normalizePeriod(undefined, '20241231')!;
      expect('20241231235959' <= lte!).toBe(true);
      expect('20250101000000' <= lte!).toBe(false);
    });

    it('둘 다 없으면 undefined', () => {
      expect(normalizePeriod(undefined, undefined)).toBeUndefined();
    });
  });

  describe('scoreDisclosure', () => {
    const base: ScorableDisclosure = {
      reportName: '단일판매·공급계약 체결',
      corpName: '삼성전자',
      flrName: '삼성전자',
      stockCode: '005930',
      rcpDt: '20240101',
    };

    it('기업명 정확 일치에 최고 가중치', () => {
      const exact = scoreDisclosure(base, tokenize('삼성전자'), '삼성전자');
      const partial = scoreDisclosure(base, tokenize('삼성'), '삼성');
      expect(exact).toBeGreaterThan(partial);
    });

    it('종목코드 정확 일치를 가점한다', () => {
      const score = scoreDisclosure(base, tokenize('005930'), '005930');
      expect(score).toBeGreaterThan(0);
    });

    it('매칭 토큰이 많을수록 점수가 높다', () => {
      const one = scoreDisclosure(base, tokenize('공급'), '공급');
      const two = scoreDisclosure(base, tokenize('삼성 공급'), '삼성 공급');
      expect(two).toBeGreaterThan(one);
    });

    it('아무 필드도 매칭 안 되면 0', () => {
      expect(scoreDisclosure(base, tokenize('현대'), '현대')).toBe(0);
    });
  });

  describe('compareRecency', () => {
    it('rcpDt 내림차순 정렬', () => {
      const rows = [
        { rcpDt: '20240101', rcpNo: '1' },
        { rcpDt: '20240301', rcpNo: '2' },
        { rcpDt: '20240201', rcpNo: '3' },
      ];
      expect(rows.sort(compareRecency).map((r) => r.rcpNo)).toEqual(['2', '3', '1']);
    });

    it('동일 rcpDt는 rcpNo 내림차순', () => {
      const rows = [
        { rcpDt: '20240101', rcpNo: '100' },
        { rcpDt: '20240101', rcpNo: '200' },
      ];
      expect(rows.sort(compareRecency).map((r) => r.rcpNo)).toEqual(['200', '100']);
    });
  });
});
