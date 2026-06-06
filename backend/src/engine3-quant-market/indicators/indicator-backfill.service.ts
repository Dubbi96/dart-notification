import { Injectable, Logger } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { calcAllIndicators, AllIndicators, Candle } from './indicators';

export interface IndicatorBackfillResult {
  stocksProcessed: number;
  indicatorsWritten: number;
  stocksSkippedNoData: number;
  targetDates: string[];
  message?: string;
}

/**
 * DB 기반 기술지표 백필 (DAR-50).
 *
 * StockDailyPrice 일봉을 종목별로 로드 → 순수 함수 calcAllIndicators 로 계산 →
 * technical_indicators 적재(upsert). (stockCode, tradeDate) 자연키로 멱등.
 *
 * 인메모리 포트(IndicatorBatchService)와 달리 실 DB 시세를 직접 읽어 영속 지표를 만든다.
 * AI 금지영역: 지표 계산은 순수 Rule. AI/LLM 개입 절대 금지.
 */
@Injectable()
export class IndicatorBackfillService {
  private readonly logger = new Logger(IndicatorBackfillService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * @param opts.stockCodes 대상 종목코드 (생략 시 시세 보유 전 종목)
   * @param opts.mode 'latest' = 종목별 최신 거래일 1건만 / 'all' = 보유 전 거래일 (기본 'latest')
   * @param opts.minCandles 종목 처리 최소 캔들 수 (기본 1; ma20·rsi 등은 데이터 부족 시 null)
   */
  async backfill(
    opts: {
      stockCodes?: string[];
      mode?: 'latest' | 'all';
      minCandles?: number;
    } = {},
  ): Promise<IndicatorBackfillResult> {
    const mode = opts.mode ?? 'latest';
    const minCandles = opts.minCandles ?? 1;
    const stockCodes = opts.stockCodes ?? (await this.allPricedStockCodes());

    let stocksProcessed = 0;
    let indicatorsWritten = 0;
    let stocksSkippedNoData = 0;
    const targetDateSet = new Set<string>();

    this.logger.log(`[지표백필] 시작 종목=${stockCodes.length} mode=${mode}`);

    for (const stockCode of stockCodes) {
      const prices = await this.prisma.stockDailyPrice.findMany({
        where: { stockCode },
        orderBy: { tradeDate: 'asc' },
      });
      if (prices.length < minCandles) {
        stocksSkippedNoData++;
        continue;
      }

      const corpCode = prices[prices.length - 1].corpCode;
      const candles: Candle[] = prices.map((p) => ({
        date: p.tradeDate,
        open: p.openPrice,
        high: p.highPrice,
        low: p.lowPrice,
        close: p.closePrice,
        volume: Number(p.volume),
      }));

      const targetIdx =
        mode === 'all' ? candles.map((_, i) => i) : [candles.length - 1];

      for (const i of targetIdx) {
        const slice = candles.slice(0, i + 1);
        const ind = calcAllIndicators(slice, null);
        const tradeDate = candles[i].date;
        targetDateSet.add(tradeDate);

        const row: Prisma.TechnicalIndicatorCreateManyInput = {
          corpCode,
          stockCode,
          tradeDate,
          ...this.toIndicatorColumns(ind),
        };

        // 멱등 upsert: 기존 (stockCode, tradeDate) 갱신 (재실행 안전)
        await this.prisma.technicalIndicator.upsert({
          where: {
            stockCode_tradeDate: { stockCode, tradeDate },
          },
          create: row,
          update: this.toIndicatorColumns(ind),
        });
        indicatorsWritten++;
      }
      stocksProcessed++;
    }

    const result: IndicatorBackfillResult = {
      stocksProcessed,
      indicatorsWritten,
      stocksSkippedNoData,
      targetDates: [...targetDateSet].sort(),
    };
    this.logger.log(`[지표백필] 완료 ${JSON.stringify({ ...result, targetDates: result.targetDates.length })}`);
    return result;
  }

  /** AllIndicators → technical_indicators 컬럼. high52w/low52w 는 schema Int? → 반올림. */
  private toIndicatorColumns(ind: AllIndicators) {
    return {
      ma5: ind.ma5,
      ma20: ind.ma20,
      ma60: ind.ma60,
      ma120: ind.ma120,
      rsi14: ind.rsi14,
      macdLine: ind.macdLine,
      macdSignal: ind.macdSignal,
      macdHistogram: ind.macdHistogram,
      bollingerUpper: ind.bollingerUpper,
      bollingerMid: ind.bollingerMid,
      bollingerLower: ind.bollingerLower,
      atr14: ind.atr14,
      vwap: ind.vwap,
      volumeRatio20: ind.volumeRatio20,
      high52w: ind.high52w != null ? Math.round(ind.high52w) : null,
      low52w: ind.low52w != null ? Math.round(ind.low52w) : null,
      preDsclReturn: ind.preDsclReturn,
    };
  }

  private async allPricedStockCodes(): Promise<string[]> {
    const rows = await this.prisma.stockDailyPrice.findMany({
      distinct: ['stockCode'],
      select: { stockCode: true },
    });
    return rows.map((r) => r.stockCode);
  }
}
