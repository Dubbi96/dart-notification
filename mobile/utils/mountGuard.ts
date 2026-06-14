/**
 * 경량 생명주기 가드 — 언마운트 후 setState/콜백 실행과 타이머 누수를 막는다.
 *
 * 배경(DAR-228): sign-in 카카오 폴링은 setInterval 콜백 안에서 `await api.get` 으로
 * 결과를 받은 뒤 로컬 setState(setIsLoading 등)를 호출한다. 화면 이탈(언마운트)로
 * interval 을 clearInterval 해도, 이미 진행 중인 await 가 해소되면 setState 가 실행돼
 * "unmounted 컴포넌트 setState" 경고와 누수가 발생한다. 별도 setTimeout 도 cleanup 에
 * 등록되지 않으면 언마운트 후 발화한다.
 *
 * 해결: 마운트 플래그(run/isMounted)로 언마운트 후 콜백을 차단하고, 등록한 모든
 * setTimeout/setInterval 을 cleanup 에서 일괄 해제한다.
 */
export type TimerHandle = ReturnType<typeof setTimeout> | ReturnType<typeof setInterval>;

export interface MountGuard {
  /** 마운트 상태 — cleanup 호출 후 false */
  isMounted: () => boolean;
  /** 마운트된 동안에만 fn 을 실행(언마운트 후에는 no-op) */
  run: (fn: () => void) => void;
  /** cleanup 시 자동 해제되는 setTimeout — 콜백은 마운트 상태에서만 실행 */
  setTimeout: (cb: () => void, ms: number) => TimerHandle;
  /** cleanup 시 자동 해제되는 setInterval — tick 콜백은 마운트 상태에서만 실행 */
  setInterval: (cb: () => void, ms: number) => TimerHandle;
  /** 개별 타이머 즉시 해제(성공 시 폴링 중단 등). null/undefined 는 무시 */
  clearTimer: (id: TimerHandle | null | undefined) => void;
  /** 언마운트 시 1회 호출 — 마운트 플래그를 내리고 등록된 타이머 전부 해제 */
  cleanup: () => void;
}

export function createMountGuard(): MountGuard {
  let mounted = true;
  const timers = new Set<TimerHandle>();

  const clearTimer = (id: TimerHandle | null | undefined): void => {
    if (id == null) return;
    // RN/JS 환경에서 setTimeout/setInterval 핸들은 호환되며 반대편 clear 는 no-op 이다.
    clearTimeout(id as ReturnType<typeof setTimeout>);
    clearInterval(id as ReturnType<typeof setInterval>);
    timers.delete(id);
  };

  return {
    isMounted: () => mounted,
    run: (fn) => {
      if (mounted) fn();
    },
    setTimeout: (cb, ms) => {
      const id = setTimeout(() => {
        timers.delete(id);
        if (mounted) cb();
      }, ms);
      timers.add(id);
      return id;
    },
    setInterval: (cb, ms) => {
      const id = setInterval(() => {
        if (mounted) cb();
      }, ms);
      timers.add(id);
      return id;
    },
    clearTimer,
    cleanup: () => {
      mounted = false;
      timers.forEach((id) => clearTimer(id));
      timers.clear();
    },
  };
}
