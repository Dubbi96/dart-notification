/**
 * 푸시·인박스 딥링크 라우팅 해석기 (DAR-90)
 *
 * 백엔드 notify.consumer(DAR-85)가 SIGNAL(`/signals/{id}`)·EXIT/THESIS(`/portfolio/...`)·
 * DISCLOSURE(`/disclosure/{rcpNo}`) deepLink 를 푸시 페이로드(`data.deepLink`)로 전달한다.
 * 알림 진입 핸들러는 임의 경로로 라우팅하면 안 되므로(신뢰 경계), 허용 prefix 화이트리스트로
 * 검증한 뒤에만 router.push 한다. deepLink 가 없으면 `data.disclosureRcpNo` 로 공시 폴백.
 *
 * DAR-150: 백엔드가 deepLink 를 미충전한 비공시 알림(SIGNAL/EXIT/THESIS_VIOLATED)은
 * 공시 폴백으로도 대상을 못 만들어 무반응(dead tap)이 됐다. 알림 페이로드의 `type`·`refId`
 * 로 타입별 폴백 경로를 도출한다(SIGNAL → `/signals/{refId}`, EXIT/THESIS_VIOLATED →
 * 포지션 식별이 불가하므로 `/portfolio`). 도출 경로도 화이트리스트로 재검증한다.
 */

/** 라우팅 허용 prefix — 이 목록 밖 경로는 무시(임의 라우팅·신뢰 경계 방지) */
export const ALLOWED_DEEPLINK_PREFIXES = [
  '/signals',
  '/portfolio',
  '/company',
  '/disclosure',
  '/disclosures',
] as const;

/** 허용 prefix 로 시작하고 안전한(스킴·트래버설 없는) 절대 앱 경로인지 검증 */
export function isAllowedDeepLink(path: unknown): path is string {
  if (typeof path !== 'string' || path.length === 0) return false;
  // 절대 앱 경로만 허용 — 외부 스킴(http://, gongsion://)·프로토콜 상대(//host) 차단
  if (!path.startsWith('/') || path.startsWith('//')) return false;
  if (path.includes('://')) return false;
  // 경로 트래버설 차단
  if (path.includes('..')) return false;

  // prefix 뒤는 경로 경계(`/`)·쿼리(`?`)·끝 이어야 함 ('/signalsX' 같은 우회 방지)
  return ALLOWED_DEEPLINK_PREFIXES.some((prefix) => {
    if (!path.startsWith(prefix)) return false;
    const next = path.charAt(prefix.length);
    return next === '' || next === '/' || next === '?';
  });
}

/**
 * 알림 타입·refId 로 타입별 폴백 경로를 도출(DAR-150) — deepLink·공시 폴백 모두 실패 시.
 * 도출 경로는 항상 화이트리스트(`isAllowedDeepLink`)로 재검증해 신뢰 경계를 유지한다.
 */
function resolveTypedFallback(type: unknown, refId: unknown): string | null {
  const ref = typeof refId === 'string' && refId.length > 0 ? refId : null;

  switch (type) {
    case 'SIGNAL': {
      // refId = signalId → 신호 상세. refId 없으면 신호 목록.
      const path = ref ? `/signals/${encodeURIComponent(ref)}` : '/signals';
      return isAllowedDeepLink(path) ? path : null;
    }
    case 'EXIT':
    case 'THESIS_VIOLATED':
      // refId = positionId 이나 portfolioId 가 없어 포지션 경로 도출 불가 → 포트폴리오 홈.
      return '/portfolio';
    default:
      return null;
  }
}

/** 푸시/알림 페이로드에서 라우팅 대상 경로를 도출 — 미허용/없음이면 null */
export function resolveDeepLink(data: unknown): string | null {
  if (data == null || typeof data !== 'object') return null;
  const record = data as Record<string, unknown>;

  // 1순위: 범용 deepLink (화이트리스트 통과 시에만)
  if (isAllowedDeepLink(record.deepLink)) {
    return record.deepLink;
  }

  // 폴백(하위호환): 공시 rcpNo → 공시 상세 경로
  const rcpNo = record.disclosureRcpNo;
  if (typeof rcpNo === 'string' && rcpNo.length > 0) {
    return `/disclosure/${encodeURIComponent(rcpNo)}`;
  }

  // DAR-150: 타입별 폴백(SIGNAL/EXIT/THESIS_VIOLATED) — dead tap 제거.
  return resolveTypedFallback(record.type, record.refId);
}
