import {
  resolveShowTrading,
  tradingSurfaceVisibility,
} from '@utils/tradingVisibility';

// DAR-549: 첫 게시(Play) 빌드 게이팅 — 화면·검증 스크립트와 공유하는 순수 로직의 회귀 가드.
// 수용기준 "플래그 양값 스냅샷" — 플래그 true/false 각각의 표면 노출 결과를 고정한다.
describe('utils/tradingVisibility', () => {
  it('resolveShowTrading 진리표: 오직 "false" 만 숨긴다', () => {
    expect({
      undefined: resolveShowTrading(undefined),
      empty: resolveShowTrading(''),
      true: resolveShowTrading('true'),
      false: resolveShowTrading('false'),
      // 오타/이형은 노출 유지(우발적 숨김 방지)
      False: resolveShowTrading('False'),
      zero: resolveShowTrading('0'),
    }).toMatchSnapshot();
  });

  it('기본(oci/preview/production, 미설정)은 트레이딩 표면을 유지한다', () => {
    expect(resolveShowTrading(undefined)).toBe(true);
    expect(tradingSurfaceVisibility(resolveShowTrading(undefined))).toMatchSnapshot(
      'show=true (default oci)',
    );
  });

  it('play 빌드(EXPO_PUBLIC_SHOW_TRADING="false")는 트레이딩 표면을 전면 숨긴다', () => {
    expect(resolveShowTrading('false')).toBe(false);
    const hidden = tradingSurfaceVisibility(resolveShowTrading('false'));
    expect(hidden).toMatchSnapshot('show=false (play)');
    // 명시 단언 — 스냅샷과 별개로 "모든 트레이딩 표면이 실제로 꺼졌는지" 고정.
    expect(Object.values(hidden).every((v) => v === false)).toBe(true);
  });
});
