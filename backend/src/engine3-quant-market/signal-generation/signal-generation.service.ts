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

import { Injectable, Logger, Optional } from '@nestjs/common';
import { Prisma, SignalGrade } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationProducerService } from '../../notifications/notification-producer.service';
import {
  BuySignalService,
  BuyScoreParams,
  BuySignalResult,
} from '../buy-signal/buy-signal.service';
import { PERSONA_TYPES, PersonaType } from '../buy-signal/config/buy-signal.config';
import { InsiderInput } from '../buy-signal/scoring/insider.scorer';
import {
  FundamentalInput,
  FundamentalGrowthInput,
  FundamentalFiledFactInput,
} from '../buy-signal/scoring/fundamental.scorer';
import { derivePersonaViews, ImpactMagnitude } from './persona-view.rule';
import {
  classifyBucket,
  EventExtractedData,
} from '../event-study/utils/bucket-classifier';
import { SignalAccuracyService } from '../backtest/signal-accuracy.service';
import {
  gradeCoefficientMap,
  applyConfidenceCoefficient,
  NO_DISCOUNT_COEFFICIENT,
} from '../backtest/calibration';

/**
 * 이벤트 임팩트 규모(상대비율 우선·절대금액 폴백) 산출 (DAR-79).
 *
 * - SHARE_BUYBACK: buybackRatioToSales(취득금액/매출) 우선. 추출값 결측 시 CompanyFinancial.revenue로
 *   재계산(buybackAmount/revenue*100). 둘 다 없으면 절대 취득금액 폴백.
 * - SUPPLY_CONTRACT: salesRatio(계약금액/매출) 우선, 결측 시 절대 계약금액 폴백.
 * - 그 외 이벤트: 규모 미반영(undefined) → persona-view 기존 동작 유지(회귀 0).
 *
 * 신규 외부 수집 없음 — 기존 추출값(extractedData)·CompanyFinancial.revenue만 활용.
 */
function deriveImpactMagnitude(
  eventType: string,
  extractedData: Record<string, number | string | null>,
  revenue: number | null,
): ImpactMagnitude | undefined {
  const numOf = (v: number | string | null | undefined): number | null => {
    if (v == null || v === '') return null;
    const n = Number(v);
    return isFinite(n) ? n : null;
  };

  switch (eventType) {
    case 'SHARE_BUYBACK': {
      const amount = numOf(extractedData['buybackAmount']);
      let ratio = numOf(extractedData['buybackRatioToSales']);
      // 추출값 결측 시 CompanyFinancial.revenue로 정규화 비율 보강
      if (ratio === null && amount !== null && revenue !== null && revenue > 0) {
        ratio = Math.round((amount / revenue) * 100 * 100) / 100;
      }
      if (ratio === null && amount === null) return undefined;
      return { relativeRatio: ratio, absoluteAmount: amount };
    }
    case 'SUPPLY_CONTRACT': {
      const amount = numOf(extractedData['contractAmount']);
      const ratio = numOf(extractedData['salesRatio']);
      if (ratio === null && amount === null) return undefined;
      return { relativeRatio: ratio, absoluteAmount: amount };
    }
    default:
      return undefined;
  }
}

/**
 * EventStudyResult 에서 historical-event 채점에 쓰는 통계 신호 묶음 (DAR-70).
 * 기존엔 avgArD5 한 값만 전달했으나, 버려지던 유의성·확률·표본수까지 함께 전달한다.
 */
interface EventStudyStats {
  avgArD5: number;
  isSignificant: boolean;
  upProbD5: number;
  crashProbD5: number;
  sampleCount: number;
}

/**
 * EventStudyResult 조회 맵 (DAR-70).
 * - bucket: `${eventType}::${marketType}::${bucketKey}` → 버킷 단위 통계
 * - agg: `${eventType}::${marketType}` → 버킷 표본가중 평균 (버킷 미스 시 폴백)
 */
interface EventStudyMaps {
  bucket: Map<string, EventStudyStats>;
  agg: Map<string, EventStudyStats>;
}

export interface SignalGenerationSummary {
  candidates: number;
  created: number;
  /** 재채점으로 갱신된 기존 신호 수 (regenerate 모드, DAR-50) */
  updated: number;
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

  /** DAR-85: 푸시 통지 대상 등급(고확신 매수만). */
  private static readonly NOTIFY_GRADES: ReadonlySet<string> = new Set([
    'STRONG_BUY',
    'BUY',
  ]);

  constructor(
    private readonly prisma: PrismaService,
    private readonly buySignal: BuySignalService,
    // DAR-85: 신호 생성 시점에 NOTIFY 큐로 enqueue(엔진 직접 발송 금지).
    // @Optional — 큐/모듈 미주입 환경(일부 단위 테스트)에서도 안전.
    @Optional()
    private readonly notifyProducer?: NotificationProducerService,
    // DAR-91: calibration(getCalibration) 결과를 읽어 등급별 confidence 보정계수 환류.
    // @Optional — 미주입 환경(일부 단위 테스트)에서는 무보정(계수 1.0)으로 graceful.
    @Optional()
    private readonly accuracy?: SignalAccuracyService,
  ) {}

  /**
   * 대상 공시(이벤트+시세 있고 TradingSignal 없는)에 대해 신호를 생성·영속화한다.
   * @param personas 생성할 persona 목록 (기본: 4 Persona 전부)
   */
  async generateMissingSignals(
    triggeredBy: 'CRON' | 'MANUAL' = 'MANUAL',
    personas: readonly PersonaType[] = PERSONA_TYPES,
    overwrite = false,
  ): Promise<SignalGenerationSummary> {
    if (this.isRunning) {
      this.logger.warn('[SignalGen] 신호 생성이 이미 진행 중입니다.');
      return {
        candidates: 0,
        created: 0,
        updated: 0,
        skipped: 0,
        gradeDist: {},
        triggeredBy,
        message: '이전 작업 진행 중',
      };
    }
    this.isRunning = true;
    const gradeDist: Record<string, number> = {};
    let created = 0;
    let updated = 0;
    let skipped = 0;

    try {
      this.logger.log(
        `[SignalGen] 신호 ${overwrite ? '재생성(재채점)' : '생성'} 시작 [${triggeredBy}]`,
      );

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
        return { candidates: 0, created: 0, updated: 0, skipped: 0, gradeDist, triggeredBy };
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
      const esrMaps = await this.loadEventStudyMap();
      const summaryMap = await this.loadSummaryMap(
        candidates.map((c) => c.rcpNo),
      );
      // DAR-79: 취득금액 매출 대비 정규화용 corpCode→매출 맵 (기존 CompanyFinancial 활용, 신규 수집 0)
      const revenueMap = await this.loadRevenueMap(
        candidates.map((c) => c.corpCode),
      );
      // DAR-88: corpCode→내부자/대량보유 동향 맵 (DAR-87 적재분 종단 연결, 신규 수집 0)
      const insiderMap = await this.loadInsiderMap(
        candidates.map((c) => c.corpCode),
      );
      // DAR-100: corpCode→재무 성장률 맵 (DAR-93 산출분), rcpNo→본문 정량값 맵 (DAR-95 적재분).
      //   사장되던 두 자산을 신호 입력 피처로 활성화. 신규 수집·AI 개입 0(기존 적재 read-only).
      const growthMap = await this.loadGrowthMap(
        candidates.map((c) => c.corpCode),
      );
      const filedFactMap = await this.loadFiledFactMap(
        candidates.map((c) => c.rcpNo),
      );
      // DAR-91: calibration 등급별 confidence 보정계수 맵 (백테스트 실현 적중률 환류).
      // 1회 로드해 배치 전체에 재사용. 미주입/실패/표본부족 시 빈 맵 → 무보정(계수 1.0).
      const gradeCoeff = await this.loadGradeCoefficients();
      const stockCtxCache = new Map<string, StockContext>();

      for (const ev of candidates) {
        const stockCode = ev.company!.stockCode!;
        let stockCtx = stockCtxCache.get(stockCode);
        if (!stockCtx) {
          stockCtx = await this.loadStockContext(stockCode);
          stockCtxCache.set(stockCode, stockCtx);
        }

        const marketType = ev.company?.market ?? 'ALL';
        const esrStats = this.resolveEventStudy(esrMaps, ev, marketType);

        for (const persona of personas) {
          const key = `${ev.rcpNo}::${persona}`;
          const exists = existingSet.has(key);
          // 신규생성 모드(overwrite=false)에서는 기존 신호 스킵(멱등).
          // 재생성 모드(overwrite=true)에서는 기존 신호를 재채점하여 갱신.
          if (exists && !overwrite) {
            skipped++;
            continue;
          }

          const params = this.buildParams(
            ev,
            persona,
            stockCtx,
            marketCtx,
            esrStats,
            summaryMap.get(ev.rcpNo),
            revenueMap.get(ev.corpCode) ?? null,
            insiderMap.get(ev.corpCode) ?? { trades: [] },
            {
              growth: growthMap.get(ev.corpCode) ?? null,
              filedFacts: filedFactMap.get(ev.rcpNo) ?? null,
            },
          );
          const result = this.buySignal.computeBuyScore(params);

          // DAR-91: 등급 보정계수 적용 → calibratedConfidence (원본 buyScore 보존).
          //   계수 결측(미보정/표본부족/비매수 등급)은 1.0 → calibratedConfidence = buyScore.
          const coefficient = gradeCoeff.get(result.signal) ?? NO_DISCOUNT_COEFFICIENT;
          const calibratedConfidence = applyConfidenceCoefficient(
            result.buyScore,
            coefficient,
          );

          try {
            if (exists) {
              await this.prisma.tradingSignal.update({
                where: { rcpNo_persona: { rcpNo: ev.rcpNo, persona } },
                data: this.toUpdateData(result, calibratedConfidence),
              });
              updated++;
            } else {
              const createdSig = await this.prisma.tradingSignal.create({
                data: this.toCreateData(result, calibratedConfidence),
                select: { id: true },
              });
              created++;
              existingSet.add(key);
              // DAR-85: 신규 매수신호(STRONG_BUY/BUY)만 큐로 통지 enqueue.
              await this.maybeEnqueueSignal(createdSig.id, result, ev.company?.stockCode);
            }
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
        `[SignalGen] 완료 candidates=${candidates.length} created=${created} updated=${updated} skipped=${skipped} dist=${JSON.stringify(gradeDist)}`,
      );
      return {
        candidates: candidates.length,
        created,
        updated,
        skipped,
        gradeDist,
        triggeredBy,
      };
    } finally {
      this.isRunning = false;
    }
  }

  /**
   * 신호 재생성·재채점 (DAR-50).
   * 기존 (rcpNo, persona) 신호를 재계산하여 upsert(갱신)한다. 누락 신호는 신규 생성.
   * TI 백필 후 chart·entryReady 반영이 파생 trading_signals 에 반영되도록 한다.
   * 사용자 데이터(주가·공시) 무변경 — 파생 신호만 갱신.
   */
  async regenerateSignals(
    triggeredBy: 'CRON' | 'MANUAL' = 'MANUAL',
    personas: readonly PersonaType[] = PERSONA_TYPES,
  ): Promise<SignalGenerationSummary> {
    return this.generateMissingSignals(triggeredBy, personas, true);
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

  /**
   * EventStudyResult 조회 맵 적재 (DAR-70).
   *
   * - bucket 맵: `${eventType}::${marketType}::${bucketKey}` → 버킷 단위 통계.
   *   같은 이벤트타입이라도 규모/강도(bucketKey)별 D+5 초과수익이 크게 달라
   *   평균 하나로 뭉개지 않도록 버킷 단위로 보존한다.
   * - agg 맵: `${eventType}::${marketType}` → 버킷 표본가중 평균. 버킷 미스 시 폴백.
   *
   * avgArD5 외에 isSignificant·upProbD5·crashProbD5·sampleCount 도 함께 적재해
   * historical-event.scorer 가 버려지던 통계 신호를 반영할 수 있게 한다.
   */
  private async loadEventStudyMap(): Promise<EventStudyMaps> {
    const rows = await this.prisma.eventStudyResult.findMany({
      where: { status: 'READY' },
      select: {
        eventType: true,
        marketType: true,
        bucketKey: true,
        avgArD5: true,
        isSignificant: true,
        upProbD5: true,
        crashProbD5: true,
        sampleCount: true,
      },
    });

    const bucket = new Map<string, EventStudyStats>();
    // (eventType::marketType) 별 버킷 통계 누적 → 표본가중 평균 산출용
    const groups = new Map<string, EventStudyStats[]>();

    for (const r of rows) {
      const stats: EventStudyStats = {
        avgArD5: r.avgArD5,
        isSignificant: r.isSignificant,
        upProbD5: r.upProbD5,
        crashProbD5: r.crashProbD5,
        sampleCount: r.sampleCount,
      };
      bucket.set(`${r.eventType}::${r.marketType}::${r.bucketKey}`, stats);
      const gk = `${r.eventType}::${r.marketType}`;
      const arr = groups.get(gk);
      if (arr) arr.push(stats);
      else groups.set(gk, [stats]);
    }

    const agg = new Map<string, EventStudyStats>();
    for (const [gk, statsList] of groups) {
      agg.set(gk, this.aggregateStats(statsList));
    }

    return { bucket, agg };
  }

  /** 버킷 통계 목록을 표본가중 평균으로 합친다 (eventType::marketType 폴백용) */
  private aggregateStats(list: EventStudyStats[]): EventStudyStats {
    const totalN = list.reduce((s, x) => s + x.sampleCount, 0);
    // 표본수 합이 0이면 단순평균으로 폴백 (0 나눗셈 방지)
    const w = (pick: (x: EventStudyStats) => number): number => {
      if (totalN <= 0) {
        return list.reduce((s, x) => s + pick(x), 0) / (list.length || 1);
      }
      return list.reduce((s, x) => s + pick(x) * x.sampleCount, 0) / totalN;
    };
    return {
      avgArD5: w((x) => x.avgArD5),
      upProbD5: w((x) => x.upProbD5),
      crashProbD5: w((x) => x.crashProbD5),
      sampleCount: totalN,
      // 버킷 중 하나라도 유의하면 종합 표본은 유의한 것으로 간주
      isSignificant: list.some((x) => x.isSignificant),
    };
  }

  /**
   * 이벤트의 bucketKey 를 도출해 EventStudy 통계를 해석한다 (DAR-70).
   *
   * 우선순위:
   *   1. `${eventType}::${marketType}::${bucketKey}` — 정밀 버킷 매칭
   *   2. `${eventType}::${marketType}` — 시장 내 버킷 표본가중 평균 폴백
   *   3. `${eventType}::ALL::${bucketKey}` — 전시장 동일 버킷
   *   4. `${eventType}::ALL` — 전시장 평균
   *   5. null — 미산출(historical-event 결측 처리)
   */
  private resolveEventStudy(
    maps: EventStudyMaps,
    ev: { eventType: string; isAmendment: boolean; extractedData: Prisma.JsonValue },
    marketType: string,
  ): EventStudyStats | null {
    const bucketKey = this.deriveBucketKey(ev);
    return (
      maps.bucket.get(`${ev.eventType}::${marketType}::${bucketKey}`) ??
      maps.agg.get(`${ev.eventType}::${marketType}`) ??
      maps.bucket.get(`${ev.eventType}::ALL::${bucketKey}`) ??
      maps.agg.get(`${ev.eventType}::ALL`) ??
      null
    );
  }

  /**
   * DisclosureEvent → bucketKey. 집계 시 쓰인 canonical classifyBucket 을 그대로 사용해
   * 조회키 일관성을 보장한다(같은 함수·같은 extractedData → 같은 키). isAmendment 는
   * 별도 컬럼이므로 extractedData 에 병합해 분류기에 전달한다.
   */
  private deriveBucketKey(ev: {
    eventType: string;
    isAmendment: boolean;
    extractedData: Prisma.JsonValue;
  }): string {
    const ed =
      ev.extractedData &&
      typeof ev.extractedData === 'object' &&
      !Array.isArray(ev.extractedData)
        ? (ev.extractedData as Record<string, unknown>)
        : {};
    const data: EventExtractedData = {
      ...(ed as EventExtractedData),
      isAmendment: ev.isAmendment,
    };
    return classifyBucket(ev.eventType, data);
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

  /**
   * corpCode → 최신 매출(CompanyFinancial.revenue) 맵 (DAR-79).
   *
   * 취득금액 매출 대비 정규화에 사용. 신규 외부 수집 없이 기존 적재 재무만 활용한다.
   * 연간 보고서(reprtCode=11011)·연결(CFS) 우선, 가장 최근 사업연도(bsnsYear) 값을 채택.
   * 재무 미적재·revenue null·조회 오류는 graceful 폴백(맵 미수록 → 절대금액 폴백).
   */
  private async loadRevenueMap(
    corpCodes: string[],
  ): Promise<Map<string, number>> {
    const map = new Map<string, number>();
    const uniq = Array.from(new Set(corpCodes));
    if (uniq.length === 0) return map;
    try {
      const rows = await this.prisma.companyFinancial.findMany({
        where: { corpCode: { in: uniq }, revenue: { not: null } },
        select: { corpCode: true, bsnsYear: true, reprtCode: true, revenue: true },
        // 연간(11011) → 최신 사업연도 우선. 동일 corpCode는 첫 행 채택.
        orderBy: [{ bsnsYear: 'desc' }, { reprtCode: 'asc' }],
      });
      for (const r of rows) {
        if (map.has(r.corpCode)) continue; // 가장 최신·우선 보고서만 채택
        const rev = r.revenue == null ? null : Number(r.revenue);
        if (rev !== null && isFinite(rev) && rev > 0) {
          map.set(r.corpCode, rev);
        }
      }
    } catch (err) {
      // 재무 테이블 부재/조회 실패 시 정규화 비율 없이 절대금액 폴백 (회귀 없이 graceful)
      this.logger.warn(
        `[SignalGen] 매출 맵 로드 실패 — 절대금액 폴백: ${(err as Error).message}`,
      );
    }
    return map;
  }

  /**
   * DAR-88: corpCode → 최근 내부자/대량보유 동향(InsiderInput) 맵.
   * DAR-87 이 적재한 InsiderHoldingChange 를 최근 윈도우(기본 90일)로 묶어 insider scorer 입력으로 연결.
   * 조회 실패/부재 시 빈 맵 → insider 버킷 결측(재정규화 제외, 회귀 0). 신규 수집 없음.
   */
  private async loadInsiderMap(
    corpCodes: string[],
  ): Promise<Map<string, InsiderInput>> {
    const map = new Map<string, InsiderInput>();
    const uniq = Array.from(new Set(corpCodes));
    if (uniq.length === 0) return map;
    // 최근 90일 보고만 신호 반영 — 오래된 지분변동은 현재 매수판단에 약함.
    const since = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
    try {
      const rows = await this.prisma.insiderHoldingChange.findMany({
        where: { corpCode: { in: uniq }, reportedAt: { gte: since } },
        select: {
          corpCode: true,
          source: true,
          tradeType: true,
          ratioChange: true,
          isMajorShareholder: true,
        },
        orderBy: { reportedAt: 'desc' },
      });
      for (const r of rows) {
        const entry = map.get(r.corpCode) ?? { trades: [] };
        entry.trades.push({
          source: r.source === 'EXECUTIVE' ? 'EXECUTIVE' : 'MAJOR_STOCK',
          tradeType:
            r.tradeType === 'BUY' || r.tradeType === 'SELL' || r.tradeType === 'MIXED'
              ? r.tradeType
              : 'UNKNOWN',
          ratioChange: r.ratioChange,
          isMajorShareholder: r.isMajorShareholder,
        });
        map.set(r.corpCode, entry);
      }
    } catch (err) {
      // 테이블 부재/조회 실패 → insider 버킷 결측(재정규화 제외) graceful.
      this.logger.warn(
        `[SignalGen] 내부자 동향 맵 로드 실패 — insider 결측 처리: ${(err as Error).message}`,
      );
    }
    return map;
  }

  /**
   * DAR-100: corpCode → 최신 재무 성장률(FundamentalGrowthInput) 맵.
   * DAR-93 이 산출·영속한 CompanyFinancial YoY 성장률을 신호 입력 피처로 종단 연결한다.
   * 성장률 필드가 하나라도 있는 가장 최근 보고서를 corpCode 단위로 채택.
   * 조회 실패/부재·전필드 null → 맵 미수록 → fundamental 버킷 결측(재정규화 제외, 회귀 0). 신규 수집 없음.
   */
  private async loadGrowthMap(
    corpCodes: string[],
  ): Promise<Map<string, FundamentalGrowthInput>> {
    const map = new Map<string, FundamentalGrowthInput>();
    const uniq = Array.from(new Set(corpCodes));
    if (uniq.length === 0) return map;
    try {
      const rows = await this.prisma.companyFinancial.findMany({
        where: { corpCode: { in: uniq } },
        select: {
          corpCode: true,
          revenueGrowthYoY: true,
          operatingProfitGrowthYoY: true,
          epsGrowthYoY: true,
        },
        // 연간(11011) → 최신 사업연도 우선. corpCode당 성장률 보유 첫 행 채택.
        orderBy: [{ bsnsYear: 'desc' }, { reprtCode: 'asc' }],
      });
      const numOrNull = (v: number | null): number | null =>
        v != null && isFinite(v) ? v : null;
      for (const r of rows) {
        if (map.has(r.corpCode)) continue; // corpCode당 최신·우선 보고서만
        const growth: FundamentalGrowthInput = {
          revenueGrowthYoY: numOrNull(r.revenueGrowthYoY),
          operatingProfitGrowthYoY: numOrNull(r.operatingProfitGrowthYoY),
          epsGrowthYoY: numOrNull(r.epsGrowthYoY),
        };
        // 성장률이 전부 결측인 행은 건너뛰어, 더 과거라도 성장률 보유 행을 채택.
        if (
          growth.revenueGrowthYoY == null &&
          growth.operatingProfitGrowthYoY == null &&
          growth.epsGrowthYoY == null
        ) {
          continue;
        }
        map.set(r.corpCode, growth);
      }
    } catch (err) {
      // 재무 테이블 부재/성장률 컬럼 부재/조회 실패 → fundamental 결측 graceful.
      this.logger.warn(
        `[SignalGen] 재무 성장률 맵 로드 실패 — fundamental 성장률 결측 처리: ${(err as Error).message}`,
      );
    }
    return map;
  }

  /**
   * DAR-100: rcpNo → 공시 본문 정량값(FundamentalFiledFactInput) 맵.
   * DAR-95 가 적재한 DartFiledFact(본문 정량표 추출값)를 신호 입력 피처로 종단 연결한다.
   * 매수판단에 의미 있는 표준 factKey 만 선별: 계약금액/매출 비율(가점), 희석률(감점).
   * 조회 실패/부재 → 맵 미수록 → fundamental 버킷 결측(재정규화 제외, 회귀 0). 신규 수집 없음.
   */
  private async loadFiledFactMap(
    rcpNos: string[],
  ): Promise<Map<string, FundamentalFiledFactInput>> {
    const map = new Map<string, FundamentalFiledFactInput>();
    const uniq = Array.from(new Set(rcpNos));
    if (uniq.length === 0) return map;
    try {
      const rows = await this.prisma.dartFiledFact.findMany({
        where: {
          rcpNo: { in: uniq },
          factKey: { in: ['CONTRACT_TO_SALES_RATIO', 'DILUTION_RATE'] },
          numericValue: { not: null },
        },
        select: { rcpNo: true, factKey: true, numericValue: true },
      });
      for (const r of rows) {
        const v = r.numericValue;
        if (v == null || !isFinite(v)) continue;
        const entry =
          map.get(r.rcpNo) ?? { contractToSalesRatio: null, dilutionRate: null };
        if (r.factKey === 'CONTRACT_TO_SALES_RATIO') {
          entry.contractToSalesRatio = v;
        } else if (r.factKey === 'DILUTION_RATE') {
          entry.dilutionRate = v;
        }
        map.set(r.rcpNo, entry);
      }
    } catch (err) {
      // 테이블 부재/조회 실패 → fundamental 본문 정량값 결측 graceful.
      this.logger.warn(
        `[SignalGen] 본문 정량값 맵 로드 실패 — fundamental 정량값 결측 처리: ${(err as Error).message}`,
      );
    }
    return map;
  }

  /** DB 컨텍스트 → BuyScoreParams 조립 */
  private buildParams(
    ev: {
      rcpNo: string;
      corpCode: string;
      eventType: string;
      polarity: string;
      isAmendment: boolean;
      extractedData: Prisma.JsonValue;
      company: { stockCode: string | null; market: string | null } | null;
    },
    persona: PersonaType,
    s: StockContext,
    m: MarketContext,
    esrStats: EventStudyStats | null,
    signalSummary: string | undefined,
    revenue: number | null,
    insider: InsiderInput,
    fundamental: FundamentalInput,
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

    // DAR-79: 매수/임팩트 판단에 절대 금액이 아닌 규모 정규화 비율을 우선 반영.
    //   결측 시 절대 금액 폴백 → persona-view 강도 보정에 사용.
    const impact = deriveImpactMagnitude(ev.eventType, extractedData, revenue);

    return {
      rcpNo: ev.rcpNo,
      corpCode: ev.corpCode,
      stockCode: ev.company?.stockCode ?? '',
      persona,
      disclosureEvent: { eventType: ev.eventType, polarity: ev.polarity },
      keyMetric: { eventType: ev.eventType, extractedData },
      personaFitInput: {
        personaViews: derivePersonaViews(ev.eventType, ev.polarity, impact),
        userPersona: persona,
      },
      historicalEvent: esrStats
        ? {
            avgArD5: esrStats.avgArD5,
            isSignificant: esrStats.isSignificant,
            upProbD5: esrStats.upProbD5,
            crashProbD5: esrStats.crashProbD5,
            sampleCount: esrStats.sampleCount,
          }
        : { avgArD5: null },
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
      insider,
      fundamental,
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

  /**
   * DAR-91: calibration(getCalibration) → 등급별 confidence 보정계수 맵.
   *
   * 백테스트 실현 적중률이 등급 기대 미만(과대평가 등급)이면 디스카운트 계수(<1)를 반영한다.
   * ★ read-only — getCalibration 은 과거 TradingSignal 실현수익 집계만 한다(상수·임계값 불변).
   *   accuracy 미주입/조회 실패는 빈 맵 → 무보정(계수 1.0) graceful. 신규 수집·AI 개입 0.
   */
  private async loadGradeCoefficients(): Promise<Map<string, number>> {
    if (!this.accuracy) return new Map();
    try {
      const calibration = await this.accuracy.getCalibration();
      return gradeCoefficientMap(calibration.gradeConfidenceCalibrationsD20);
    } catch (err) {
      this.logger.warn(
        `[SignalGen] calibration 로드 실패 — confidence 무보정(계수 1.0): ${(err as Error).message}`,
      );
      return new Map();
    }
  }

  /** BuySignalResult → TradingSignal create payload */
  /**
   * DAR-85: 신규 매수신호 통지 enqueue. STRONG_BUY/BUY 만 대상.
   * producer 미주입/큐 미설정/실패는 graceful — 신호 생성 트랜잭션을 깨지 않는다.
   */
  private async maybeEnqueueSignal(
    signalId: string,
    r: BuySignalResult,
    stockCode?: string | null,
  ): Promise<void> {
    if (!this.notifyProducer) return;
    if (!SignalGenerationService.NOTIFY_GRADES.has(r.signal)) return;
    await this.notifyProducer.enqueueSignal({
      signalId,
      corpCode: r.corpCode,
      stockCode: stockCode ?? r.stockCode,
      eventType: r.eventType,
      buyScore: r.buyScore,
      grade: r.signal,
    });
  }

  private toCreateData(
    r: BuySignalResult,
    calibratedConfidence: number,
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
      // DAR-91: 등급 보정계수 환류 confidence (원본 buyScore 보존, 점수 한정)
      calibratedConfidence,
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

  /** BuySignalResult → TradingSignal update payload (재채점, 자연키 불변) */
  private toUpdateData(
    r: BuySignalResult,
    calibratedConfidence: number,
  ): Prisma.TradingSignalUncheckedUpdateInput {
    return {
      eventType: r.eventType,
      subCategory: r.subCategory ?? null,
      buyScore: r.buyScore,
      signal: r.signal as SignalGrade,
      // DAR-91: 재채점 시에도 보정계수 재반영(원본 buyScore 보존, 점수 한정)
      calibratedConfidence,
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
