// backend/src/notifications/event-type-copy.spec.ts
// W9 정직 라벨링 — 알림 문구용 실적 이벤트 카피 SSOT 단위 테스트.

import {
  EVENT_TYPE_NOTIFICATION_COPY,
  eventTypeNotificationCopy,
} from './event-type-copy';

describe('eventTypeNotificationCopy (W9 정직 라벨링)', () => {
  it('EARNINGS_SURPRISE → 전년동기 대비 기준 병기', () => {
    expect(eventTypeNotificationCopy('EARNINGS_SURPRISE')).toBe(
      '실적 서프라이즈(전년동기 대비)',
    );
  });

  it('EARNINGS_SHOCK → 전년동기 대비 기준 병기', () => {
    expect(eventTypeNotificationCopy('EARNINGS_SHOCK')).toBe(
      '실적 쇼크(전년동기 대비)',
    );
  });

  it('EARNINGS_GUIDANCE → 자사 전망 병기 (애널리스트 추정 집계로 오인 금지)', () => {
    expect(eventTypeNotificationCopy('EARNINGS_GUIDANCE')).toBe(
      '실적 가이던스(자사 전망)',
    );
  });

  it("카피 어디에도 '컨센서스' 단어를 쓰지 않는다 (오인 유발 카피 금지)", () => {
    for (const copy of Object.values(EVENT_TYPE_NOTIFICATION_COPY)) {
      expect(copy).not.toMatch(/컨센서스/);
    }
  });

  it('비실적 타입은 기존 동작 보존(원문 통과) — 회귀 없음', () => {
    expect(eventTypeNotificationCopy('SUPPLY_CONTRACT')).toBe('SUPPLY_CONTRACT');
  });

  it('결측 입력은 undefined (본문 조립 filter(Boolean) 호환)', () => {
    expect(eventTypeNotificationCopy(undefined)).toBeUndefined();
    expect(eventTypeNotificationCopy(null)).toBeUndefined();
    expect(eventTypeNotificationCopy('')).toBeUndefined();
  });
});
