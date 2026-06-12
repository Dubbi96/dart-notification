// 상대시간 표기 단일소스(DAR-178) — '분석 N분 전' 류 표현을 화면마다 재구현하지 않게 통일.
// 종전: ProvenanceBar.relativeTime(date-fns), collection-status.formatRelative(수기 분/시/일),
// notifications 인라인 formatDistanceToNow 가 톤·'방금'경계·null처리 제각각이었다.
// date-fns ko 를 정식 소스로 삼고, null/'기록 없음' 폴백은 래퍼에서 흡수한다. read-only.

import { formatDistanceToNow } from 'date-fns';
import { ko } from 'date-fns/locale';

/** ISO 시각 → '2분 전' 같은 상대 표현(한국어). 입력은 유효한 시각 문자열로 가정. */
export function relativeTime(iso: string): string {
  return formatDistanceToNow(new Date(iso), { addSuffix: true, locale: ko });
}

/**
 * 상대시간 + 폴백 래퍼. null·빈문자열·파싱불가 시 fallback(기본 '기록 없음')을 반환한다.
 * 결측 데이터를 '방금'처럼 오인하게 만들지 않기 위한 정직 폴백.
 */
export function relativeTimeOrFallback(
  iso: string | null | undefined,
  fallback = '기록 없음',
): string {
  if (!iso) return fallback;
  if (Number.isNaN(new Date(iso).getTime())) return fallback;
  return relativeTime(iso);
}
