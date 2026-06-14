// 공시(rcpNo) → 매수 신호 역링크(DAR-208) 순수 로직.
// 공시 상세 AI섹션의 '이 공시의 매수 신호 보기' 진입 카드가 노출/이동을 결정하는 단일 출처.

import type { CompanySignalBadge } from '@app-types/signal.types';

/**
 * 진입 카드가 이동할 신호 상세 경로를 반환한다.
 * 신호가 없거나(id 부재) null/undefined면 null → 카드 미표시(빈상태 흡수).
 * @returns `/signals/{id}` 또는 카드를 그리지 않아야 할 때 null
 */
export function disclosureSignalTarget(
  signal: CompanySignalBadge | null | undefined,
): string | null {
  if (!signal || !signal.id) return null;
  return `/signals/${signal.id}`;
}
