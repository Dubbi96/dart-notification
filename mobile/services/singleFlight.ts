/**
 * 동시 호출을 하나의 진행중 작업으로 합치는 single-flight 게이트(DAR-203).
 *
 * 토큰 만료 시 화면 진입의 다중 React Query 가 동시에 401 을 받으면 각자 /auth/refresh 를
 * 호출해 N 개의 refresh 가 경쟁한다. 토큰 회전(rotation) 환경에서는 이 경쟁이 서로의 refreshToken
 * 을 무효화해 강제 로그아웃을 유발한다. 진행중 Promise 를 캐시해 동시 호출을 하나에 await 시키면
 * 실제 작업은 1 회만 실행되고, 완료/실패 후 캐시를 비워 다음 호출이 새 작업을 시작할 수 있게 한다.
 *
 * react-native 의존이 없는 순수 모듈 — node 스크립트로 결정론적 검증 가능(scripts/check-single-flight.ts).
 */
export type SingleFlight<T> = (task: () => Promise<T>) => Promise<T>;

export function createSingleFlight<T>(): SingleFlight<T> {
  let inflight: Promise<T> | null = null;

  return (task: () => Promise<T>): Promise<T> => {
    // 이미 진행중이면 새 작업을 시작하지 않고 같은 Promise 를 공유한다.
    if (inflight) return inflight;

    // 성공/실패 모두 캐시를 비워야 다음 호출이 새 작업을 시작한다(stale Promise 재사용 금지).
    inflight = task().finally(() => {
      inflight = null;
    });
    return inflight;
  };
}
