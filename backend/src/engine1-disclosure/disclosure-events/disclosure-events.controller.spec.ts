import { DisclosureEventsController } from './disclosure-events.controller';
import { DisclosureEventsService } from './disclosure-events.service';

/**
 * DAR-273: 페이지네이션 쿼리 안전 파싱 회귀 가드.
 * `?page=abc`·`?limit=-5`·`?limit=99999999` 가 더 이상 NaN/음수/무클램프 값으로
 * 서비스에 흘러 Prisma 500 / 무한쿼리를 일으키지 않음을 컨트롤러 경계에서 입증한다.
 */
describe('DisclosureEventsController findMany (DAR-273)', () => {
  let controller: DisclosureEventsController;
  let service: { findMany: jest.Mock };

  beforeEach(() => {
    service = { findMany: jest.fn().mockResolvedValue({ items: [], total: 0 }) };
    controller = new DisclosureEventsController(
      service as unknown as DisclosureEventsService,
    );
  });

  const callArgs = () => service.findMany.mock.calls[0][0];

  it('정상 입력은 그대로 전달', async () => {
    await controller.findMany(undefined, undefined, undefined, '2', '50');
    expect(callArgs()).toMatchObject({ page: 2, limit: 50 });
  });

  it('미지정 → 기본값(page 1, limit 20)', async () => {
    await controller.findMany();
    expect(callArgs()).toMatchObject({ page: 1, limit: 20 });
  });

  it('?page=abc/?limit=abc → 기본값 (NaN 누출·500 없음)', async () => {
    await controller.findMany(undefined, undefined, undefined, 'abc', 'abc');
    const args = callArgs();
    expect(Number.isNaN(args.page)).toBe(false);
    expect(Number.isNaN(args.limit)).toBe(false);
    expect(args).toMatchObject({ page: 1, limit: 20 });
  });

  it('?limit=-5 → 하한(min 1)', async () => {
    await controller.findMany(undefined, undefined, undefined, '-3', '-5');
    expect(callArgs()).toMatchObject({ page: 1, limit: 1 });
  });

  it('?limit=99999999 → 상한(max 100)으로 클램프(무한쿼리 방지)', async () => {
    await controller.findMany(undefined, undefined, undefined, '1', '99999999');
    expect(callArgs()).toMatchObject({ page: 1, limit: 100 });
  });
});
