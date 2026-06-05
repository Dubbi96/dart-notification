// Snackbar/Toast 마이크로카피 정본 — 기획 ux-detail-plan.md §3-1 표 1:1 매핑.
// 성공 2.5초, 실패 4초(§3-1). 호출부는 이 테이블을 통해 문구를 통일한다.

export const SNACKBAR_DURATION = {
  success: 2500,
  error: 4000,
} as const;

export const snackbarCopy = {
  // 관심기업 추가/제거 (SearchOverlay는 Part A에서 동일 문구로 적용 완료)
  watchlistAdded: (name: string) => `${name}을(를) 관심목록에 추가했어요.`,
  watchlistRemoved: (name: string) => `${name}을(를) 관심목록에서 제거했어요.`,
  watchlistAddFailed: '추가에 실패했어요. 다시 시도해 주세요.',
  // 공시 저장 / 저장 취소
  disclosureSaved: '공시를 저장했어요.',
  disclosureSaveFailed: '저장에 실패했어요.',
  disclosureUnsaved: '저장된 공시에서 제거했어요.',
  // 알림 전체 읽음
  allNotificationsRead: (count: number) => `${count}개의 알림을 모두 읽었어요.`,
  // 링크 복사
  linkCopied: '링크를 복사했어요.',
} as const;
