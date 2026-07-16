import {
  TESTER_EVENTS,
  isTesterEvent,
  buildTesterEventPayload,
  type TesterEvent,
} from '@utils/testerEvents';

/**
 * DAR-516 테스터 코호트 계측 순수 로직 — SSOT(화이트리스트)·페이로드 형태 잠금.
 * 백엔드 backend/src/ops/dto/record-tester-event.dto.ts 의 TESTER_EVENTS 와 동일해야 한다.
 */
describe('testerEvents 화이트리스트(SSOT)', () => {
  it('계측 5지점 + iOS 게이트 설문 3응답 = 8종 고정', () => {
    expect(TESTER_EVENTS).toEqual([
      'edition_open',
      'card_tap',
      'push_open',
      'stats_section_view',
      'waitlist_cta',
      'survey_ios_shown',
      'survey_ios_answer_yes',
      'survey_ios_answer_no',
    ]);
  });

  it('isTesterEvent — 화이트리스트만 통과', () => {
    expect(isTesterEvent('edition_open')).toBe(true);
    expect(isTesterEvent('card_tap')).toBe(true);
    expect(isTesterEvent('survey_ios_answer_no')).toBe(true);
    expect(isTesterEvent('unknown_event')).toBe(false);
    expect(isTesterEvent('')).toBe(false);
    // PII/자유텍스트를 이벤트명에 실으려는 시도는 거부(서버도 IsIn 으로 이중 방어).
    expect(isTesterEvent('card_tap:005930')).toBe(false);
  });
});

describe('buildTesterEventPayload', () => {
  it('event 만 담은 최소 페이로드(추가 필드 없음 — PII 무수집)', () => {
    const p = buildTesterEventPayload('edition_open');
    expect(p).toEqual({ event: 'edition_open' });
    expect(Object.keys(p)).toEqual(['event']);
  });

  it('모든 화이트리스트 값에 대해 형태 일관', () => {
    for (const ev of TESTER_EVENTS as readonly TesterEvent[]) {
      expect(buildTesterEventPayload(ev)).toEqual({ event: ev });
    }
  });
});
