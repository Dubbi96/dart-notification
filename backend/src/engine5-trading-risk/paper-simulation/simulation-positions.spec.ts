/**
 * simulation-positions.spec.ts — 보유 포지션 표시 매퍼 단위테스트 (DAR-42)
 *
 * toSimPositionDetail 이 nullable 시가평가 필드를 안전 기본값으로 정규화하고
 * corpName 을 보강하는지 검증. AI 미개입(순수 함수).
 */

import { toSimPositionDetail, SimOpenPositionRow } from './simulation-positions';

const baseRow: SimOpenPositionRow = {
  corpCode: 'CORP1',
  stockCode: '005930',
  quantity: 10,
  entryPrice: 1000,
  currentPrice: 1100,
  currentValue: 11000,
  unrealizedPnl: 1000,
  unrealizedPnlPct: 10,
};

describe('toSimPositionDetail', () => {
  it('시가평가가 반영된 행을 그대로 매핑하고 corpName 을 보강한다', () => {
    const out = toSimPositionDetail(baseRow, { CORP1: '삼성전자' });
    expect(out).toEqual({
      corpCode: 'CORP1',
      stockCode: '005930',
      corpName: '삼성전자',
      quantity: 10,
      entryPrice: 1000,
      currentPrice: 1100,
      currentValue: 11000,
      unrealizedPnl: 1000,
      unrealizedPnlPct: 10,
    });
  });

  it('회사명 맵에 없으면 corpName 은 null', () => {
    const out = toSimPositionDetail(baseRow, {});
    expect(out.corpName).toBeNull();
  });

  it('스냅샷 전(시가평가 null)이면 진입가 기준으로 보수적으로 채우고 손익 0', () => {
    const row: SimOpenPositionRow = {
      corpCode: 'CORP2',
      stockCode: '404040',
      quantity: 5,
      entryPrice: 2000,
      currentPrice: null,
      currentValue: null,
      unrealizedPnl: null,
      unrealizedPnlPct: null,
    };
    const out = toSimPositionDetail(row, {});
    expect(out.currentPrice).toBe(2000);
    expect(out.currentValue).toBe(10000); // 2000 × 5
    expect(out.unrealizedPnl).toBe(0);
    expect(out.unrealizedPnlPct).toBe(0);
  });
});
