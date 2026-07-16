import { Feather } from '@expo/vector-icons';

// 게스트(비로그인) 로그인 유도 카피 정본 테이블(DAR-113).
// 인증 필요(401) 화면/섹션이 빈 화면·에러 대신 이 카피로 GuestPrompt를 렌더한다.
// 정직 원칙: 과대약속 금지 — 실제 제공 기능만, 투자판단은 '참고용' 명시.
// 카피 변경은 반드시 이 파일에서만 수정해 전수 일관성을 유지한다.

export interface GuestPromptCopy {
  icon: keyof typeof Feather.glyphMap;
  title: string;
  description?: string;
  /** 로그인 시 열리는 가치 항목(정직 프리뷰). screen variant에서만 노출. */
  benefits?: string[];
  /** 로그인 CTA 라벨. onPress는 화면/컴포넌트에서 주입(기본 sign-in 이동). */
  ctaLabel?: string;
}

export const guestPromptCopy = {
  // 홈 투자판단 프리뷰 슬롯(401) — 슬롯 내 카드(card variant).
  homeSignalPreview: {
    icon: 'compass',
    title: '로그인하면 최신 투자판단을 볼 수 있어요',
    description: '공시에서 찾은 상위 매수 신호를 점수와 함께 확인하세요. (참고용)',
    ctaLabel: '로그인',
  },
  // 신호 탭(매수·매도, 401) — 전체화면(screen variant).
  signals: {
    icon: 'trending-up',
    title: '로그인하면 매수·매도 신호를 볼 수 있어요',
    description: '공시 기반 신호의 등급과 점수를 확인하세요. 투자 판단은 참고용입니다.',
    benefits: ['공시에서 찾은 매수 신호와 등급·점수', '보유 종목의 매도(청산) 점검 신호'],
    ctaLabel: '로그인',
  },
  // 포트폴리오 탭(401) — 전체화면(screen variant).
  portfolio: {
    icon: 'briefcase',
    title: '로그인하면 포트폴리오를 관리할 수 있어요',
    description: '보유·모의 종목의 손익과 청산 점검을 한곳에서 확인하세요.',
    benefits: ['보유 종목 손익과 평가금액', '논거 훼손·손절 임박 포지션 점검'],
    ctaLabel: '로그인',
  },
  // 알림 탭(401) — 전체화면(screen variant).
  notifications: {
    icon: 'bell',
    title: '로그인하면 알림을 받아볼 수 있어요',
    description: '관심 공시와 신호 알림을 놓치지 않게 보내드려요.',
    ctaLabel: '로그인',
  },
} satisfies Record<string, GuestPromptCopy>;

export type GuestPromptKey = keyof typeof guestPromptCopy;
