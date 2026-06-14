// 상대시간 표기 단일소스(DAR-178) — '분석 N분 전' 류 표현을 화면마다 재구현하지 않게 통일.
// 종전: ProvenanceBar.relativeTime(date-fns), collection-status.formatRelative(수기 분/시/일),
// notifications 인라인 formatDistanceToNow 가 톤·'방금'경계·null처리 제각각이었다.
// date-fns ko 를 정식 소스로 삼고, null/'기록 없음' 폴백은 래퍼에서 흡수한다. read-only.

import { formatDistanceToNow } from 'date-fns';
import { ko } from 'date-fns/locale';

/**
 * ISO 시각 → '2분 전' 같은 상대 표현(한국어). 입력은 유효한 시각 문자열로 가정.
 * 소비처는 전부 항상-과거 이벤트(서버 설정 시각)인데, 서버>기기 클럭 스큐 시
 * 미래 시각이 들어오면 addSuffix 가 'N초 후'·'N분 후' 같은 무의미 표기를 만든다(DAR-290).
 * 현재 이후(now 포함) 시각은 '방금'으로 정직화하고, 과거만 기존 경로로 표기한다.
 */
export function relativeTime(iso: string): string {
  if (new Date(iso).getTime() >= Date.now()) return '방금';
  return formatDistanceToNow(new Date(iso), { addSuffix: true, locale: ko });
}

/**
 * 'YYYYMMDD'(8자리 숫자) → 'YYYY.MM.DD'. 단일 소스(DAR-218).
 * 종전엔 collection-status·company 상세·EventStudy 드릴다운이 각자
 * slice(0,4)/slice(4,6)/slice(6,8)로 같은 포맷을 재구현했고, 8자리 미만·null
 * 처리가 제각각이었다(원문 passthrough vs '-' vs '기록 없음'). 여기로 통일한다.
 * 8자리 숫자가 아니거나 null/undefined면 일관되게 '-' 폴백.
 */
export function formatYmdDots(ymd: string | null | undefined): string {
  if (!ymd || !/^\d{8}$/.test(ymd)) return '-';
  return `${ymd.slice(0, 4)}.${ymd.slice(4, 6)}.${ymd.slice(6, 8)}`;
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
