import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AiCostLevel } from '../types/ai-analyst.types';
import {
  PriceMoveReasoningRecord,
  PriceMoveReasoningRepository,
} from './price-move-reasoning.repository';
import { PriceMoveReasoningStatus } from './price-move-reasoning.constants';

/** PriceMoveReasoning(Prisma) 어댑터 — refId 자연키 upsert(멱등). */
@Injectable()
export class PrismaPriceMoveReasoningRepository extends PriceMoveReasoningRepository {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async find(refId: string): Promise<PriceMoveReasoningRecord | null> {
    const row = await this.prisma.priceMoveReasoning.findUnique({ where: { refId } });
    if (!row) return null;
    return {
      refId: row.refId,
      stockCode: row.stockCode,
      corpCode: row.corpCode,
      tradeDate: row.tradeDate,
      changePct: row.changePct,
      rcpNo: row.rcpNo,
      status: row.status as PriceMoveReasoningStatus,
      level: (row.level as AiCostLevel | null) ?? null,
      resultJson: row.resultJson,
      createdAt: row.createdAt,
    };
  }

  async save(record: PriceMoveReasoningRecord): Promise<void> {
    const data = {
      stockCode: record.stockCode,
      corpCode: record.corpCode,
      tradeDate: record.tradeDate,
      changePct: record.changePct,
      rcpNo: record.rcpNo,
      status: record.status,
      level: (record.level as any) ?? null,
      resultJson: record.resultJson as any,
    };
    await this.prisma.priceMoveReasoning.upsert({
      where: { refId: record.refId },
      create: { refId: record.refId, ...data },
      update: data,
    });
  }
}
