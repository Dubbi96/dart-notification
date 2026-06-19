import { MAX_INDEX_DAILY_CHANGE_PCT, isImplausibleIndexChange } from './index-sanity';

/**
 * DAR-367: 시장지수 연속성 sanity 가드 순수 함수.
 * 적재(거부)·표시(폴백) 양쪽에서 동일 기준을 공유하므로 진리표로 결정론적 검증한다.
 */
describe('index-sanity.isImplausibleIndexChange (DAR-367)', () => {
  it('임계 기본값은 20%', () => {
    expect(MAX_INDEX_DAILY_CHANGE_PCT).toBe(20);
  });

  it('이슈 재현: close 3132 vs prevClose 8639 (-63.75%) → 이상치(true)', () => {
    expect(isImplausibleIndexChange(3132.06, 8639.41)).toBe(true);
  });

  it('인접일 +60% 입력 → 이상치(true) [DoD 단위테스트]', () => {
    expect(isImplausibleIndexChange(1600, 1000)).toBe(true);
  });

  it('인접일 -60% 입력 → 이상치(true) [DoD 단위테스트]', () => {
    expect(isImplausibleIndexChange(400, 1000)).toBe(true);
  });

  it('정상 등락(+1%) → 정상(false)', () => {
    expect(isImplausibleIndexChange(2727, 2700)).toBe(false);
  });

  it('급락이지만 임계 이내(-8.4%, 코로나 폭락 수준) → 정상(false)', () => {
    expect(isImplausibleIndexChange(916, 1000)).toBe(false);
  });

  it('경계값: 정확히 +20% 는 임계 초과 아님(false)', () => {
    expect(isImplausibleIndexChange(1200, 1000)).toBe(false);
  });

  it('경계값: +20.01% 는 이상치(true)', () => {
    expect(isImplausibleIndexChange(1200.1, 1000)).toBe(true);
  });

  it('prevClose=null(전일 없음) → 비교 불가, 이상치 아님(false)', () => {
    expect(isImplausibleIndexChange(3132, null)).toBe(false);
  });

  it('prevClose=0 → 0 나눗셈 회피, 이상치 아님(false)', () => {
    expect(isImplausibleIndexChange(3132, 0)).toBe(false);
  });

  it('prevClose 음수 → 이상치 아님(false)', () => {
    expect(isImplausibleIndexChange(3132, -100)).toBe(false);
  });

  it('threshold 주입 가능(예: 10%) → +15% 는 이상치', () => {
    expect(isImplausibleIndexChange(1150, 1000, 10)).toBe(true);
  });
});
