/**
 * disclosure-reaction-stats.controller.spec.ts — 라우트 위임·응답 봉투 검증 (DAR-511).
 */
import { DisclosureReactionStatsController } from './disclosure-reaction-stats.controller';
import { DisclosureReactionStatsResponse } from './disclosure-reaction-stats.service';

describe('DisclosureReactionStatsController', () => {
  it('rcpNo 를 서비스에 위임하고 { success, data } 봉투로 감싼다', async () => {
    const payload: DisclosureReactionStatsResponse = {
      rcpNo: '20250101000123',
      minSampleSize: 30,
      generatedAt: '2026-07-17T00:00:00.000Z',
      results: [
        {
          eventType: 'SUPPLY_CONTRACT',
          sampleCount: 142,
          stats: {
            d1: { avgReturn: 0.1, avgAbnormalReturn: 0.06, winRate: 0.6 },
            d5: { avgReturn: 0.5, avgAbnormalReturn: 0.3, winRate: 0.6 },
            d20: { avgReturn: 2, avgAbnormalReturn: 1.2, winRate: 0.6 },
          },
          reason: null,
          period: { fromDate: '20240101', toDate: '20260630' },
          calculatedAt: '2026-07-15T00:00:00.000Z',
        },
      ],
    };
    const service = { getReactionStatsByRcpNo: jest.fn(async () => payload) };
    const controller = new DisclosureReactionStatsController(service as any);

    const res = await controller.getEventStats('20250101000123');

    expect(service.getReactionStatsByRcpNo).toHaveBeenCalledWith('20250101000123');
    expect(res).toEqual({ success: true, data: payload });
  });
});
