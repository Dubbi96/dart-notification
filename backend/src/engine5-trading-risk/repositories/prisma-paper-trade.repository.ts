/**
 * PrismaPaperTradeRepository — 모의체결 영속화 어댑터 (M11, DAR-36)
 *
 * IPaperTradeRepository를 Prisma(`paper_trades` 테이블)로 구현한다.
 * M10-A에서 인메모리 어댑터로 시작 → DAR-36에서 Prisma로 교체(인메모리는 폴백·테스트용 유지).
 *
 * AI 금지영역: 체결 시뮬·Risk 판정은 순수 Rule(fill-simulator/risk-check). 이 어댑터는
 * 저장/조회만 담당 — 체결 결정·점수에 AI 개입 0. engine2/AI import 없음(risk-guard 통과).
 *
 * 스키마 변경 없음 — schema.prisma의 PaperTrade 모델 그대로 사용.
 *   · 컬럼명 주의: 도메인 `slippageCost` ↔ DB 컬럼 `slippage`.
 *   · Decimal 컬럼(fillRate/entryPrice/.../returnPct)은 Prisma가 Decimal 객체로 반환 →
 *     매핑 시 Number()로 도메인 number 복원.
 *   · id/createdAt은 DB 기본값(cuid/now)에 위임(인메모리 save의 Omit 시맨틱 보존).
 */

import { Injectable } from '@nestjs/common';
import { PaperTradeDirection, PaperTradeStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  IPaperTradeRepository,
  PaperTradeRecord,
} from './paper-trade.repository';
import { TradeStatus } from '../domain/paper-trade.types';

// Prisma row 형태 — Decimal 컬럼은 Decimal 객체(또는 number)로 반환되므로 Number()로 정규화
type PaperTradeRow = {
  id: string;
  corpCode: string;
  stockCode: string;
  direction: PaperTradeDirection;
  orderedShares: number;
  filledShares: number;
  fillRate: unknown;
  entryPrice: unknown;
  filledPrice: unknown | null;
  commission: unknown;
  tax: unknown;
  slippage: unknown;
  grossPnl: unknown | null;
  netPnl: unknown | null;
  returnPct: unknown | null;
  status: PaperTradeStatus;
  entryDate: Date;
  filledAt: Date | null;
  tradingSignalId: string | null;
  positionThesisId: string | null;
  createdAt: Date;
};

@Injectable()
export class PrismaPaperTradeRepository implements IPaperTradeRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * 모의체결 저장. id/createdAt은 DB가 채우므로 create에 넘기지 않는다
   * (인메모리 어댑터의 Omit<'id'|'createdAt'> 시맨틱과 동일).
   * 도메인 slippageCost → DB slippage 컬럼으로 매핑.
   */
  async save(
    record: Omit<PaperTradeRecord, 'id' | 'createdAt'>,
  ): Promise<PaperTradeRecord> {
    const row = await this.prisma.paperTrade.create({
      data: {
        corpCode: record.corpCode,
        stockCode: record.stockCode,
        direction: record.direction as PaperTradeDirection,
        orderedShares: record.orderedShares,
        filledShares: record.filledShares,
        fillRate: record.fillRate,
        entryPrice: record.entryPrice,
        filledPrice: record.filledPrice,
        commission: record.commission,
        tax: record.tax,
        slippage: record.slippageCost,
        grossPnl: record.grossPnl,
        netPnl: record.netPnl,
        returnPct: record.returnPct,
        status: record.status as PaperTradeStatus,
        entryDate: record.entryDate,
        filledAt: record.filledAt,
        tradingSignalId: record.tradingSignalId,
        positionThesisId: record.positionThesisId,
      },
    });
    return this.toDomain(row);
  }

  async findById(id: string): Promise<PaperTradeRecord | null> {
    const row = await this.prisma.paperTrade.findUnique({ where: { id } });
    return row ? this.toDomain(row) : null;
  }

  async findByStatus(status: TradeStatus): Promise<PaperTradeRecord[]> {
    const rows = await this.prisma.paperTrade.findMany({
      where: { status: status as PaperTradeStatus },
    });
    return rows.map((r) => this.toDomain(r));
  }

  async findAll(): Promise<PaperTradeRecord[]> {
    const rows = await this.prisma.paperTrade.findMany();
    return rows.map((r) => this.toDomain(r));
  }

  // ─── Prisma row → 도메인 레코드 매핑 (Decimal→number, slippage→slippageCost) ──
  private toDomain(row: PaperTradeRow): PaperTradeRecord {
    return {
      id: row.id,
      corpCode: row.corpCode,
      stockCode: row.stockCode,
      direction: row.direction as 'BUY' | 'SELL',
      orderedShares: row.orderedShares,
      filledShares: row.filledShares,
      fillRate: Number(row.fillRate),
      entryPrice: Number(row.entryPrice),
      filledPrice: row.filledPrice == null ? null : Number(row.filledPrice),
      commission: Number(row.commission),
      tax: Number(row.tax),
      slippageCost: Number(row.slippage),
      grossPnl: row.grossPnl == null ? null : Number(row.grossPnl),
      netPnl: row.netPnl == null ? null : Number(row.netPnl),
      returnPct: row.returnPct == null ? null : Number(row.returnPct),
      status: row.status as TradeStatus,
      entryDate: row.entryDate,
      filledAt: row.filledAt,
      tradingSignalId: row.tradingSignalId,
      positionThesisId: row.positionThesisId,
      createdAt: row.createdAt,
    };
  }
}
