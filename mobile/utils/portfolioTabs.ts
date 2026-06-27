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

// DAR-451: 6서브탭이 구분 안내 없이 병렬 노출돼 신규 사용자가 길을 잃는다(C1).
// 탭을 주체 기준 2그룹으로 묶어 진입 오리엔테이션을 제공한다(탭 수는 보존 — 각 탭이
// 별개 기능 표면이라 축소 시 기능 상실).
//   - mine:   사용자 본인 포트폴리오(실전·내 모의) → '내 운용'
//   - system: 시스템(엔진)이 운용/비교하는 검증 트랙(시스템 모의·전략·페르소나·스타일) → '시스템 검증'
export type PortfolioTabGroup = 'mine' | 'system';

export const PORTFOLIO_TAB_GROUPS: Record<PortfolioTabGroup, string> = {
  mine: '내 운용',
  system: '시스템 검증',
};

export interface PortfolioTabDef {
  value: PortfolioSubTab;
  label: string;
  a11y: string;
  group: PortfolioTabGroup;
}

// 6개 이하 짧은 라벨이라도 SegmentedButtons 5분할은 라벨이 잘려(과밀) 역할 라벨을 못 담는다.
// 가로 스크롤 칩 행(DAR-156 종목상세·홈 segmentTab 패턴)으로 노출해 역할 라벨 공간을 확보한다.
// DAR-451: 동일 그룹 탭은 인접 배치(렌더 시 그룹 머릿글 1회 삽입) — group 순서가 곧 표시 순서.
export const PORTFOLIO_TABS: PortfolioTabDef[] = [
  { value: 'live', label: '실전', a11y: '내 운용 — 실전 계좌 탭, 실제 주문 기능은 준비 중', group: 'mine' },
  { value: 'paper', label: '내 모의', a11y: '내 운용 — 내 모의투자 탭, AI 신호 기반 가상 주문', group: 'mine' },
  { value: 'sim', label: '시스템 모의', a11y: '시스템 검증 — 시스템 모의운용 탭, 엔진이 일일 사이클로 운용하는 가상 포트폴리오', group: 'system' },
  // DAR-405: '트레이딩 로직(진입/청산/사이징 룰)' 축 — 거장철학(style)·페르소나와 별개 비교.
  { value: 'strategy', label: '전략', a11y: '시스템 검증 — 시스템 트레이딩 전략 변형 비교 탭, 진입/청산 룰이 다른 4종 비교', group: 'system' },
  { value: 'persona', label: '페르소나', a11y: '시스템 검증 — 페르소나 트랙 비교 탭', group: 'system' },
  { value: 'style', label: '스타일', a11y: '시스템 검증 — 스타일 성과 비교 탭', group: 'system' },
];

export interface PortfolioTabGroupDef {
  group: PortfolioTabGroup;
  label: string;
  tabs: PortfolioTabDef[];
}

/**
 * 탭을 group 순서대로 묶어 머릿글 + 소속 칩 묶음으로 반환한다(순수, DAR-451).
 *
 * 가로 스크롤 칩 행이 "내 운용 [실전][내 모의]  시스템 검증 [시스템 모의]…"처럼 그룹
 * 머릿글을 1회만 끼워 렌더하도록 PORTFOLIO_TABS의 등장 순서를 보존해 연속 구간으로 분할한다.
 * (동일 group이 비인접하면 그룹이 쪼개져 여러 머릿글이 생기므로 PORTFOLIO_TABS는 그룹별 인접 유지.)
 */
export function groupedPortfolioTabs(): PortfolioTabGroupDef[] {
  const groups: PortfolioTabGroupDef[] = [];
  for (const tab of PORTFOLIO_TABS) {
    const last = groups[groups.length - 1];
    if (last && last.group === tab.group) {
      last.tabs.push(tab);
    } else {
      groups.push({ group: tab.group, label: PORTFOLIO_TAB_GROUPS[tab.group], tabs: [tab] });
    }
  }
  return groups;
}

const TAB_VALUES: ReadonlySet<string> = new Set(PORTFOLIO_TABS.map((t) => t.value));

/**
 * 딥링크 쿼리(`/portfolio?tab=sim`)의 `tab` 파라미터 → 유효 서브탭(순수, DAR-431).
 *
 * 체결 알림(시스템 모의 등)이 트랙 서브탭으로 직행하도록 진입 시 초기 탭을 결정한다.
 * 허용 목록(PORTFOLIO_TABS) 밖 값·미지정은 기본 탭(`live`)으로 안전 폴백한다
 * (임의 라우팅 방지 — 신뢰 경계).
 */
export function resolveInitialSubTab(tab: unknown): PortfolioSubTab {
  return typeof tab === 'string' && TAB_VALUES.has(tab) ? (tab as PortfolioSubTab) : 'live';
}

/**
 * 실전 탭 빈 상태 분기(순수).
 * 보유 포지션이 0건이면 실제 주문 부재라 '준비 중'(preparing)을 안내하고,
 * 포지션은 있으나 검색 필터로 비면 'noSearchResult'를 보여준다.
 */
export function pickLiveEmptyState(totalPositions: number): 'preparing' | 'noSearchResult' {
  return totalPositions === 0 ? 'preparing' : 'noSearchResult';
}
