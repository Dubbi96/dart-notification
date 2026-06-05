/**
 * 런타임 신호 생성 서비스 — BuyScore → TradingSignal persist (DAR-41)
 *
 * 끊긴 파이프라인 링크 연결: DisclosureEvent + StockDailyPrice 가 있고 아직
 * TradingSignal 이 없는 공시에 대해 BuyScoreParams 를 조립 → computeBuyScore()
 * → TradingSignal 영속화. 멱등: 같은 (rcpNo, persona) 중복 생성 금지.
 *
 * AI 금지영역: BuyScore 계산·persona view 파생은 순수 Rule. AI/LLM 개입 절대 금지.
 * (signalSummary 는 기존 캐시된 DisclosureAnalysis 요약을 참조만 — 새 AI 호출 없음)
 */

import { Injectable, Logger } from '@nestjs/common';
import { Prisma, SignalGrade } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  BuySignalService,
  BuyScoreParams,
  BuySignalResult,
} from '../buy-signal/buy-signal.service';
import { PERSONA_TYPES, PersonaType } from '../buy-signal/config/buy-signal.config';
import { derivePersonaViews } from './persona-view.rule';

export interface SignalGenerationSummary {
  candidates: number;
  created: number;
  skipped: number;
  gradeDist: Record<string, number>;
  triggeredBy: string;
  message?: string;
}

interface StockContext {
  closePrice: number | null;
  volume: number | null;
  tradingValue: number | null;
  ma5: number | null;
  ma20: number | null;
  ma60: number | null;
  rsi14: number | null;
  macdLine: number | null;
  macdSignal: number | null;
  bollingerMid: number | null;
  preDsclReturn: number | null;
  avgVolume20: number | null;
  avgValue20: number | null;
  volumeRatio20: number | null;
  isTradingSuspended: boolean;
  isManagement: boolean;
  isInvestmentCaution: boolean;
  isAbnormalSurge: boolean;
}

interface MarketContext {
  kospiChange1d: number | null;
  kosdaqChange1d: number | null;
}

const KOSPI_CODE = '0001';
const KOSDAQ_CODE = '1001';

function toNum(v: number | bigint | null | undefined): number | null {
  if (v == null) return null;
  return typeof v === 'bigint' ? Number(v) : v;
}

@Injectable()
export class SignalGenerationService {
  private readonly logger = new Logger(SignalGenerationService.name);
  private isRunning = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly buySignal: BuySignalService,
  ) {}

  /**
   * 대상 공시(이벤트+시세 있고 TradingSignal 없는)에 대해 신호를 생성·영속화한다.
   * @param personas 생성할 persona 목록 (기본: 4 Persona 전부)
   */
  async generateMissingSignals(
    triggeredBy: 'CRON' | 'MANUAL' = 'MANUAL',
    personas: readonly PersonaType[] = PERSONA_TYPES,
  ): Promise<SignalGenerationSummary> {
    if (this.isRunning) {
      this.logger.warn('[SignalGen] 신호 생성이 이미 진행 중입니다.');
      return {
        candidates: 0,
        created: 0,
        skipped: 0,
        gradeDist: {},
        triggeredBy,
        message: '이전 작업 진행 중',
      };
    }
    this.isRunning = true;
    const gradeDist: Record<string, number> = {};
    let created = 0;
    let skipped = 0;

    try {
      this.logger.log(`[SignalGen] 신호 생성 시작 [${triggeredBy}]`);

      // 1. 시세(StockDailyPrice) 보유 종목 집합
      const pricedStocks = await this.prisma.stockDailyPrice.findMany({
        distinct: ['stockCode'],
        select: { stockCode: true },
      });
      const pricedSet = new Set(pricedStocks.map((s) => s.stockCode));

      // 2. 후보 이벤트: 종목코드 + 시세 보유
      const events = await this.prisma.disclosureEvent.findMany({
        select: {
          rcpNo: true,
          corpCode: true,
          eventType: true,
          polarity: true,
          isAmendment: true,
          extractedData: true,
          company: { select: { stockCode: true, market: true } },
        },
      });
      const candidates = events.filter(
        (e) => e.company?.stockCode && pricedSet.has(e.company.stockCode),
      );

      if (candidates.length === 0) {
        this.logger.log('[SignalGen] 대상 공시 없음 (이벤트+시세 교집합 0)');
        return { candidates: 0, created: 0, skipped: 0, gradeDist, triggeredBy };
      }

      // 3. 멱등: 기존 (rcpNo, persona) 집합
      const existing = await this.prisma.tradingSignal.findMany({
        select: { rcpNo: true, persona: true },
      });
      const existingSet = new Set(
        existing.map((s) => `${s.rcpNo}::${s.persona}`),
      );

      // 4. 시장·이벤트스터디·요약 컨텍스트 (배치 로드)
      const marketCtx = await this.loadMarketContext();
      const esrMap = await this.loadEventStudyMap();
      const summaryMap = await this.loadSummaryMap(
        candidates.map((c) => c.rcpNo),
      );
      const stockCtxCache = new Map<string, StockContext>();

      for (const ev of candidates) {
        const stockCode = ev.company!.stockCode!;
        let stockCtx = stockCtxCache.get(stockCode);
        if (!stockCtx) {
          stockCtx = await this.loadStockContext(stockCode);
          stockCtxCache.set(stockCode, stockCtx);
        }

        const marketType = ev.company?.market ?? 'ALL';
        const avgArD5 =
          esrMap.get(`${ev.eventType}::${marketType}`) ??
          esrMap.get(`${ev.eventType}::ALL`) ??
          null;

        for (const persona of personas) {
          const key = `${ev.rcpNo}::${persona}`;
          if (existingSet.has(key)) {
            skipped++;
            continue;
          }

          const params = this.buildParams(
            ev,
            persona,
            stockCtx,
            marketCtx,
            avgArD5,
            summaryMap.get(ev.rcpNo),
          );
          const result = this.buySignal.computeBuyScore(params);

          try {
            await this.prisma.tradingSignal.create({
              data: this.toCreateData(result),
            });
            created++;
            existingSet.add(key);
            gradeDist[result.signal] = (gradeDist[result.signal] ?? 0) + 1;
          } catch (err) {
            // 동시 생성 등으로 (rcpNo, persona) 유니크 충돌 → 멱등 스킵
            if (
              err instanceof Prisma.PrismaClientKnownRequestError &&
              err.code === 'P2002'
            ) {
              skipped++;
              continue;
            }
            throw err;
          }
        }
      }

      this.logger.log(
        `[SignalGen] 완료 candidates=${candidates.length} created=${created} skipped=${skipped} dist=${JSON.stringify(gradeDist)}`,
      );
      return {
        candidates: candidates.length,
        created,
        skipped,
        gradeDist,
        triggeredBy,
      };
    } finally {
      this.isRunning = false;
    }
  }

  /** 종목별 최신 시세·지표·상태 컨텍스트 */
  private async loadStockContext(stockCode: string): Promise<StockContext> {
    const [price, ti, status] = await Promise.all([
      this.prisma.stockDailyPrice.findFirst({
        where: { stockCode },
        orderBy: { tradeDate: 'desc' },
      }),
      this.prisma.technicalIndicator.findFirst({
        where: { stockCode },
        orderBy: { tradeDate: 'desc' },
      }),
      this.prisma.stockStatus.findUnique({ where: { stockCode } }),
    ]);

    return {
      closePrice: toNum(price?.closePrice ?? null),
      volume: toNum(price?.volume ?? null),
      tradingValue: toNum(price?.tradingValue ?? null),
      ma5: ti?.ma5 ?? null,
      ma20: ti?.ma20 ?? null,
      ma60: ti?.ma60 ?? null,
      rsi14: ti?.rsi14 ?? null,
      macdLine: ti?.macdLine ?? null,
      macdSignal: ti?.macdSignal ?? null,
      bollingerMid: ti?.bollingerMid ?? null,
      preDsclReturn: ti?.preDsclReturn ?? null,
      avgVolume20:
        ti?.volumeRatio20 != null && price?.volume != null
          ? Number(price.volume) / ti.volumeRatio20
          : null,
      avgValue20: null,
      volumeRatio20: ti?.volumeRatio20 ?? null,
      isTradingSuspended: status?.isTradingSuspended ?? false,
      isManagement: status?.isManagement ?? false,
      isInvestmentCaution: status?.isInvestmentCaution ?? false,
      isAbnormalSurge: status?.isAbnormalSurge ?? false,
    };
  }

  /** KOSPI/KOSDAQ 전일 대비 변동률 (%) 스냅샷 */
  private async loadMarketContext(): Promise<MarketContext> {
    const change = async (code: string): Promise<number | null> => {
      const rows = await this.prisma.marketIndex.findMany({
        where: { indexCode: code },
        orderBy: { tradeDate: 'desc' },
        take: 2,
      });
      if (rows.length < 2 || rows[1].closeIndex === 0) return null;
      return ((rows[0].closeIndex - rows[1].closeIndex) / rows[1].closeIndex) * 100;
    };
    const [kospiChange1d, kosdaqChange1d] = await Promise.all([
      change(KOSPI_CODE),
      change(KOSDAQ_CODE),
    ]);
    return { kospiChange1d, kosdaqChange1d };
  }

  /** EventStudyResult → `${eventType}::${marketType}` → avgArD5 */
  private async loadEventStudyMap(): Promise<Map<string, number>> {
    const rows = await this.prisma.eventStudyResult.findMany({
      where: { status: 'READY' },
      select: { eventType: true, marketType: true, avgArD5: true },
    });
    const map = new Map<string, number>();
    for (const r of rows) {
      map.set(`${r.eventType}::${r.marketType}`, r.avgArD5);
    }
    return map;
  }

  /** 기존 캐시된 AI 요약(task=summary) → rcpNo → summary 텍스트 (새 AI 호출 없음) */
  private async loadSummaryMap(
    rcpNos: string[],
  ): Promise<Map<string, string>> {
    const rows = await this.prisma.disclosureAnalysis.findMany({
      where: { rcpNo: { in: rcpNos }, task: 'summary' },
      select: { rcpNo: true, resultJson: true },
    });
    const map = new Map<string, string>();
    for (const r of rows) {
      const json = r.resultJson as { summary?: unknown } | null;
      if (json && typeof json.summary === 'string') {
        map.set(r.rcpNo, json.summary);
      }
    }
    return map;
  }

  /** DB 컨텍스트 → BuyScoreParams 조립 */
  private buildParams(
    ev: {
      rcpNo: string;
      eventType: string;
      polarity: string;
      isAmendment: boolean;
      extractedData: Prisma.JsonValue;
      company: { stockCode: string | null; market: string | null } | null;
    },
    persona: PersonaType,
    s: StockContext,
    m: MarketContext,
    avgArD5: number | null,
    signalSummary: string | undefined,
  ): BuyScoreParams {
    const extractedData =
      ev.extractedData && typeof ev.extractedData === 'object' && !Array.isArray(ev.extractedData)
        ? (ev.extractedData as Record<string, number | string | null>)
        : {};
    const dilutionRaw = extractedData['dilutionRate'];
    const dilutionRate =
      typeof dilutionRaw === 'number'
        ? dilutionRaw
        : typeof dilutionRaw === 'string' && dilutionRaw !== '' && !isNaN(Number(dilutionRaw))
          ? Number(dilutionRaw)
          : null;

    return {
      rcpNo: ev.rcpNo,
      corpCode: '', // company 역정규화 — toCreateData 에서 별도 주입
      stockCode: ev.company?.stockCode ?? '',
      persona,
      disclosureEvent: { eventType: ev.eventType, polarity: ev.polarity },
      keyMetric: { eventType: ev.eventType, extractedData },
      personaFitInput: {
        personaViews: derivePersonaViews(ev.eventType, ev.polarity),
        userPersona: persona,
      },
      historicalEvent: { avgArD5 },
      chart: {
        closePrice: s.closePrice,
        ma5: s.ma5,
        ma20: s.ma20,
        ma60: s.ma60,
        rsi14: s.rsi14,
        macdLine: s.macdLine,
        macdSignal: s.macdSignal,
        bollingerMid: s.bollingerMid,
        preDsclReturn: s.preDsclReturn,
      },
      volumeLiquidity: {
        volume: s.volume,
        avgVolume20: s.avgVolume20,
        tradingValue: s.tradingValue,
        avgValue20: s.avgValue20,
      },
      marketSector: {
        kospiChange1d: m.kospiChange1d,
        kosdaqChange1d: m.kosdaqChange1d,
        sectorChange1d: null,
        vixEquivalent: null,
      },
      riskPenalty: {
        eventType: ev.eventType,
        isAmendment: ev.isAmendment,
        preDsclReturn: s.preDsclReturn,
        isTradingSuspended: s.isTradingSuspended,
        isManagement: s.isManagement,
        isInvestmentCaution: s.isInvestmentCaution,
        isAbnormalSurge: s.isAbnormalSurge,
        dilutionRate,
        avgDailyVolume: s.avgVolume20,
      },
      entryCondition: {
        closePrice: s.closePrice,
        ma20: s.ma20,
        rsi14: s.rsi14,
        tradingValue: s.tradingValue,
        volumeRatio20: s.volumeRatio20,
      },
      signalSummary,
    };
  }

  /** BuySignalResult → TradingSignal create payload */
  private toCreateData(
    r: BuySignalResult,
  ): Prisma.TradingSignalUncheckedCreateInput {
    return {
      rcpNo: r.rcpNo,
      corpCode: r.corpCode,
      stockCode: r.stockCode,
      eventType: r.eventType,
      subCategory: r.subCategory ?? null,
      persona: r.persona,
      buyScore: r.buyScore,
      signal: r.signal as SignalGrade,
      scoreBreakdown: r.scoreBreakdown as unknown as Prisma.InputJsonValue,
      riskPenalty: Math.round(r.riskPenalty),
      entryConditionMet: r.entryConditionMet,
      entryConditionUnmet: r.entryConditionUnmet,
      entryReady: r.entryReady,
      riskFactors: r.riskFactors,
      signalSummary: r.signalSummary ?? null,
      blockedReason: r.blockedReason ?? null,
      validUntil: r.validUntil ?? null,
    };
  }
}
