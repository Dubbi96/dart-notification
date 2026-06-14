/**
 * DAR-203 결정론적 검증: createSingleFlight 가 동시 호출을 하나의 진행중 작업으로 합쳐
 * 실제 작업(=/auth/refresh)을 1 회만 실행하고, 완료/실패 후 캐시를 비워 다음 호출이
 * 새 작업을 시작하게 하는지 확인한다.
 * 실행: node scripts/check-single-flight.ts  (실패 시 exit 1)
 *
 * 핵심 회귀: 토큰 만료 시 화면 진입의 다중 React Query 가 동시에 401 을 받아도
 * /auth/refresh 가 1 회만 호출되어 토큰 회전이 서로를 무효화(강제 로그아웃)하지 않는다.
 */
import { createSingleFlight } from '../services/singleFlight.ts';

let failed = 0;
function check(name: string, cond: boolean, detail = ''): void {
  if (!cond) failed++;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? ` → ${detail}` : ''}`);
}

// 다음 마이크로/매크로태스크까지 양보(진행중 Promise 정리 effect 가 실행되도록).
const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

async function main(): Promise<void> {
  // 1) 동시 401 3 건 → 실제 refresh 작업은 1 회만 실행, 3 호출 모두 같은 결과.
  {
    let calls = 0;
    const gate = createSingleFlight<string>();
    const refresh = (): Promise<string> => {
      calls++;
      return new Promise((resolve) => setTimeout(() => resolve(`token-${calls}`), 5));
    };

    const [a, b, c] = await Promise.all([gate(refresh), gate(refresh), gate(refresh)]);
    check('동시 3건 → refresh 1회만 호출', calls === 1, `calls=${calls}`);
    check('동시 3건 → 모두 동일 토큰 공유', a === b && b === c && a === 'token-1', `${a}/${b}/${c}`);
  }

  // 2) 진행중 작업 완료 후 새 호출은 다시 작업을 실행(캐시 비워짐).
  {
    let calls = 0;
    const gate = createSingleFlight<number>();
    const task = (): Promise<number> => {
      calls++;
      return Promise.resolve(calls);
    };
    await gate(task);
    await tick();
    const second = await gate(task);
    check('완료 후 새 호출은 작업 재실행', calls === 2 && second === 2, `calls=${calls}`);
  }

  // 3) 작업 실패 시에도 캐시가 비워져 다음 호출이 재시도 가능(stale 거부 Promise 재사용 금지).
  {
    let calls = 0;
    const gate = createSingleFlight<string>();
    const flaky = (): Promise<string> => {
      calls++;
      return calls === 1 ? Promise.reject(new Error('refresh fail')) : Promise.resolve('ok');
    };

    let firstRejected = false;
    try {
      await gate(flaky);
    } catch {
      firstRejected = true;
    }
    await tick();
    const retry = await gate(flaky);
    check('실패 시 캐시 비워짐 → 재시도 성공', firstRejected && calls === 2 && retry === 'ok', `calls=${calls}`);
  }

  // 4) 동시 실패도 단일 작업 — 모두 같은 거부를 공유(refresh 1회).
  {
    let calls = 0;
    const gate = createSingleFlight<string>();
    const failing = (): Promise<string> => {
      calls++;
      return new Promise((_resolve, reject) => setTimeout(() => reject(new Error('boom')), 5));
    };
    const results = await Promise.allSettled([gate(failing), gate(failing), gate(failing)]);
    const allRejected = results.every((r) => r.status === 'rejected');
    check('동시 실패 → refresh 1회·모두 거부', calls === 1 && allRejected, `calls=${calls}`);
  }

  if (failed > 0) {
    console.error(`\n${failed} case(s) failed`);
    process.exit(1);
  }
  console.log('\nAll cases passed');
}

void main();
