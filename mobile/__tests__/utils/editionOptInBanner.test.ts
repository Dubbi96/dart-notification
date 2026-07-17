import {
  EDITION_OPT_IN_BANNER,
  shouldShowEditionOptInBanner,
} from '@utils/editionOptInBanner';

// DAR-547: 신호탭 에디션 옵트인 배너 노출 조건 SSOT 회귀 가드.
// RN 무의존 순수 로직 — dismiss 로딩/해제·설정 로드·이미 ON 3축의 노출 매트릭스를 고정한다.
describe('utils/editionOptInBanner', () => {
  it('발행 시각(19시)·에디션 어휘가 카피에 명시된다(기대치 관리)', () => {
    // 이슈 카피: '매일 저녁 7시, 그날의 투자판단 에디션'.
    expect(EDITION_OPT_IN_BANNER.title).toContain('저녁 7시');
    expect(EDITION_OPT_IN_BANNER.title).toContain('에디션');
    expect(EDITION_OPT_IN_BANNER.enableLabel.length).toBeGreaterThan(0);
    expect(EDITION_OPT_IN_BANNER.dismissA11yLabel).toContain('닫기');
  });

  it('단정·FOMO·지시형 문구가 없다(과신 금지 톤)', () => {
    const all = Object.values(EDITION_OPT_IN_BANNER).join(' ');
    expect(all).not.toMatch(/사세요|파세요|추천|지금 바로|무조건|반드시 사/);
  });

  it('로딩(dismissed=null) 동안 미노출(깜빡임 방지)', () => {
    expect(
      shouldShowEditionOptInBanner({
        dismissed: null,
        settingsLoaded: true,
        editionPushEnabled: false,
      }),
    ).toBe(false);
  });

  it('설정 미로드 시 미노출(이미 ON 여부 확정 전)', () => {
    expect(
      shouldShowEditionOptInBanner({
        dismissed: false,
        settingsLoaded: false,
        editionPushEnabled: false,
      }),
    ).toBe(false);
  });

  it('미해제 + 설정 로드 + 에디션 OFF → 노출', () => {
    expect(
      shouldShowEditionOptInBanner({
        dismissed: false,
        settingsLoaded: true,
        editionPushEnabled: false,
      }),
    ).toBe(true);
  });

  it('이미 에디션 푸시 ON 이면 재권유하지 않는다', () => {
    expect(
      shouldShowEditionOptInBanner({
        dismissed: false,
        settingsLoaded: true,
        editionPushEnabled: true,
      }),
    ).toBe(false);
  });

  it('dismiss(해제=true) 후에는 재노출하지 않는다(1회성 규약)', () => {
    expect(
      shouldShowEditionOptInBanner({
        dismissed: true,
        settingsLoaded: true,
        editionPushEnabled: false,
      }),
    ).toBe(false);
  });
});
