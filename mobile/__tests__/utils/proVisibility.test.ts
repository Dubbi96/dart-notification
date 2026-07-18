import { resolveShowProUpsell } from '@utils/proVisibility';

// DAR-558: 첫 게시(Play) 빌드 Pro 업셀 게이팅 — 화면·검증 스크립트와 공유하는 순수 로직의 회귀 가드.
describe('utils/proVisibility', () => {
  it('resolveShowProUpsell 진리표: 오직 "false" 만 숨긴다', () => {
    expect({
      undefined: resolveShowProUpsell(undefined),
      empty: resolveShowProUpsell(''),
      true: resolveShowProUpsell('true'),
      false: resolveShowProUpsell('false'),
      // 오타/이형은 노출 유지(우발적 숨김 방지)
      False: resolveShowProUpsell('False'),
      zero: resolveShowProUpsell('0'),
    }).toMatchSnapshot();
  });

  it('기본(oci/preview/production, 미설정)은 Pro 업셀 표면을 유지한다', () => {
    expect(resolveShowProUpsell(undefined)).toBe(true);
  });

  it('play 빌드(EXPO_PUBLIC_SHOW_PRO_UPSELL="false")는 Pro 업셀 표면을 숨긴다', () => {
    expect(resolveShowProUpsell('false')).toBe(false);
  });
});
