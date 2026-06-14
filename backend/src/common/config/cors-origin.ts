/**
 * CORS origin 정책 결정 (DAR-252).
 *
 * 기존 main.ts 는 `origin: true` 로 모든 origin 을 credentialed 로 반영(reflect)했다.
 * 운영(prod)에서 이는 임의 사이트가 사용자 쿠키/Authorization 을 실은 cross-origin
 * 요청을 보낼 수 있는 표면(CSRF류)이 된다. prod 에서는 명시적 화이트리스트만 허용한다.
 *
 * 순수 함수로 분리해 부트스트랩 없이 결정론적으로 단위 검증한다.
 */

/** 콤마구분 origin 환경변수를 정규화된 배열로 파싱. 공백/빈 항목 제거. */
export function parseAllowedOrigins(raw: string | undefined | null): string[] {
  if (!raw) return [];
  return raw
    .split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);
}

/**
 * enableCors 의 `origin` 옵션 값을 결정.
 * - 개발(!isProd): `true` — 모든 origin 반영(로컬/Swagger/카카오 콜백 편의).
 * - 운영(isProd): 화이트리스트 배열. 미설정 시 `false`(cross-origin 전면 차단).
 *   배열이면 cors 미들웨어가 요청 Origin 을 목록과 대조해 매칭 시에만 반영한다.
 */
export function resolveCorsOrigin(
  isProd: boolean,
  raw: string | undefined | null,
): boolean | string[] {
  if (!isProd) return true;
  const allowed = parseAllowedOrigins(raw);
  return allowed.length > 0 ? allowed : false;
}
