import { resolveShowOps } from '@utils/opsVisibility';

// DAR-558: 첫 게시(Play) 빌드 ops(AI 비용/수집현황) 게이팅 — 화면·검증 스크립트와 공유하는 순수 로직의 회귀 가드.
describe('utils/opsVisibility', () => {
  it('resolveShowOps 진리표: 오직 "false" 만 숨긴다', () => {
    expect({
      undefined: resolveShowOps(undefined),
      empty: resolveShowOps(''),
      true: resolveShowOps('true'),
      false: resolveShowOps('false'),
      // 오타/이형은 노출 유지(우발적 숨김 방지)
      False: resolveShowOps('False'),
      zero: resolveShowOps('0'),
    }).toMatchSnapshot();
  });

  it('기본(oci/preview/production, 미설정)은 ops 표면을 유지한다', () => {
    expect(resolveShowOps(undefined)).toBe(true);
  });

  it('play 빌드(EXPO_PUBLIC_SHOW_OPS="false")는 ops 표면을 숨긴다', () => {
    expect(resolveShowOps('false')).toBe(false);
  });
});
