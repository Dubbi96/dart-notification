// DAR-547: 신호탭 에디션 뷰 상단 '에디션 알림 옵트인' 배너 — 순수 로직/카피 SSOT.
//
// 에디션 푸시(DAR-523)는 기본 OFF 옵트인이라 발견성이 0이면 기능이 죽는다. 신호탭 에디션 뷰
// 상단 배너로 '1탭 ON' 동선(editionPushEnabled=true 인라인 토글)을 제공하되, dismiss 는
// SecureStore 로 영속하고 이미 켠 사용자에겐 재노출하지 않는다(재강요 금지·1회성 규약).
// 카피·노출 조건을 여기(RN 무의존)에 모아 두어 jest 단위 테스트와 결정론 가드가 동일 SSOT 를
// 참조하게 한다(컴포넌트에 하드코딩 시 문구·조건 드리프트 차단).

export const EDITION_OPT_IN_BANNER = {
  /** 배너 제목 — 발행 시각(매일 저녁 7시)을 명시해 기대치를 관리한다. */
  title: '매일 저녁 7시, 그날의 투자판단 에디션',
  /** 보조 설명 — 옵트인 가치. 단정·FOMO 금지, '참고' 톤 유지. */
  description: '하루의 매수·매도 판단을 정리한 에디션을 알림으로 받아보세요.',
  /** 인라인 켜기 CTA(1탭 ON). */
  enableLabel: '알림 받기',
  /** 닫기 a11y 라벨(1회성 규약 — 재강요 금지). */
  dismissA11yLabel: '에디션 알림 안내 닫기',
  /** 켜짐 확인 다이얼로그(정직한 기대치 — 발행 시각·내용). */
  confirmTitle: '에디션 알림을 켰어요',
  confirmMessage: '매일 저녁 7시, 그날의 투자판단 에디션을 알림으로 보내드려요.',
  /** 켜기 실패 시 안내(비차단·재시도 유도). */
  errorTitle: '알림을 켜지 못했어요',
  errorMessage: '잠시 후 다시 시도해 주세요.',
} as const;

export interface EditionOptInBannerState {
  /** SecureStore dismiss 로딩 상태: null=로딩, false=미해제(노출 가능), true=해제(숨김). */
  dismissed: boolean | null;
  /** 알림 설정 로드 완료 여부 — 미로드 시 미노출(이미 ON 인지 알 수 없어 깜빡임 방지). */
  settingsLoaded: boolean;
  /** 이미 에디션 푸시가 ON 이면 재권유하지 않는다(재강요 금지). */
  editionPushEnabled: boolean;
}

// 노출 조건(전부 참일 때만 배너 렌더):
//  1) dismiss 상태 로드 완료 & 미해제(dismissed === false) — 로딩(null)/해제(true) 시 미노출
//  2) 알림 설정 로드 완료 — 미로드 상태에서 띄웠다가 곧 숨기는 깜빡임 방지
//  3) 아직 에디션 푸시 OFF — 이미 켠 사용자에겐 노출하지 않음
export function shouldShowEditionOptInBanner(state: EditionOptInBannerState): boolean {
  return state.dismissed === false && state.settingsLoaded && !state.editionPushEnabled;
}
