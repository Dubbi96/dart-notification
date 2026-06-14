/**
 * DAR-228 결정론적 검증: createMountGuard 가 언마운트(=cleanup) 후
 *  (1) run() 으로 감싼 로컬 setState 를 차단하고,
 *  (2) 등록된 setTimeout(5초 폴백)·setInterval(카카오 폴링)을 일괄 해제하며,
 *  (3) interval tick 안 await(api.get) 해소가 언마운트 뒤 도착해도 setState 를 막는지
 * 확인한다. sign-in.tsx 가 적용한 가드와 동일한 isMounted 체크를 재현한다.
 *
 * 실행: npx tsx scripts/check-signin-unmount-guard.ts  (실패 시 exit 1)
 */
import { createMountGuard } from '../utils/mountGuard.ts';

let failed = 0;
function check(name: string, cond: boolean, detail = ''): void {
  if (!cond) failed++;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? ` → ${detail}` : ''}`);
}

const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

async function main(): Promise<void> {
  // 1) run(): 마운트 중에는 실행, 언마운트(cleanup) 후에는 no-op → setState 경고 0.
  {
    const g = createMountGuard();
    let calls = 0;
    g.run(() => calls++);
    check('마운트 중 run() 실행', calls === 1 && g.isMounted(), `calls=${calls}`);
    g.cleanup();
    g.run(() => calls++);
    check('언마운트 후 run() 차단', calls === 1 && !g.isMounted(), `calls=${calls}`);
  }

  // 2) setTimeout(5초 폴백): cleanup 후 발화하지 않음 → 타임아웃 누수 0.
  {
    const g = createMountGuard();
    let fired = 0;
    g.setTimeout(() => fired++, 20);
    g.cleanup();
    await wait(40);
    check('언마운트 후 setTimeout 미발화', fired === 0, `fired=${fired}`);
  }

  // 3) setInterval(폴링): cleanup 후 tick 중단 → 인터벌 누수 0.
  {
    const g = createMountGuard();
    let ticks = 0;
    g.setInterval(() => ticks++, 10);
    await wait(35);
    const before = ticks;
    check('마운트 중 폴링 tick 발생', before >= 1, `ticks=${before}`);
    g.cleanup();
    await wait(40);
    check('언마운트 후 폴링 tick 중단', ticks === before, `before=${before} after=${ticks}`);
  }

  // 4) clearTimer: 성공 시 개별 폴링만 중단하고 가드는 마운트 유지(cleanup 과 구분).
  {
    const g = createMountGuard();
    let ticks = 0;
    const id = g.setInterval(() => ticks++, 10);
    await wait(25);
    g.clearTimer(id);
    const frozen = ticks;
    await wait(30);
    check('clearTimer 후 폴링 동결·가드 마운트 유지', ticks === frozen && g.isMounted(), `ticks=${ticks}`);
    g.cleanup();
  }

  // 5) 실제 레이스: tick 안 await 해소가 언마운트 후 도착 → isMounted 가드로 setState 차단.
  {
    const g = createMountGuard();
    let setStateCalls = 0;
    g.setInterval(async () => {
      await wait(15); // api.get 해소 모사
      if (!g.isMounted()) return; // sign-in.tsx 가 적용한 가드와 동일
      setStateCalls++; // setIsLoading/setAuth 모사
    }, 10);
    await wait(12); // 첫 tick 시작(아직 await 중)
    g.cleanup(); // await 진행 중 언마운트
    await wait(40);
    check('await 해소가 언마운트 후 도착 시 setState 차단', setStateCalls === 0, `setStateCalls=${setStateCalls}`);
  }

  // 6) 대조(버그 재현): 가드 없이 interval 만 clearInterval 하면 in-flight await 가 setState 실행.
  {
    let mounted = true;
    let calls = 0;
    const id = setInterval(async () => {
      if (mounted) {
        await wait(15);
        calls++; // 가드 없음 → 언마운트 후에도 실행(기존 버그)
      }
    }, 10);
    await wait(12);
    mounted = false;
    clearInterval(id); // 기존 cleanup: interval 만 해제, in-flight await 는 못 막음
    await wait(40);
    check('대조: 가드 없으면 언마운트 후 setState 발생(old 동작)', calls === 1, `calls=${calls}`);
  }

  if (failed > 0) {
    console.error(`\n${failed} case(s) failed`);
    process.exit(1);
  }
  console.log('\nAll cases passed');
}

void main();
