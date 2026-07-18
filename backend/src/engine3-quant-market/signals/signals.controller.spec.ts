/**
 * signals.controller.spec.ts — GET /signals 쿼리 파싱 계약.
 *
 * 최신성 윈도우 sinceDays 의 안전 파싱(parsePaginationInt)·클램프(0~90, 0=해제 특수값)·
 * 미지정 위임(undefined → 서비스 기본값 규칙)을 검증한다. 서비스는 mock — where 적용 규칙은
 * signals.service.spec.ts 가 담당(계층 분리).
 */

import { SignalsController } from './signals.controller';
import { SignalsService } from './signals.service';

describe('SignalsController — sinceDays 쿼리 파싱·클램프', () => {
  let controller: SignalsController;
  let findAll: jest.Mock;

  beforeEach(() => {
    findAll = jest.fn().mockResolvedValue({
      items: [],
      meta: { page: 1, limit: 20, total: 0, totalPages: 0 },
    });
    controller = new SignalsController({
      findAll,
    } as unknown as SignalsService);
  });

  /** findAll(grade, personaType, eventType, entryReady, sort, sinceDays, page, limit) 순서. */
  async function callWith(sinceDaysStr?: string, sortStr?: string) {
    await controller.findAll(
      undefined,
      undefined,
      undefined,
      undefined,
      sortStr,
      sinceDaysStr,
      undefined,
      undefined,
    );
    return findAll.mock.calls[0][0];
  }

  it('정상 정수("14")는 그대로 서비스에 전달한다', async () => {
    const args = await callWith('14');
    expect(args.sinceDays).toBe(14);
  });

  it('상한 초과("365")는 90 으로 클램프한다', async () => {
    const args = await callWith('365');
    expect(args.sinceDays).toBe(90);
  });

  it('"0" 명시는 0(윈도우 해제 특수값)으로 전달한다', async () => {
    const args = await callWith('0');
    expect(args.sinceDays).toBe(0);
  });

  it('음수("-5")는 하한 0(해제)으로 클램프한다', async () => {
    const args = await callWith('-5');
    expect(args.sinceDays).toBe(0);
  });

  it('비숫자("abc")는 undefined — 서비스 기본값 규칙(sort=score → 14일)에 위임', async () => {
    const args = await callWith('abc', 'score');
    expect(args.sinceDays).toBeUndefined();
    expect(args.sort).toBe('score');
  });

  it('미지정은 undefined 로 위임한다(구 APK 요청 형태 — 기본 규칙이 최신성 보장)', async () => {
    const args = await callWith(undefined, 'score');
    expect(args.sinceDays).toBeUndefined();
  });

  it('소수("14.9")는 내림(14)한다', async () => {
    const args = await callWith('14.9');
    expect(args.sinceDays).toBe(14);
  });

  it('sort 미지정 시 latest 로 정규화하며 sinceDays 파싱과 독립이다', async () => {
    const args = await callWith('30', undefined);
    expect(args.sort).toBe('latest');
    expect(args.sinceDays).toBe(30);
  });
});

/**
 * DAR-559: findExitSignals가 이전엔 인자 없이(사용자 스코프 무) 호출됐다.
 * 컨트롤러가 @CurrentUser('id')로 얻은 요청자 userId를 서비스에 그대로 넘기는지만 검증한다
 * (스코프·distinct·take 로직 자체는 signals.exit-signals.integration-spec.ts 가 실DB로 담당).
 */
describe('SignalsController — GET /signals/exit 사용자 스코프 배선', () => {
  it('@CurrentUser로 얻은 userId를 findExitSignals에 그대로 전달한다', async () => {
    const findExitSignals = jest.fn().mockResolvedValue([]);
    const controller = new SignalsController({
      findExitSignals,
    } as unknown as SignalsService);

    const result = await controller.findExitSignals('user_123');

    expect(findExitSignals).toHaveBeenCalledWith('user_123');
    expect(result).toEqual({ success: true, data: [] });
  });
});
