import {
  BROKER_APPS,
  BROKER_HANDOFF_DISCLOSURE,
  BROKER_HANDOFF_TITLE,
  brokerStoreUrl,
  openBrokerApp,
  type BrokerApp,
} from '@utils/brokerHandoff';

// DAR-545: 브로커 앱 핸드오프 딥링크 SSOT 회귀 가드.
// openURL 을 주입해 RN Linking 없이 2경로(스킴 오픈/스토어 폴백)와 플랫폼별 폴백을 순수 검증한다.
describe('utils/brokerHandoff', () => {
  it('대표 2~3사가 등록되고 각 항목이 스킴·양 플랫폼 스토어 URL 을 갖춘다', () => {
    expect(BROKER_APPS.length).toBeGreaterThanOrEqual(2);
    expect(BROKER_APPS.length).toBeLessThanOrEqual(3);

    for (const b of BROKER_APPS) {
      expect(b.id.length).toBeGreaterThan(0);
      expect(b.name.length).toBeGreaterThan(0);
      // 스킴은 커스텀 스킴 URL 형태(`scheme://`).
      expect(b.appScheme).toMatch(/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//);
      // 스토어 폴백은 https 절대 URL.
      expect(b.iosStoreUrl).toMatch(/^https:\/\/apps\.apple\.com\//);
      expect(b.androidStoreUrl).toMatch(/^https:\/\/play\.google\.com\//);
    }
  });

  it('id 가 고유하다(가드/키 충돌 방지)', () => {
    const ids = BROKER_APPS.map((b) => b.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('정직 고지·제목 카피가 추천 아님/폴백 안내를 담는다', () => {
    expect(BROKER_HANDOFF_TITLE).toBe('증권사 앱에서 열기');
    expect(BROKER_HANDOFF_DISCLOSURE).toContain('추천하지 않');
    expect(BROKER_HANDOFF_DISCLOSURE).toContain('앱스토어');
  });

  it('brokerStoreUrl 은 플랫폼별 폴백 URL 을 선택한다', () => {
    const b = BROKER_APPS[0];
    expect(brokerStoreUrl(b, 'ios')).toBe(b.iosStoreUrl);
    expect(brokerStoreUrl(b, 'android')).toBe(b.androidStoreUrl);
  });

  const sample: BrokerApp = {
    id: 'test',
    name: '테스트증권',
    appScheme: 'testbroker://',
    iosStoreUrl: 'https://apps.apple.com/kr/app/id123',
    androidStoreUrl: 'https://play.google.com/store/apps/details?id=com.test',
  };

  it('경로1: 스킴 오픈 성공 → app, 스킴 URL 로 1회만 openURL', async () => {
    const openURL = jest.fn().mockResolvedValue(true);
    const outcome = await openBrokerApp(sample, { openURL, platform: 'ios' });

    expect(outcome).toBe('app');
    expect(openURL).toHaveBeenCalledTimes(1);
    expect(openURL).toHaveBeenCalledWith('testbroker://');
  });

  it('경로2: 스킴 실패(미설치) → store 폴백(iOS 스토어 URL)', async () => {
    const openURL = jest
      .fn()
      .mockRejectedValueOnce(new Error('no handler'))
      .mockResolvedValueOnce(true);
    const outcome = await openBrokerApp(sample, { openURL, platform: 'ios' });

    expect(outcome).toBe('store');
    expect(openURL).toHaveBeenNthCalledWith(1, 'testbroker://');
    expect(openURL).toHaveBeenNthCalledWith(2, sample.iosStoreUrl);
  });

  it('경로2: 스킴 실패 시 Android 는 Play Store 로 폴백', async () => {
    const openURL = jest
      .fn()
      .mockRejectedValueOnce(new Error('ActivityNotFoundException'))
      .mockResolvedValueOnce(true);
    const outcome = await openBrokerApp(sample, { openURL, platform: 'android' });

    expect(outcome).toBe('store');
    expect(openURL).toHaveBeenNthCalledWith(2, sample.androidStoreUrl);
  });

  it('실제 등록 브로커 전수가 2경로에서 스킴→스토어로 정확히 링크아웃한다', async () => {
    for (const b of BROKER_APPS) {
      const okURL = jest.fn().mockResolvedValue(true);
      expect(await openBrokerApp(b, { openURL: okURL, platform: 'android' })).toBe('app');
      expect(okURL).toHaveBeenCalledWith(b.appScheme);

      const failURL = jest
        .fn()
        .mockRejectedValueOnce(new Error('miss'))
        .mockResolvedValueOnce(true);
      expect(await openBrokerApp(b, { openURL: failURL, platform: 'android' })).toBe('store');
      expect(failURL).toHaveBeenNthCalledWith(2, b.androidStoreUrl);
    }
  });
});
