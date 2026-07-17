import { NotFoundException } from '@nestjs/common';
import { PriceMoveReasoningController } from './price-move-reasoning.controller';
import { PriceMoveReasoningView } from './price-move-reasoning-query.service';

/** DAR-526 — 카드 조회 컨트롤러: `{ success, data }` 봉투·refId 위임·404 전파 단언. */
describe('PriceMoveReasoningController (DAR-526)', () => {
  const view: PriceMoveReasoningView = {
    refId: '005930-20260717',
    stockCode: '005930',
    corpCode: '00126380',
    corpName: '삼성전자',
    tradeDate: '20260717',
    changePct: 6.3,
    rcpNo: '20260717000123',
    status: 'ANALYZED',
    resultJson: { status: 'ANALYZED' },
    createdAt: '2026-07-17T05:30:00.000Z',
  };

  it("성공 시 { success: true, data } 봉투로 refId 위임 결과를 반환", async () => {
    const query = { getByRefId: jest.fn().mockResolvedValue(view) };
    const controller = new PriceMoveReasoningController(query as any);

    const res = await controller.getByRefId('005930-20260717');

    expect(query.getByRefId).toHaveBeenCalledWith('005930-20260717');
    expect(res).toEqual({ success: true, data: view });
  });

  it('미존재 refId → 서비스의 NotFoundException 을 그대로 전파(전역 필터 404)', async () => {
    const query = {
      getByRefId: jest.fn().mockRejectedValue(new NotFoundException()),
    };
    const controller = new PriceMoveReasoningController(query as any);

    await expect(controller.getByRefId('999999-20260717')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
