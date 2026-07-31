import { normalizeOperatorJson } from './aos-operator-command.service';

describe('AosOperatorCommandService receipt canonicalization', () => {
  it('DTO class와 Date를 plain JSON으로 정규화하고 undefined를 제거한다', () => {
    class Command {
      reason = '장후 활성화 예약';
      scheduledFor = new Date('2026-08-03T07:00:00.000Z');
      optional: string | undefined = undefined;
    }

    expect(normalizeOperatorJson(new Command())).toEqual({
      reason: '장후 활성화 예약',
      scheduledFor: '2026-08-03T07:00:00.000Z',
    });
  });
});
