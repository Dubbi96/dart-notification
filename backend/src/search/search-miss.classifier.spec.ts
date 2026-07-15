import {
  classifySearchMiss,
  SEARCH_MISS_TAG,
  US_STOCK_NAMES_KO_CONTAINS,
  US_STOCK_NAMES_KO_EXACT,
} from './search-miss.classifier';

describe('classifySearchMiss (갭분석 W8 제로결과 태그 분류기)', () => {
  describe('US_TICKER — 영문 대문자 1~5자 정확 일치', () => {
    it.each(['AAPL', 'TSLA', 'NVDA', 'F', 'GOOGL'])(
      '%s → US_TICKER',
      (q) => {
        expect(classifySearchMiss(q)).toBe(SEARCH_MISS_TAG.US_TICKER);
      },
    );

    it('앞뒤 공백은 제거 후 판정한다', () => {
      expect(classifySearchMiss('  MSFT  ')).toBe(SEARCH_MISS_TAG.US_TICKER);
    });

    it('6자 이상 대문자는 티커가 아니다', () => {
      expect(classifySearchMiss('GOOGLE')).toBe(SEARCH_MISS_TAG.OTHER);
    });

    it('소문자 영단어(kakao 등 일반어 오탐 방지)는 승격하지 않는다', () => {
      expect(classifySearchMiss('kakao')).toBe(SEARCH_MISS_TAG.OTHER);
      expect(classifySearchMiss('tsla')).toBe(SEARCH_MISS_TAG.OTHER);
    });

    it('영숫자 혼합·공백 포함은 티커 패턴이 아니다', () => {
      expect(classifySearchMiss('AAPL 주가')).toBe(SEARCH_MISS_TAG.OTHER);
      expect(classifySearchMiss('BRK2')).toBe(SEARCH_MISS_TAG.OTHER);
    });
  });

  describe('US_NAME_KO — 한글 미국종목명 사전', () => {
    it.each(['테슬라', '엔비디아', '애플', '팔란티어', '마이크로소프트'])(
      '%s → US_NAME_KO',
      (q) => {
        expect(classifySearchMiss(q)).toBe(SEARCH_MISS_TAG.US_NAME_KO);
      },
    );

    it('수식어가 붙은 검색어(테슬라 주가)도 contains 로 잡는다', () => {
      expect(classifySearchMiss('테슬라 주가')).toBe(SEARCH_MISS_TAG.US_NAME_KO);
      expect(classifySearchMiss('엔비디아 공시')).toBe(SEARCH_MISS_TAG.US_NAME_KO);
    });

    it('짧은 이름(메타·인텔·비자)은 정확 일치만 허용한다', () => {
      expect(classifySearchMiss('메타')).toBe(SEARCH_MISS_TAG.US_NAME_KO);
      expect(classifySearchMiss('인텔')).toBe(SEARCH_MISS_TAG.US_NAME_KO);
      expect(classifySearchMiss('비자')).toBe(SEARCH_MISS_TAG.US_NAME_KO);
      // 국내 종목 접두 충돌 — 오탐 방지
      expect(classifySearchMiss('메타랩스')).toBe(SEARCH_MISS_TAG.OTHER);
      expect(classifySearchMiss('인텔리안')).toBe(SEARCH_MISS_TAG.OTHER);
    });

    it('사전은 상위 ~30 규모를 유지한다 (계측 사전 회귀 가드)', () => {
      expect(US_STOCK_NAMES_KO_CONTAINS.length).toBeGreaterThanOrEqual(25);
      expect(
        US_STOCK_NAMES_KO_CONTAINS.length + US_STOCK_NAMES_KO_EXACT.length,
      ).toBeLessThanOrEqual(40);
    });
  });

  describe('OTHER — 그 외 제로결과', () => {
    it.each(['삼송전자', '없는회사이름', '005935X', '히토츠바시'])(
      '%s → OTHER',
      (q) => {
        expect(classifySearchMiss(q)).toBe(SEARCH_MISS_TAG.OTHER);
      },
    );

    it('빈 문자열·공백만인 입력은 OTHER 로 안전 처리한다', () => {
      expect(classifySearchMiss('')).toBe(SEARCH_MISS_TAG.OTHER);
      expect(classifySearchMiss('   ')).toBe(SEARCH_MISS_TAG.OTHER);
    });
  });
});
