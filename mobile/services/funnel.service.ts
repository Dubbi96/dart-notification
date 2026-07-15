import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';
import {
  buildFunnelPayload,
  funnelSentKey,
  FUNNEL_ANON_ID_KEY,
  type FunnelStep,
} from '@utils/funnel';

import { api } from './api';

/**
 * 온보딩 퍼널 계측 전송 (갭분석 W15 ③) — fire-and-forget.
 *
 * install→intro→kakao→관심기업→푸시권한 5단계를 비인증 POST /ops/funnel 로 기록한다.
 * ★계측은 제품 경로가 아니다: 어떤 실패(오프라인·서버 다운·SecureStore 오류)도
 *   호출 화면으로 전파하지 않는다 — 전 구간 try/catch 흡수.
 * ★온보딩 UI 재설계 금지(측정만). 서버 상태가 아니므로 React Query 훅 대상이 아니다
 *   (일회성 계측 발화 — deviceService.register 와 같은 서비스 직접 호출 관례를 따른다).
 */

/** 디바이스 단위 익명 ID — 최초 1회 생성 후 SecureStore 영속(로그인 전 단계 추적). */
async function getOrCreateAnonId(): Promise<string> {
  const existing = await SecureStore.getItemAsync(FUNNEL_ANON_ID_KEY);
  if (existing) return existing;
  const created = Crypto.randomUUID();
  await SecureStore.setItemAsync(FUNNEL_ANON_ID_KEY, created);
  return created;
}

interface RecordFunnelOptions {
  /** true 면 설치당 1회만 전송(전송 성공 후 SecureStore 플래그 기록). */
  once?: boolean;
}

/**
 * 퍼널 단계 1건 기록. 항상 resolve 하며 절대 throw 하지 않는다.
 * 호출부는 `void recordFunnelStep(...)` 로 발화하고 결과를 기다리지 않는다.
 */
export async function recordFunnelStep(
  step: FunnelStep,
  meta?: Record<string, unknown>,
  options?: RecordFunnelOptions,
): Promise<void> {
  try {
    if (options?.once) {
      const sent = await SecureStore.getItemAsync(funnelSentKey(step));
      if (sent === 'true') return;
    }
    const anonId = await getOrCreateAnonId();
    await api.post('/ops/funnel', buildFunnelPayload(anonId, step, meta));
    if (options?.once) {
      await SecureStore.setItemAsync(funnelSentKey(step), 'true');
    }
  } catch {
    // 계측 실패는 무시 — 사용자 흐름·화면에 어떤 영향도 주지 않는다.
  }
}
