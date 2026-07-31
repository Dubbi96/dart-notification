import { demoAudit, demoBacktests, demoBootstrap, demoHealth, demoShadow, demoStrategies } from './demo';
import type { AuditData, BacktestRow, BootstrapData, HealthRow, ShadowData, StrategyRow, StrategyVersionDetail } from './types';

const API_BASE = (import.meta.env.VITE_API_BASE_URL || 'http://localhost:3000/api').replace(/\/$/, '');
const DEMO = import.meta.env.VITE_AOS_OPERATOR_DEMO === '1';
const TOKEN_KEY = 'aos.operator.access-token';

export function token(): string | null {
  return sessionStorage.getItem(TOKEN_KEY);
}

export function logout(): void {
  sessionStorage.removeItem(TOKEN_KEY);
}

export async function login(email: string, password: string): Promise<void> {
  if (DEMO) return;
  const response = await fetch(`${API_BASE}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const body = await response.json();
  if (!response.ok) throw new Error(body?.message || '로그인에 실패했습니다.');
  const accessToken = body?.data?.tokens?.accessToken ?? body?.tokens?.accessToken;
  if (!accessToken) throw new Error('로그인 응답에 access token이 없습니다.');
  sessionStorage.setItem(TOKEN_KEY, accessToken);
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}/aos/operator${path}`, {
    ...init,
    headers: {
      'content-type': 'application/json',
      ...(token() ? { authorization: `Bearer ${token()}` } : {}),
      ...(init?.headers || {}),
    },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(Array.isArray(body?.message) ? body.message.join(', ') : body?.message || `요청 실패 (${response.status})`);
  return body.data as T;
}

export const api = {
  demo: DEMO,
  bootstrap: (): Promise<BootstrapData> => DEMO ? Promise.resolve(demoBootstrap) : request('/bootstrap'),
  strategies: (): Promise<StrategyRow[]> => DEMO ? Promise.resolve(demoStrategies) : request('/strategies'),
  strategyVersion: (id: string): Promise<StrategyVersionDetail> => {
    if (DEMO) {
      const row = demoStrategies.flatMap((strategy) => strategy.versions).find((version) => version.id === id);
      if (!row) return Promise.reject(new Error('데모 전략 버전을 찾을 수 없습니다.'));
      return Promise.resolve({ version: { ...row, configJson: {}, rules: [] }, baseline: null, diff: [] });
    }
    return request(`/strategy-versions/${encodeURIComponent(id)}`);
  },
  backtests: (): Promise<BacktestRow[]> => DEMO ? Promise.resolve(demoBacktests) : request('/backtests'),
  shadow: (): Promise<ShadowData> => DEMO ? Promise.resolve(demoShadow) : request('/shadow'),
  audit: (): Promise<AuditData> => DEMO ? Promise.resolve(demoAudit) : request('/audit'),
  replayDecision: (id: string): Promise<Record<string, unknown>> => DEMO
    ? Promise.resolve({ id, finalAction: 'WATCH', traces: [], note: '데모 replay' })
    : request(`/replay/decisions/${encodeURIComponent(id)}`),
  health: (): Promise<HealthRow[]> => DEMO ? Promise.resolve(demoHealth) : request('/health'),
  async command(path: string, scope: string, password: string, payload: Record<string, unknown>, method: 'POST' | 'PATCH' = 'POST') {
    if (DEMO) throw new Error('데모/read-only 모드에서는 명령을 실행하지 않습니다.');
    const grant = await request<{ token: string }>('/auth/step-up', {
      method: 'POST',
      body: JSON.stringify({ password, scope }),
    });
    return request(path, {
      method,
      headers: { 'x-aos-step-up-token': grant.token },
      body: JSON.stringify(payload),
    });
  },
};
