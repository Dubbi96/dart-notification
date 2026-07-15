import {
  FUNNEL_STEPS,
  buildFunnelPayload,
  funnelSentKey,
  isFunnelStep,
} from '@utils/funnel';

// 온보딩 퍼널 계측 순수 로직(갭분석 W15 ③) — 백엔드 FUNNEL_STEPS 미러의 회귀 가드.
describe('utils/funnel', () => {
  it('퍼널 5단계 정의(백엔드 record-funnel-event.dto.ts 와 일치해야 함)', () => {
    expect([...FUNNEL_STEPS]).toEqual([
      'install',
      'intro',
      'kakao',
      'watchlist',
      'push_permission',
    ]);
  });

  it('isFunnelStep: 5단계 전수 true, 그 외 false', () => {
    for (const step of FUNNEL_STEPS) {
      expect(isFunnelStep(step)).toBe(true);
    }
    expect(isFunnelStep('purchase')).toBe(false);
    expect(isFunnelStep('')).toBe(false);
  });

  it('buildFunnelPayload: meta 가 있으면 포함, 빈 객체({})·미전달이면 생략', () => {
    expect(buildFunnelPayload('anon-1', 'intro', { from: 'carousel' })).toEqual({
      anonId: 'anon-1',
      step: 'intro',
      meta: { from: 'carousel' },
    });
    expect(buildFunnelPayload('anon-1', 'install', {})).toEqual({
      anonId: 'anon-1',
      step: 'install',
    });
    expect(buildFunnelPayload('anon-1', 'kakao')).toEqual({
      anonId: 'anon-1',
      step: 'kakao',
    });
  });

  it('funnelSentKey: SecureStore 허용 문자(영숫자·._-)만 사용한다', () => {
    for (const step of FUNNEL_STEPS) {
      expect(funnelSentKey(step)).toMatch(/^[A-Za-z0-9._-]+$/);
    }
    expect(funnelSentKey('install')).toBe('funnel.sent.install');
  });
});
