import axios from 'axios';

/**
 * 연결 자체가 실패한 에러(네트워크 차단·타임아웃·DNS 등)인지 판별한다.
 * 응답 상태코드가 있는 4xx/5xx(서버 도달 O)와 구분해, "백엔드 연결 실패" 안내를 띄울지 결정한다.
 * 방화벽 차단·서버 미기동·다른 Wi-Fi 등 인프라 원인일 때 true.
 *
 * react-native 의존이 없는 순수 함수 — node 스크립트로 결정론적 검증 가능(scripts/check-connection-error.ts).
 */
export function isConnectionError(error: unknown): boolean {
  if (!axios.isAxiosError(error)) return false;
  // response 가 없으면 서버에 도달조차 못 한 것. ECONNABORTED=timeout, ERR_NETWORK=네트워크 실패.
  return (
    !error.response ||
    error.code === 'ECONNABORTED' ||
    error.code === 'ERR_NETWORK' ||
    error.message === 'Network Error'
  );
}
