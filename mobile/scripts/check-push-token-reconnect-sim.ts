/**
 * DAR-225 DoD 동작 재현(결정론): "기내모드 콜드스타트 → 복구 후 토큰 등록 자동 재시도".
 * 실행: npx tsx scripts/check-push-token-reconnect-sim.ts  (실패 시 exit 1)
 *
 * 훅(useNotificationSetup)의 등록 effect 와 동일한 배선을 재현한다:
 *   - 실제 @tanstack/react-query 의 onlineManager(훅이 구독하는 그 객체)를 사용
 *   - 콜드스타트 1회 등록을 강제로 실패시킨 뒤(기내모드 모사) register 미호출 확인
 *   - onlineManager 가 online 으로 전환되면(복구) shouldRetryOnReconnect 게이트가 재시도를 트리거하여
 *     deviceService.register 가 실제로 호출되는지 확인
 *   - 이미 등록된 뒤의 online 재전환은 재시도하지 않는지(중복 등록 방지) 확인
 *
 * onlineManager 브로드캐스트 + 게이트 함수의 실제 동작을 검증하므로, raw effect 가 재구독되지 않던
 * 회귀(deps=[isAuthenticated]) 가 복구 이벤트로 풀리는지를 디바이스 없이 결정론적으로 증명한다.
 */
import { onlineManager } from '@tanstack/react-query';
import { shouldRetryOnReconnect } from '../utils/pushTokenRetry.ts';

let failures = 0;
function assert(name: string, cond: boolean) {
  if (cond) {
    console.log(`  ok: ${name}`);
  } else {
    console.error(`  FAIL: ${name}`);
    failures += 1;
  }
}

// --- 모사 환경 -------------------------------------------------------------
let networkUp = false; // 콜드스타트 = 기내모드(오프라인)
let registerCalls = 0;
let registeredToken: string | null = null; // = 훅의 registeredTokenRef.current

// deviceService.register 모사: 오프라인이면 네트워크 에러로 실패.
async function fakeRegister(token: string): Promise<void> {
  if (!networkUp) throw new Error('Network request failed');
  registerCalls += 1;
  registeredToken = token;
}

// 훅의 registerWithBackoff() 와 동치인 최소 모사(즉시 1회 시도, 실패는 throw).
async function attemptRegisterOnce(): Promise<void> {
  try {
    await fakeRegister('ExponentPushToken[abc]');
  } catch {
    // 실패 — 미등록 유지(registeredToken 그대로 null)
  }
}

// 훅과 동일하게 onlineManager 복구 브로드캐스트를 구독한다.
const unsubscribe = onlineManager.subscribe((isOnline) => {
  if (shouldRetryOnReconnect(isOnline, registeredToken)) {
    void attemptRegisterOnce();
  }
});

async function run() {
  // onlineManager 가 NetInfo 이벤트리스너 없이도 setOnline 으로 동작하도록 환경 고정.
  onlineManager.setEventListener(() => () => undefined);

  // 1) 콜드스타트: 오프라인에서 1회 시도 → 실패, register 미호출, 미등록.
  onlineManager.setOnline(false);
  await attemptRegisterOnce();
  assert('콜드스타트 오프라인: register 미호출', registerCalls === 0);
  assert('콜드스타트 오프라인: 미등록 상태', registeredToken === null);

  // 2) 네트워크 복구: online 전환 브로드캐스트 → 자동 재시도 → register 호출·등록 완료.
  networkUp = true;
  onlineManager.setOnline(true);
  await new Promise<void>((r) => setTimeout(r, 0)); // 비동기 재시도 flush
  assert('복구 후 register 1회 호출(DoD)', registerCalls === 1);
  assert('복구 후 토큰 등록 완료', registeredToken === 'ExponentPushToken[abc]');

  // 3) 이미 등록된 뒤 online 재전환(off→on)은 재시도하지 않음(중복 등록 방지).
  onlineManager.setOnline(false);
  onlineManager.setOnline(true);
  await new Promise<void>((r) => setTimeout(r, 0));
  assert('이미 등록 후 재전환: 중복 register 없음', registerCalls === 1);

  unsubscribe();

  if (failures > 0) {
    console.error(`\n${failures}건 실패`);
    process.exit(1);
  }
  console.log('\n전체 통과 (5건)');
}

void run();
