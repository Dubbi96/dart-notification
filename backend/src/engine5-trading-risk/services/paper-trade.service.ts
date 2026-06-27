// PaperTradeService — 모의 주문 접수·체결 시뮬 실행 (M10-A, DAR-16)
// AI 금지영역: 체결 결정·Risk 검증은 순수 Rule. AI 개입 0.

import { Injectable } from '@nestjs/common';
import { simulateFill, DEFAULT_FILL_PARAMS } from '../domain/fill-simulator';
import { FillParams, FillRequest } from '../domain/paper-trade.types';
import { IPaperTradeRepository, PaperTradeRecord } from '../repositories/paper-trade.repository';

export interface PlaceOrderInput {
  corpCode: string;
  stockCode: string;
  direction: 'BUY' | 'SELL';
  orderedShares: number;
  entryPrice: number;       // 다음거래일 시가
  entryDate: Date;
  liquidityRatio?: number;
  dayVolume?: number;       // F8 Phase2: 당일 거래량(주) — 매수 진입의 동적 슬리피지/부분체결용
  tradingSignalId?: string;
  positionThesisId?: string;
  fillParams?: Partial<FillParams>;
}

@Injectable()
export class PaperTradeService {
  constructor(
    private readonly repo: IPaperTradeRepository,
  ) {}

  async placeOrder(input: PlaceOrderInput): Promise<PaperTradeRecord> {
    const params: FillParams = {
      ...DEFAULT_FILL_PARAMS,
      ...input.fillParams,
    };

    const req: FillRequest = {
      direction: input.direction,
      orderedShares: input.orderedShares,
      entryPrice: input.entryPrice,
      liquidityRatio: input.liquidityRatio,
      dayVolume: input.dayVolume,
    };

    const fill = simulateFill(req, params);

    const record = await this.repo.save({
      corpCode: input.corpCode,
      stockCode: input.stockCode,
      direction: input.direction,
      orderedShares: input.orderedShares,
      filledShares: fill.filledShares,
      fillRate: fill.fillRate,
      entryPrice: input.entryPrice,
      filledPrice: fill.filledShares > 0 ? fill.filledPrice : null,
      commission: fill.commission,
      tax: fill.tax,
      slippageCost: fill.slippageCost,
      grossPnl: null,
      netPnl: null,
      returnPct: null,
      status: fill.status,
      entryDate: input.entryDate,
      filledAt: fill.filledShares > 0 ? new Date() : null,
      tradingSignalId: input.tradingSignalId ?? null,
      positionThesisId: input.positionThesisId ?? null,
    });

    return record;
  }
}
