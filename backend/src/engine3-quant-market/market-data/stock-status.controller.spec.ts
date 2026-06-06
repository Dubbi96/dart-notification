import 'reflect-metadata';
import { StockStatusController } from './stock-status.controller';
import { OptionalJwtAuthGuard } from '../../auth/guards/optional-jwt-auth.guard';
import { DartStockStatusService } from './dart-stock-status.service';

/**
 * DAR-99 회귀 가드: 위험상태 조회는 게스트 열람 가능(OptionalJwtAuthGuard) 이어야 하고,
 * corpCode/stockCode 를 서비스에 그대로 위임해야 한다(빈 문자열 → null 정규화).
 */
describe('StockStatusController (DAR-99)', () => {
  function makeController() {
    const getRiskStatus = jest.fn().mockResolvedValue({
      isManagement: false,
      isHalted: false,
      isDelistingRisk: false,
      statusNote: null,
      sourceRcpNo: null,
      sourceRcpDt: null,
      corpCode: 'A000040',
      stockCode: '000040',
      corpName: '테스트기업',
      source: 'DART_FALLBACK',
      approximate: true,
    });
    const svc = { getRiskStatus } as unknown as DartStockStatusService;
    return { controller: new StockStatusController(svc), getRiskStatus };
  }

  it('컨트롤러 가드가 OptionalJwtAuthGuard 여야 한다(게스트 401 금지)', () => {
    const guards = Reflect.getMetadata('__guards__', StockStatusController) ?? [];
    expect(guards).toContain(OptionalJwtAuthGuard);
  });

  it('corpCode 를 서비스에 위임하고 success 래핑한다', async () => {
    const { controller, getRiskStatus } = makeController();

    const res = await controller.risk('A000040', undefined);

    expect(getRiskStatus).toHaveBeenCalledWith({ corpCode: 'A000040', stockCode: null });
    expect(res.success).toBe(true);
    expect(res.data.approximate).toBe(true);
  });

  it('빈 corpCode·stockCode → null 로 정규화해 위임', async () => {
    const { controller, getRiskStatus } = makeController();

    await controller.risk('', '000040');

    expect(getRiskStatus).toHaveBeenCalledWith({ corpCode: null, stockCode: '000040' });
  });
});
