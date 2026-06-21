// DAR-212: 포트폴리오 서브탭 정의(순수 모듈, RN 비의존 — 결정론 체크 대상).
//
// 용어 정리: '모의'(paper)와 '모의운용'(sim)이 한 줄에 공존해 둘 다 가상거래라 모호했다.
// 역할 기준으로 재정의한다.
//   - paper: 사용자 본인 모의투자(AI 신호 기반 가상 주문) → '내 모의'
//   - sim:   시스템(엔진)이 일일 사이클로 운용하는 가상 포트폴리오 → '시스템 모의'
// 둘 다 '모의'를 유지해 가상임을 보존하되 '내' vs '시스템'으로 주체를 구분한다.
// '실전'(live)은 실제 주문 엔드포인트가 없어(Engine5 게이트) 항상 빈 상태일 수 있으므로
// 빈 상태를 '준비 중'으로 정직하게 안내한다(매수 유도 CTA 금지).

export type PortfolioSubTab = 'live' | 'paper' | 'sim' | 'strategy' | 'persona' | 'style';

export interface PortfolioTabDef {
  value: PortfolioSubTab;
  label: string;
  a11y: string;
}

// 6개 이하 짧은 라벨이라도 SegmentedButtons 5분할은 라벨이 잘려(과밀) 역할 라벨을 못 담는다.
// 가로 스크롤 칩 행(DAR-156 종목상세·홈 segmentTab 패턴)으로 노출해 역할 라벨 공간을 확보한다.
export const PORTFOLIO_TABS: PortfolioTabDef[] = [
  { value: 'live', label: '실전', a11y: '실전 계좌 탭 — 실제 주문 기능은 준비 중' },
  { value: 'paper', label: '내 모의', a11y: '내 모의투자 탭 — AI 신호 기반 가상 주문' },
  { value: 'sim', label: '시스템 모의', a11y: '시스템 모의운용 탭 — 엔진이 일일 사이클로 운용하는 가상 포트폴리오' },
  // DAR-405: '트레이딩 로직(진입/청산/사이징 룰)' 축 — 거장철학(style)·페르소나와 별개 비교.
  { value: 'strategy', label: '전략', a11y: '시스템 트레이딩 전략 변형 비교 탭 — 진입/청산 룰이 다른 4종 비교' },
  { value: 'persona', label: '페르소나', a11y: '페르소나 트랙 비교 탭' },
  { value: 'style', label: '스타일', a11y: '스타일 성과 비교 탭' },
];

/**
 * 실전 탭 빈 상태 분기(순수).
 * 보유 포지션이 0건이면 실제 주문 부재라 '준비 중'(preparing)을 안내하고,
 * 포지션은 있으나 검색 필터로 비면 'noSearchResult'를 보여준다.
 */
export function pickLiveEmptyState(totalPositions: number): 'preparing' | 'noSearchResult' {
  return totalPositions === 0 ? 'preparing' : 'noSearchResult';
}
