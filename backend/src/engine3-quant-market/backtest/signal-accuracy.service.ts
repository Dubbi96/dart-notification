/**
 * signal-accuracy.service.ts — 신호 사후검증 백테스트 서비스 (M9 백테스트, DAR-73)
 *
 * 과거 TradingSignal 을 등급·스코어 구간·eventType 별로 묶어 D+5/D+20 실현 초과수익
 * (시장 대비 누적 AR)을 집계한다. 기존 EventStudy 의 calcAR(시장 대비 초과수익) 산식과
 * StockDailyPrice/MarketIndex/Company.market 데이터를 그대로 재사용한다.
 *
 * ★ read-only — 신규 수집·외부호출·AI 개입 0. 가중치/임계값을 변경하지 않는다.
 *   D0 는 disclosure.rcpDt → calcD0(lookahead bias 방지) 로 산출하고, 가격이 모자라
 *   D+5/D+20 을 산출할 수 없는 신호는 해당 지평에서 null 로 제외한다(과신 방지).
 */
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { calcAR, PriceWindow } from '../event-study/utils/abnormal-return';
import { calcD0 } from '../event-study/utils/d0-calculator';
import {
  buildSignalAccuracyReport,
  SignalAccuracyReport,
  SignalRealizedReturn,
} from './signal-accuracy';
import { buildCalibrationReport, CalibrationReport } from './calibration';

const KOSPI_CODE = '0001';
const KOSDAQ_CODE = '1001';

/** D+5 산출에 필요한 최소 가격 포인트(D0..D+5 = 6개) */
const MIN_POINTS_D5 = 6;
/** D+20 산출에 필요한 최소 가격 포인트(D0..D+20 = 21개) */
const MIN_POINTS_D20 = 21;

/** 가격 윈도우 조회 종료일 여유(D0 + 이 일수). D+20 거래일 확보용 달력 여유. */
const WINDOW_CALENDAR_DAYS = 45;

export interface SignalAccuracyParams {
  /** 집계 대상 신호 최대 수(최신순). 과도한 조회 방지 기본값. */
  limit?: number;
  /** 특정 eventType 만 필터(선택) */
  eventType?: string;
  /** 특정 signalGrade 만 필터(선택) */
  signalGrade?: string;
}

@Injectable()
export class SignalAccuracyService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * 신호 사후검증 정밀도 리포트.
   * 가격 데이터로 D+20 까지 실현 가능한(충분히 과거의) 신호만 자연 포함된다.
   */
  async getSignalAccuracy(params: SignalAccuracyParams = {}): Promise<SignalAccuracyReport> {
    const limit = Math.min(Math.max(params.limit ?? 1000, 1), 5000);

    const signals = await this.prisma.tradingSignal.findMany({
      where: {
        ...(params.eventType ? { eventType: params.eventType } : {}),
        ...(params.signalGrade ? { signal: params.signalGrade as never } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
      select: {
        rcpNo: true,
        stockCode: true,
        eventType: true,
        buyScore: true,
        signal: true,
        disclosure: { select: { rcpDt: true } },
        company: { select: { market: true } },
      },
    });

    const returns: SignalRealizedReturn[] = [];
    for (const s of signals) {
      const realized = await this.computeRealizedReturn(
        s.stockCode,
        s.disclosure?.rcpDt ?? null,
        s.company?.market ?? null,
      );
      returns.push({
        signalGrade: s.signal,
        buyScore: s.buyScore,
        eventType: s.eventType,
        arD5: realized.arD5,
        arD20: realized.arD20,
      });
    }

    return buildSignalAccuracyReport(returns);
  }

  /**
   * 신호 보정 루프 리포트(DAR-83): 실현 초과수익 vs EVENT_BASE_SCORES 괴리·권장 delta.
   * ★ read-only — getSignalAccuracy 의 집계를 buildCalibrationReport 로 권고값(diff)으로 변환만 한다.
   *   상수를 자동 변경하지 않는다(사람 PR 전용).
   */
  async getCalibration(params: SignalAccuracyParams = {}): Promise<CalibrationReport> {
    const accuracy = await this.getSignalAccuracy(params);
    return buildCalibrationReport(accuracy);
  }

  /**
   * 단일 신호의 D+5/D+20 실현 초과수익(시장 대비 누적 AR, %) 산출.
   * 가격/시장지수 데이터가 부족하면 해당 지평을 null 로 반환(graceful).
   */
  private async computeRealizedReturn(
    stockCode: string,
    rcpDt: string | null,
    market: string | null,
  ): Promise<{ arD5: number | null; arD20: number | null }> {
    if (!rcpDt || !market) return { arD5: null, arD20: null };

    const d0 = calcD0(rcpDt); // YYYYMMDD, lookahead bias 방지(다음 거래일/당일 컷오프)
    const windowEnd = addCalendarDays(d0, WINDOW_CALENDAR_DAYS);

    const stockRows = await this.prisma.stockDailyPrice.findMany({
      where: { stockCode, tradeDate: { gte: d0, lte: windowEnd } },
      orderBy: { tradeDate: 'asc' },
      select: { tradeDate: true, closePrice: true },
    });
    if (stockRows.length < MIN_POINTS_D5) return { arD5: null, arD20: null };

    // 첫 거래일(D0 on/after rcp D0)을 실효 D0 로 스냅
    const effectiveD0 = stockRows[0].tradeDate;

    const indexCode = market === 'KOSDAQ' ? KOSDAQ_CODE : KOSPI_CODE;
    const marketRows = await this.prisma.marketIndex.findMany({
      where: { indexCode, tradeDate: { gte: d0, lte: windowEnd } },
      orderBy: { tradeDate: 'asc' },
      select: { tradeDate: true, closeIndex: true },
    });
    if (marketRows.length < MIN_POINTS_D5) return { arD5: null, arD20: null };

    const stockPrices: PriceWindow[] = stockRows.map((r) => ({
      date: r.tradeDate,
      closePrice: r.closePrice,
    }));
    const marketPrices: PriceWindow[] = marketRows.map((r) => ({
      date: r.tradeDate,
      closePrice: r.closeIndex,
    }));

    const ar = calcAR(stockPrices, marketPrices, effectiveD0);

    // 지평별 데이터 충분성 검증(부족 시 null)
    const arD5 = stockRows.length >= MIN_POINTS_D5 ? round2(ar.cumulativeAR['d5'] ?? null) : null;
    const arD20 = stockRows.length >= MIN_POINTS_D20 ? round2(ar.cumulativeAR['d20'] ?? null) : null;
    return { arD5, arD20 };
  }
}

/** YYYYMMDD + n일(달력) → YYYYMMDD */
function addCalendarDays(yyyymmdd: string, days: number): string {
  const y = parseInt(yyyymmdd.slice(0, 4), 10);
  const m = parseInt(yyyymmdd.slice(4, 6), 10);
  const d = parseInt(yyyymmdd.slice(6, 8), 10);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  const yy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(dt.getUTCDate()).padStart(2, '0');
  return `${yy}${mm}${dd}`;
}

function round2(v: number | null): number | null {
  if (v === null || v === undefined) return null;
  return Math.round(v * 100) / 100;
}
