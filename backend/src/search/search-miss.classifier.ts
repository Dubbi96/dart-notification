/**
 * 갭분석 W8 — 제로결과 검색어 태그 분류기.
 *
 * '검색 실패 중 미국종목 비율'을 상시 계측해 M13A-Lite(미국 워치리스트 알림)
 * 착수 게이트의 수요 실증 데이터로 쓴다. 분류는 순수 함수(Rule, L0)이며 AI 미사용.
 *
 * 태그 정의 (SearchMissLog.tag):
 * - US_TICKER    : 영문 티커 패턴(AAPL/TSLA 등 대문자 1~5자) 정확 일치
 * - US_NAME_KO   : 한글 미국종목명 사전(상위 ~30) 매칭
 * - US_DEMAND_TAP: 모바일 빈 상태 '미국 주식 알림' 원탭 수요 버튼 (분류기가 아니라 엔드포인트가 부여)
 * - OTHER        : 그 외 제로결과
 */

export const SEARCH_MISS_TAG = {
  US_TICKER: 'US_TICKER',
  US_NAME_KO: 'US_NAME_KO',
  US_DEMAND_TAP: 'US_DEMAND_TAP',
  OTHER: 'OTHER',
} as const;

export type SearchMissTag = (typeof SEARCH_MISS_TAG)[keyof typeof SEARCH_MISS_TAG];

/**
 * 영문 티커 패턴 — 대문자 1~5자 정확 일치(스펙 정본).
 * 소문자(kakao 등 일반 영단어 5자)까지 승격하면 오탐이 커져 대소문자 정규화는 하지 않는다.
 */
export const US_TICKER_PATTERN = /^[A-Z]{1,5}$/;

/**
 * 한글 미국종목명 사전 (국내 투자자 보유 상위 ~30) — 부분일치(contains) 허용.
 * "테슬라 주가"처럼 수식어가 붙은 검색어도 잡는다.
 * 제로결과 검색어에만 적용되므로(국내 종목이 검색되면 애초에 로깅 안 됨) 오탐 여지가 작다.
 */
export const US_STOCK_NAMES_KO_CONTAINS: readonly string[] = [
  '테슬라',
  '엔비디아',
  '애플',
  '마이크로소프트',
  '아마존',
  '구글',
  '알파벳',
  '페이스북',
  '넷플릭스',
  '팔란티어',
  '브로드컴',
  '퀄컴',
  '마이크론',
  '코카콜라',
  '스타벅스',
  '맥도날드',
  '나이키',
  '디즈니',
  '마스터카드',
  '페이팔',
  '버크셔',
  '일라이릴리',
  '화이자',
  '엑슨모빌',
  '보잉',
  '코스트코',
  '월마트',
  '코인베이스',
  '리비안',
  '아이온큐',
];

/**
 * 짧아서 국내 종목명과 접두 충돌하는 이름은 정확 일치만 허용.
 * (예: '인텔' contains → '인텔리안테크' 오타 검색 오탐, '메타' → 메타* 국내 종목군)
 */
export const US_STOCK_NAMES_KO_EXACT: readonly string[] = ['메타', '인텔', '비자'];

/**
 * 제로결과 검색어를 US_TICKER / US_NAME_KO / OTHER 로 분류한다.
 * US_DEMAND_TAP 은 이 함수가 아니라 수요 버튼 엔드포인트에서 직접 부여한다.
 */
export function classifySearchMiss(query: string): SearchMissTag {
  const term = (query ?? '').trim();
  if (term.length === 0) return SEARCH_MISS_TAG.OTHER;

  if (US_TICKER_PATTERN.test(term)) return SEARCH_MISS_TAG.US_TICKER;

  if (US_STOCK_NAMES_KO_EXACT.includes(term)) return SEARCH_MISS_TAG.US_NAME_KO;
  if (US_STOCK_NAMES_KO_CONTAINS.some((name) => term.includes(name))) {
    return SEARCH_MISS_TAG.US_NAME_KO;
  }

  return SEARCH_MISS_TAG.OTHER;
}
