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
  // 알림 피드 (알림 없음) — 갭분석 W7·W6 포지셔닝: 공시온은 DART 1차 원문 기반(뉴스는
  // 시차·누락 있는 2차 채널). 이 키만 수정(W10 레인과 파일 공유 — 다른 키 불가침).
  notificationsEmpty: {
    icon: 'bell-off',
    title: '알림이 아직 없어요. 공시가 발생하면 바로 알려드릴게요',
    description:
      '공시온 알림은 DART 1차 원문 기반이에요. 뉴스는 시차·누락이 있는 2차 채널이라, 원문 공시를 기준으로 정확하게 알려드려요',
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
  // 홈 '오늘의 투자판단' 프리뷰 (매수등급 0 — 가짜 BUY 금지, 점수순 탐색 유도)
  homeSignalPreviewEmpty: {
    icon: 'compass',
    title: '아직 매수등급 신호가 없어요',
    description: '가짜 매수 신호 대신, 점수순으로 전체 신호를 살펴보세요',
    actionLabel: '점수순 탐색',
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
  // 매도 신호 (없음 — 보유 포지션 있음). UXR(B-9): '모든 포지션이 안전' 단정 금지(과신 방지)
  // → 검증 가능한 사실('현재 신호 없음')만 참고 어휘로 서술.
  exitSignalsEmpty: {
    icon: 'shield',
    title: '현재 매도 신호가 없어요',
    description: '보유 포지션에 청산 신호가 잡히면 여기에 표시돼요 (참고 정보)',
  },
  // 매도 신호 (보유 포지션 0 — 평가 대상 자체가 없음). UXR(B-9): 신규 사용자에게
  // 검증 불가한 안심 문구 대신 매수 탐색 동선을 안내(onAction=매수 탭 전환).
  exitSignalsNoPositions: {
    icon: 'briefcase',
    title: '보유 종목이 없어요',
    description: '매도 신호는 보유 포지션 기준으로 평가돼요. 매수 탐색에서 시작해 보세요',
    actionLabel: '매수 탐색으로',
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
  // AI 비용 (데이터 없음)
  aiCostEmpty: {
    icon: 'cpu',
    title: 'AI 분석이 아직 실행되지 않았어요',
  },
  // AI 심층 분석 카드 — 대기 (W10 기대치 관리 UX: 대상 이벤트는 추출됐고 분석이 아직 미생성).
  // 고정 분 단위 SLA 약속 금지 — '순차 생성 + 예산 도달 시 익일 02:00 백필'까지만 정직하게 표기.
  aiAnalysisPending: {
    icon: 'clock',
    title: 'AI 분석 대기 중이에요',
    description: '공시 후 순차적으로 생성되며, 예산 도달 시 익일 02:00 백필로 채워져요',
  },
  // AI 심층 분석 카드 — 비대상 (이벤트 미추출 공시: '대기'와 구분해 헛기다림 방지).
  aiAnalysisExcluded: {
    icon: 'cpu',
    title: '이 공시는 AI 심층 분석 대상이 아니에요',
    description: 'AI 심층 분석은 투자 이벤트가 추출된 공시에 한해 생성돼요',
  },
  // 모의투자 (시작 전)
  paperTradingEmpty: {
    icon: 'play-circle',
    title: '모의투자를 시작하면 AI 신호 기반 가상 주문이 진행돼요',
    actionLabel: '시작하기',
  },
  // 모의투자 (시작했으나 실행된 신호 0)
  paperTradingNoSignalsEmpty: {
    icon: 'activity',
    title: '아직 실행된 모의투자 신호가 없어요',
  },
  // 투자거장 철학 (id 미존재 — 에러 아님)
  philosophyNotFound: {
    icon: 'book-open',
    title: '해당 거장 철학을 찾을 수 없어요',
  },
} satisfies Record<string, EmptyStateCopy>;

export type EmptyStateKey = keyof typeof emptyStateCopy;
