// SecureStore 는 네이티브 모듈 — 순수 로직 테스트에서는 인메모리 no-op 으로 대체.
jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(async () => null),
  setItemAsync: jest.fn(async () => undefined),
  deleteItemAsync: jest.fn(async () => undefined),
}));

import { useSettingsStore, type TextScaleOverride } from '@stores/settingsStore';

// 설정 스토어(테마 오버라이드·글자 배율·Pro 사전신청) 상태 전이 가드.
describe('stores/settingsStore', () => {
  beforeEach(() => {
    useSettingsStore.setState({
      colorSchemeOverride: 'system',
      textScaleOverride: null,
      proWaitlistOptIn: false,
    });
  });

  it("테마 오버라이드: 기본 'system' → light/dark/system 전환", () => {
    expect(useSettingsStore.getState().colorSchemeOverride).toBe('system');
    useSettingsStore.getState().setColorScheme('dark');
    expect(useSettingsStore.getState().colorSchemeOverride).toBe('dark');
    useSettingsStore.getState().setColorScheme('light');
    expect(useSettingsStore.getState().colorSchemeOverride).toBe('light');
    useSettingsStore.getState().setColorScheme('system');
    expect(useSettingsStore.getState().colorSchemeOverride).toBe('system');
  });

  it('글자 배율(§9): 1.0/1.25/1.5/null(시스템) 4상태 전환', () => {
    const scales: TextScaleOverride[] = [1.0, 1.25, 1.5, null];
    for (const scale of scales) {
      useSettingsStore.getState().setTextScaleOverride(scale);
      expect(useSettingsStore.getState().textScaleOverride).toBe(scale);
    }
  });

  it('Pro 사전신청(DAR-204) 온오프 토글', () => {
    useSettingsStore.getState().setProWaitlistOptIn(true);
    expect(useSettingsStore.getState().proWaitlistOptIn).toBe(true);
    useSettingsStore.getState().setProWaitlistOptIn(false);
    expect(useSettingsStore.getState().proWaitlistOptIn).toBe(false);
  });
});
