import { Feather } from '@expo/vector-icons';

// 빈 상태 마이크로카피 정본 테이블 — 기획 ux-detail-plan.md §2-2 표(16종) 1:1 매핑.
// 화면은 이 테이블의 key를 import 해 EmptyState에 전달한다(액션 onPress는 화면이 주입).
// 카피 문구를 바꿀 일이 생기면 반드시 이 파일만 수정해 전수 일관성을 유지한다.

export interface EmptyStateCopy {
  icon: keyof typeof Feather.glyphMap;
  title: string;
  description?: string;
  /** 보조 액션 버튼 라벨. onPress는 화면에서 주입. */
  actionLabel?: string;
}

export const emptyStateCopy = {
  // 홈 피드 (관심기업 없음)
  homeWatchlistEmpty: {
    icon: 'star',
    title: '관심 기업을 추가하면 맞춤 공시를 보여드려요',
    actionLabel: '관심 기업 추가',
  },
  // 홈 피드 (공시 없음)
  homeDisclosureEmpty: {
    icon: 'clock',
    title: '오늘 공시가 아직 없어요. 장 시간 중 업데이트됩니다',
  },
  // 공시 목록 (필터 결과 없음)
  disclosureFilterEmpty: {
    icon: 'filter',
    title: '선택한 필터에 맞는 공시가 없어요',
    actionLabel: '필터 초기화',
  },
  // 알림 피드 (로그인 전)
  notificationsGuest: {
    icon: 'bell',
    title: '로그인하고 알림을 받아보세요',
    actionLabel: '로그인',
  },
  // 알림 피드 (알림 없음)
  notificationsEmpty: {
    icon: 'bell-off',
    title: '알림이 아직 없어요. 공시가 발생하면 바로 알려드릴게요',
  },
  // 신호 피드 (관심기업 없음)
  signalsWatchlistEmpty: {
    icon: 'trending-up',
    title: '관심 기업을 추가하면 매수 신호를 알려드려요',
    actionLabel: '관심 기업 추가',
  },
  // 신호 피드 (신호 없음)
  signalsBuyEmpty: {
    icon: 'zap-off',
    title: '현재 조건에 맞는 신호가 없어요. 새 공시 발생 시 알려드릴게요',
  },
  // 신호 피드 (필터 결과 없음)
  signalsFilterEmpty: {
    icon: 'sliders',
    title: '선택한 조건에 맞는 신호가 없어요',
    actionLabel: '필터 초기화',
  },
  // 분석 탐색 (전체 신호 없음 — 표본/분석 대기)
  signalsExploreEmpty: {
    icon: 'compass',
    title: '아직 분석할 신호가 없어요',
    description: '새 공시가 분석되면 등급과 점수가 여기에 쌓여요',
  },
  // 포트폴리오 (포지션 없음)
  portfolioEmpty: {
    icon: 'briefcase',
    title: '보유 종목이 없어요. 매수 후보 탭에서 신호를 확인해 보세요',
    actionLabel: '신호 탭으로',
  },
  // 매도 신호 (없음)
  exitSignalsEmpty: {
    icon: 'shield',
    title: '매도 신호가 없어요. 모든 포지션이 안전 구간에 있어요',
  },
  // 저장된 공시 (없음)
  savedDisclosuresEmpty: {
    icon: 'bookmark',
    title: '저장된 공시가 없어요. 공시 상세에서 북마크 버튼을 탭해 보세요',
  },
  // 관심목록 (없음)
  watchlistEmpty: {
    icon: 'star',
    title: '아직 관심 기업이 없어요. 검색해서 추가해 보세요',
    actionLabel: '기업 검색',
  },
  // 주문 승인 대기 (없음)
  ordersPendingEmpty: {
    icon: 'check-circle',
    title: '대기 중인 주문안이 없어요',
  },
  // 주문 이력 (없음)
  ordersHistoryEmpty: {
    icon: 'clock',
    title: '아직 처리된 주문이 없어요',
  },
  // AI 비용 (데이터 없음)
  aiCostEmpty: {
    icon: 'cpu',
    title: 'AI 분석이 아직 실행되지 않았어요',
  },
  // 모의투자 (시작 전)
  paperTradingEmpty: {
    icon: 'play-circle',
    title: '모의투자를 시작하면 AI 신호 기반 가상 주문이 진행돼요',
    actionLabel: '시작하기',
  },
} satisfies Record<string, EmptyStateCopy>;

export type EmptyStateKey = keyof typeof emptyStateCopy;
