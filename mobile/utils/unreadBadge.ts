// DAR-216: 미읽음 배지 표시 라벨 단일 규칙.
// 탭 배지(_layout)와 홈 헤더 배지가 동일한 포맷을 쓰도록 한 곳에서 결정한다.
// 0 이하 → 미표시(undefined), 99 초과 → '99+', 그 외 숫자 문자열.
export function formatUnreadBadge(count: number | undefined | null): string | undefined {
  if (!count || count <= 0) return undefined;
  return count > 99 ? '99+' : String(count);
}
