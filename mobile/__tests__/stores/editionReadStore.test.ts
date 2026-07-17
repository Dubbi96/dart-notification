// SecureStore 는 네이티브 모듈 — 순수 로직 테스트에서는 인메모리 no-op 으로 대체.
jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(async () => null),
  setItemAsync: jest.fn(async () => undefined),
  deleteItemAsync: jest.fn(async () => undefined),
}));

import {
  useEditionReadStore,
  isEditionUnread,
  MAX_READ_DATES,
} from '@stores/editionReadStore';

describe('stores/editionReadStore — DAR-527 놓친 호 열람 기록', () => {
  beforeEach(() => {
    useEditionReadStore.setState({ readDates: {}, baselineDate: null });
  });

  it('기준선 미시드면 어떤 호도 미열람으로 보지 않는다(설치 직후 조용)', () => {
    expect(isEditionUnread('20260717', { readDates: {}, baselineDate: null })).toBe(false);
  });

  it('setBaseline 은 최초 1회만 시드하고 이후 값은 무시한다(발행분만 뱃지 대상)', () => {
    useEditionReadStore.getState().setBaseline('20260714');
    expect(useEditionReadStore.getState().baselineDate).toBe('20260714');
    // 새 호가 최신이 돼도 기준선은 최초값 고정.
    useEditionReadStore.getState().setBaseline('20260717');
    expect(useEditionReadStore.getState().baselineDate).toBe('20260714');
  });

  it('기준선 초과·미열람 호는 놓친 호(뱃지 대상), 기준선 이하는 대상 아님', () => {
    const opts = { readDates: {}, baselineDate: '20260714' };
    expect(isEditionUnread('20260715', opts)).toBe(true); // 초과 & 미열람 → 놓친 호
    expect(isEditionUnread('20260714', opts)).toBe(false); // 기준선(현재 최신) → 대상 아님
    expect(isEditionUnread('20260710', opts)).toBe(false); // 과거 백카탈로그 → 대상 아님
  });

  it('markRead 하면 그 호는 뱃지에서 해제된다(열람 해제 로직)', () => {
    useEditionReadStore.getState().setBaseline('20260714');
    const before = useEditionReadStore.getState();
    expect(isEditionUnread('20260716', before)).toBe(true);

    useEditionReadStore.getState().markRead('20260716');
    const after = useEditionReadStore.getState();
    expect(after.readDates['20260716']).toBe(true);
    expect(isEditionUnread('20260716', after)).toBe(false);
    // 수요일을 열어도 화요일 미열람은 그대로 놓친 호로 남는다(날짜별 집합·고수위 아님).
    expect(isEditionUnread('20260715', after)).toBe(true);
  });

  it('잘못된 형식(YYYYMMDD 아님)은 열람 기록·기준선 시드 모두 무시한다', () => {
    useEditionReadStore.getState().markRead('bad-date');
    expect(useEditionReadStore.getState().readDates['bad-date']).toBeUndefined();
    useEditionReadStore.getState().setBaseline('2026-07-17');
    expect(useEditionReadStore.getState().baselineDate).toBeNull();
    expect(isEditionUnread('2026-07-17', { readDates: {}, baselineDate: '20260714' })).toBe(false);
  });

  it('markRead 는 멱등(중복 열람은 상태 참조를 바꾸지 않는다)', () => {
    useEditionReadStore.getState().markRead('20260717');
    const ref1 = useEditionReadStore.getState().readDates;
    useEditionReadStore.getState().markRead('20260717');
    const ref2 = useEditionReadStore.getState().readDates;
    expect(ref2).toBe(ref1); // 동일 참조 → 불필요 리렌더 없음
  });

  it(`열람 집합은 최신 ${MAX_READ_DATES}개로 캡(영속 무한 증가 방지, 오래된 것부터 제거)`, () => {
    // 기준일 20200101 부터 MAX+10 일치를 순차 열람.
    const base = new Date(Date.UTC(2020, 0, 1));
    for (let i = 0; i < MAX_READ_DATES + 10; i += 1) {
      const d = new Date(base.getTime() + i * 86400000);
      const ymd = `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(
        d.getUTCDate(),
      ).padStart(2, '0')}`;
      useEditionReadStore.getState().markRead(ymd);
    }
    const keys = Object.keys(useEditionReadStore.getState().readDates);
    expect(keys.length).toBe(MAX_READ_DATES);
    // 가장 오래된 20200101 은 제거, 최신은 유지.
    expect(useEditionReadStore.getState().readDates['20200101']).toBeUndefined();
    const newest = keys.sort()[keys.length - 1];
    expect(useEditionReadStore.getState().readDates[newest]).toBe(true);
  });

  it('reset 은 열람 기록·기준선을 모두 비운다', () => {
    useEditionReadStore.getState().setBaseline('20260714');
    useEditionReadStore.getState().markRead('20260716');
    useEditionReadStore.getState().reset();
    expect(useEditionReadStore.getState().readDates).toEqual({});
    expect(useEditionReadStore.getState().baselineDate).toBeNull();
  });
});
