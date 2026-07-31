/**
 * 런타임 신호 생성 서비스 — BuyScore → TradingSignal persist (DAR-41)
 *
 * 끊긴 파이프라인 링크 연결: DisclosureEvent + StockDailyPrice 가 있고 아직
 * TradingSignal 이 없는 공시에 대해 BuyScoreParams 를 조립 → computeBuyScore()
 * → TradingSignal 영속화. 멱등(DAR-125): 자연키 (corpCode, rcpNo, eventType,
 * persona) upsert — 재생성/동시실행에도 원천 중복 0.
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
import { deriveBucketKeyForEvent, COARSE_BUCKET_KEY } from '../event-study/utils/bucket-classifier';
import { SignalAccuracyService } from '../backtest/signal-accuracy.service';
import { collectMissingFeatureKeys } from '../../aos/feature-engine/domain/feature-snapshot';
import { FeatureSnapshotDualWriteService } from '../../aos/feature-engine/services/feature-snapshot-dual-write.service';
import { formatKstDateCompact } from '../../common/time/kst';
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
  /**
   * 이상치에 강건한 D+5 초과수익(DAR-402) — winsorizedMeanArD5 우선, 결측 시 medianArD5,
   * 둘 다 결측(재계산 전 레거시 행)이면 avgArD5 폴백. 신호 스코어의 event edge 입력.
   */
  robustArD5: number;
  isSignificant: boolean;
  upProbD5: number;
  crashProbD5: number;
  sampleCount: number;
  /** 영속 tier (READY/PRELIMINARY). 래더가 fine·coarse 우선순위 판정에 사용 (DAR-324/325). */
  status?: 'READY' | 'PRELIMINARY';
  /**
   * 어느 tier 로 해석됐는지 라벨 (DAR-325). 신호 가독성·향후 UI('표본 45건, 시장 전체') 표기용.
   * resolveEventStudy 가 선택 시점에 부여(맵 캐시 값은 불변, 반환 사본에만 설정).
   */
  esrTier?: EsrTier;
}

/**
 * Event Study 해석 tier 라벨 (DAR-325).
 * - FINE_READY    : 정밀 버킷 n≥30 (가장 구체적·강한 증거)
 * - COARSE_READY  : 부모 풀링 n≥30 (suffix 무시·시장 내)
 * - FINE_PRELIM   : 정밀 버킷 n∈[10,30)
 * - COARSE_PRELIM : 부모 풀링 n∈[10,30)
 * - AGG           : 기존 (eventType::marketType) 버킷 표본가중 평균 폴백
 * - ALL_FINE / ALL_COARSE / ALL_AGG : 교차시장(ALL) 폴백
 */
type EsrTier =
  | 'FINE_READY'
  | 'COARSE_READY'
  | 'FINE_PRELIM'
  | 'COARSE_PRELIM'
  | 'AGG'
  | 'ALL_FINE'
  | 'ALL_COARSE'
  | 'ALL_AGG';

/** 선택된 tier 라벨을 사본에 부여(맵 캐시 값 불변 보존) (DAR-325). */
function tagTier(stats: EventStudyStats, tier: EsrTier): EventStudyStats {
  return { ...stats, esrTier: tier };
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

/**
 * 과거 공시 point-in-time 신호 백필 옵션 (DAR-389).
 */
export interface BackfillSignalOptions {
  /** 처리할 백필 공시 rcpDt 하한 YYYYMMDD (포함). 미지정 시 전체 백필. */
  startRcpDt?: string;
  /** 처리할 백필 공시 rcpDt 상한 YYYYMMDD (포함). 미지정 시 전체 백필. */
  endRcpDt?: string;
  /** 한 배치(페이지)당 이벤트 수 (스로틀·메모리 상한). 기본 500. */
  batchSize?: number;
  /** 처리할 최대 이벤트 수(경계 실행용). 미지정 시 전량. */
  maxEvents?: number;
  /** 배치 간 지연(ms). DB 부하 완화 스로틀. 기본 0. */
  throttleMs?: number;
  /** 생성할 persona 목록 (기본 4 Persona 전부). */
  personas?: readonly PersonaType[];
  /** 기존 신호 재채점 여부. 기본 false(멱등 신규만). */
  overwrite?: boolean;
}

/** 백필 신호 생성 결과 요약 (DAR-389). */
export interface BackfillSignalSummary extends SignalGenerationSummary {
  /** 처리한 배치(페이지) 수. */
  batches: number;
  /** 생성 신호의 공시 접수월(YYYYMM)별 분포 — 연중화 검증용. */
  monthlyDist: Record<string, number>;
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
  sourceRefs: {
    price: { id: string | null; stockCode: string; tradeDate: string } | null;
    technicalIndicator: { id: string | null; stockCode: string; tradeDate: string } | null;
    stockStatus: {
      stockCode: string;
      tradeDate: string;
      updatedAt: string | null;
    } | null;
  };
}

interface MarketContext {
  kospiChange1d: number | null;
  kosdaqChange1d: number | null;
  sourceRefs: {
    marketIndices: readonly {
      indexCode: string;
      tradeDates: readonly string[];
    }[];
  };
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

  /**
   * DAR-85 / F4(2026-06-26): 푸시 통지 대상 등급(고확신 매수).
   * 정본 SignalGrade enum 값(*_CANDIDATE)을 사용한다. 과거 'STRONG_BUY'/'BUY' 리터럴은
   * 실제 등급값(STRONG_BUY_CANDIDATE/BUY_CANDIDATE)과 불일치해 통지가 영구 미발화했다.
   * ReadonlySet<SignalGrade> 로 타입을 좁혀 stale 리터럴 재발 시 컴파일 에러로 차단.
   */
  private static readonly NOTIFY_GRADES: ReadonlySet<SignalGrade> = new Set<SignalGrade>([
    SignalGrade.STRONG_BUY_CANDIDATE,
    SignalGrade.BUY_CANDIDATE,
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
    // AOS A3-2: 기본 OFF인 fail-open FeatureSnapshot dual-write.
    @Optional()
    private readonly featureSnapshotDualWrite?: FeatureSnapshotDualWriteService,
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
      // ★DAR-129: 백필(과거 분석 baseline) 공시는 라이브 신호 생성에서 절대 제외(불가침).
      //   relation 필터로 isBackfill=true 공시의 이벤트를 후보에서 원천 배제한다.
      //   Event Study·통계·백테스트 등 분석 경로는 별도이며 백필 포함 전체 사용(여기서만 격리).
      const events = await this.prisma.disclosureEvent.findMany({
        where: { disclosure: { isBackfill: false } },
        select: {
          id: true,
          rcpNo: true,
          corpCode: true,
          eventType: true,
          polarity: true,
          isAmendment: true,
          extractedData: true,
          extractedAt: true,
          company: { select: { stockCode: true, market: true } },
          disclosure: { select: { rcpDt: true } },
        },
      });
      const candidates = events.filter(
        (e) => e.company?.stockCode && pricedSet.has(e.company.stockCode),
      );

      if (candidates.length === 0) {
        this.logger.log('[SignalGen] 대상 공시 없음 (이벤트+시세 교집합 0)');
        return { candidates: 0, created: 0, updated: 0, skipped: 0, gradeDist, triggeredBy };
      }

      // 3. 멱등: 이번 실행 전 기존 신호 집합. (corpCode, rcpNo, eventType, persona)
      //    자연키이나 공시:이벤트 1:1 이라 (rcpNo, persona) 로 식별 동치.
      //    신규/재채점 분기와 신규 신호만 통지 enqueue 하기 위한 스냅샷.
      const existing = await this.prisma.tradingSignal.findMany({
        select: { rcpNo: true, persona: true },
      });
      const existingSet = new Set(existing.map((s) => `${s.rcpNo}::${s.persona}`));

      // 4. 시장·이벤트스터디·요약 컨텍스트 (배치 로드)
      const marketCtx = await this.loadMarketContext();
      const esrMaps = await this.loadEventStudyMap();
      const summaryMap = await this.loadSummaryMap(candidates.map((c) => c.rcpNo));
      // DAR-79: 취득금액 매출 대비 정규화용 corpCode→매출 맵 (기존 CompanyFinancial 활용, 신규 수집 0)
      const revenueMap = await this.loadRevenueMap(candidates.map((c) => c.corpCode));
      // DAR-88: corpCode→내부자/대량보유 동향 맵 (DAR-87 적재분 종단 연결, 신규 수집 0)
      const insiderMap = await this.loadInsiderMap(candidates.map((c) => c.corpCode));
      // DAR-100: corpCode→재무 성장률 맵 (DAR-93 산출분), rcpNo→본문 정량값 맵 (DAR-95 적재분).
      //   사장되던 두 자산을 신호 입력 피처로 활성화. 신규 수집·AI 개입 0(기존 적재 read-only).
      const growthMap = await this.loadGrowthMap(candidates.map((c) => c.corpCode));
      const filedFactMap = await this.loadFiledFactMap(candidates.map((c) => c.rcpNo));
      // DAR-91: calibration 등급별 confidence 보정계수 맵 (백테스트 실현 적중률 환류).
      // 1회 로드해 배치 전체에 재사용. 미주입/실패/표본부족 시 빈 맵 → 무보정(계수 1.0).
      const gradeCoeff = await this.loadGradeCoefficients();
      const stockCtxCache = new Map<string, StockContext>();
      // F4(2026-06-26): 공시단위(corpCode,rcpNo) 통지 dedup. 한 공시가 여러 persona/eventType
      //   신호를 만들어도 watcher 에게는 1회만 푸시한다(persona fan-out 4중 통지 방지).
      //   run 단위 set — 인스턴스가 아닌 호출마다 새로 만들어 이후 cron 의 신규 통지를 막지 않는다.
      const notifiedDisclosures = new Set<string>();

      for (const ev of candidates) {
        const stockCode = ev.company!.stockCode!;
        let stockCtx = stockCtxCache.get(stockCode);
        if (!stockCtx) {
          stockCtx = await this.loadStockContext(stockCode);
          stockCtxCache.set(stockCode, stockCtx);
        }

        const marketType = ev.company?.market ?? 'ALL';
        const esrStats = this.resolveEventStudy(esrMaps, ev, marketType);
        // 해당 이벤트의 모든 source read 이후 cutoff를 고정하고, 4 persona가 공유한다.
        const snapshotAsOf = new Date();

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
          const calibratedConfidence = applyConfidenceCoefficient(result.buyScore, coefficient);

          try {
            // DAR-125: 원천 멱등 upsert. 자연키 (corpCode, rcpNo, eventType, persona)
            //   단일 진입으로 신규/재채점을 원자 처리 — create 후 P2002 캐치 패턴 제거.
            const sig = await this.prisma.tradingSignal.upsert({
              where: {
                corpCode_rcpNo_eventType_persona: {
                  corpCode: ev.corpCode,
                  rcpNo: ev.rcpNo,
                  eventType: ev.eventType,
                  persona,
                },
              },
              create: this.toCreateData(result, calibratedConfidence),
              update: this.toUpdateData(result, calibratedConfidence),
              select: { id: true },
            });
            await this.maybeFreezeFeatureSnapshot({
              event: ev,
              params,
              stockContext: stockCtx,
              marketContext: marketCtx,
              eventStudy: esrStats,
              marketType,
              asOf: snapshotAsOf,
            });
            if (exists) {
              updated++;
            } else {
              created++;
              existingSet.add(key);
              // DAR-85: 신규 매수신호(STRONG_BUY_CANDIDATE/BUY_CANDIDATE)만 큐로 통지 enqueue(재채점 제외).
              // F4: 공시단위 dedup set 전달 — 동일 공시는 1회만 통지.
              await this.maybeEnqueueSignal(
                sig.id,
                result,
                ev.company?.stockCode,
                notifiedDisclosures,
              );
            }
            gradeDist[result.signal] = (gradeDist[result.signal] ?? 0) + 1;
          } catch (err) {
            // 동시 생성 레이스 등으로 유니크 충돌(P2002) → 이미 존재 = 멱등 스킵.
            //   (upsert 도 동시 insert 레이스에서 P2002 가능 — 방어적 처리 유지.)
            if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
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
   * 기존 (corpCode, rcpNo, eventType, persona) 신호를 재계산하여 upsert(갱신)한다. 누락 신호는 신규 생성.
   * TI 백필 후 chart·entryReady 반영이 파생 trading_signals 에 반영되도록 한다.
   * 사용자 데이터(주가·공시) 무변경 — 파생 신호만 갱신.
   */
  async regenerateSignals(
    triggeredBy: 'CRON' | 'MANUAL' = 'MANUAL',
    personas: readonly PersonaType[] = PERSONA_TYPES,
  ): Promise<SignalGenerationSummary> {
    return this.generateMissingSignals(triggeredBy, personas, true);
  }

  /**
   * 과거(백필) 공시에 point-in-time 신호를 생성·영속화한다 (DAR-389).
   *
   * 배경: 라이브 신호 생성(generateMissingSignals)은 DAR-129 불가침 규칙으로 isBackfill=true
   * 공시를 원천 제외한다. 그 결과 백필 공시(rcpDt 연중 분포)에 TradingSignal 이 0건이라 1년
   * 백테스트가 최근 1개월만 거래한다. 이 메서드는 **분석/백테스트 전용으로만** 과거 공시의
   * 신호를 생성한다(라이브 신호 피드는 여전히 백필 제외 — 이 경로는 별도 진입점).
   *
   * ★엄격 point-in-time(lookahead 0, 불가침):
   *   - 각 공시의 스코어·지표는 **그 공시일(rcpDt)까지의 데이터로만** 산출한다.
   *   - 가격(StockDailyPrice)·기술지표(TechnicalIndicator)·지수(MarketIndex)는 tradeDate ≤ rcpDt
   *     상한(as-of)으로 조회한다(loadStockContextAsOf/loadMarketContextAsOf). 미래 가격/수익으로
   *     점수를 부풀리지 않는다.
   *   - calibration 보정계수는 **적용하지 않는다**(calibration 은 과거 신호의 실현 D20 수익에서
   *     역산 — 백필 시점엔 미래 정보다). calibratedConfidence = buyScore.
   *   - ★TB-1(2026-07-03): 상태플래그(StockStatus 현재 스냅샷) 하드차단도 **적용하지 않는다**
   *     (현재 상태로 과거 신호를 BLOCKED 처리하면 등급 배정 lookahead — loadStockContextAsOf
   *     참조). 이벤트타입 하드블록 3종(rcpDt 시점 정보 파생, PIT 안전)은 백필에도 유지.
   *   - 신규 AI 호출 0(Rule 스코어는 AI 무관). 통지 enqueue 0(과거 신호는 알림 대상 아님).
   *   - EventStudy 통계는 라이브와 동일한 코퍼스 단위 prior 맵을 쓴다(공시 자신의 미래 가격을
   *     쓰지 않음 — 종목별 가격 lookahead 아님). 표본 통계의 시점절단은 별도 분석 코퍼스 영역
   *     (DAR-376/379)으로, 본 백필의 범위 밖.
   *
   * 멱등: 자연키 (corpCode, rcpNo, eventType, persona) upsert. 재실행/동시실행 중복 0.
   * 규모: rcpNo 커서 페이지네이션 + 배치별 컨텍스트 맵 적재 + 선택적 스로틀로 대량 공시 처리.
   *
   * AI 금지영역 불가침: BuyScore=Rule. 본 경로는 어떤 AI/LLM 도 호출하지 않는다.
   */
  async generateBackfillSignals(
    options: BackfillSignalOptions = {},
  ): Promise<BackfillSignalSummary> {
    const personas = options.personas ?? PERSONA_TYPES;
    const batchSize = Math.max(1, options.batchSize ?? 500);
    const throttleMs = Math.max(0, options.throttleMs ?? 0);
    const overwrite = options.overwrite ?? false;
    const maxEvents = options.maxEvents;

    if (this.isRunning) {
      this.logger.warn('[SignalGen:Backfill] 신호 생성이 이미 진행 중입니다.');
      return {
        candidates: 0,
        created: 0,
        updated: 0,
        skipped: 0,
        gradeDist: {},
        triggeredBy: 'BACKFILL',
        message: '이전 작업 진행 중',
        batches: 0,
        monthlyDist: {},
      };
    }
    this.isRunning = true;

    const gradeDist: Record<string, number> = {};
    const monthlyDist: Record<string, number> = {};
    let candidates = 0;
    let created = 0;
    let updated = 0;
    let skipped = 0;
    let batches = 0;

    try {
      this.logger.log(
        `[SignalGen:Backfill] point-in-time 백필 시작 range=${options.startRcpDt ?? '*'}~${options.endRcpDt ?? '*'} batchSize=${batchSize}`,
      );

      // 1. 시세 보유 종목 집합 (라이브와 동일 게이트 — 가격 컨텍스트 가능 종목만).
      const pricedStocks = await this.prisma.stockDailyPrice.findMany({
        distinct: ['stockCode'],
        select: { stockCode: true },
      });
      const pricedSet = new Set(pricedStocks.map((s) => s.stockCode));

      // 2. 코퍼스 단위 prior — EventStudy 통계 맵(라이브와 동일). 1회 적재 후 전 배치 재사용.
      const esrMaps = await this.loadEventStudyMap();

      // 3. as-of 컨텍스트 캐시 (종목+공시일 단위, 지수는 공시일 단위) — 배치 간 재사용.
      const stockCtxCache = new Map<string, StockContext>();
      const marketCtxCache = new Map<string, MarketContext>();

      // 4. rcpNo 커서 페이지네이션으로 백필 공시 이벤트 순회.
      const rcpDtFilter: Prisma.StringFilter | undefined =
        options.startRcpDt || options.endRcpDt
          ? {
              ...(options.startRcpDt ? { gte: options.startRcpDt } : {}),
              // 종일 포함: 14자리(YYYYMMDDHHmmss) rcpDt 까지 포괄.
              ...(options.endRcpDt ? { lte: `${options.endRcpDt}999999` } : {}),
            }
          : undefined;
      const eventWhere: Prisma.DisclosureEventWhereInput = {
        disclosure: {
          isBackfill: true,
          ...(rcpDtFilter ? { rcpDt: rcpDtFilter } : {}),
        },
      };

      let cursor: string | undefined;
      let processedEvents = 0;
      for (;;) {
        const page = await this.prisma.disclosureEvent.findMany({
          where: eventWhere,
          select: {
            rcpNo: true,
            corpCode: true,
            eventType: true,
            polarity: true,
            isAmendment: true,
            extractedData: true,
            company: { select: { stockCode: true, market: true } },
            disclosure: { select: { rcpDt: true } },
          },
          orderBy: { rcpNo: 'asc' },
          take: batchSize,
          ...(cursor ? { cursor: { rcpNo: cursor }, skip: 1 } : {}),
        });
        if (page.length === 0) break;
        cursor = page[page.length - 1].rcpNo;

        // 시세 보유 종목만 후보.
        const batchEvents = page.filter(
          (e) => e.company?.stockCode && pricedSet.has(e.company.stockCode),
        );
        candidates += batchEvents.length;

        if (batchEvents.length > 0) {
          batches++;
          const batchRcpNos = batchEvents.map((e) => e.rcpNo);
          const batchCorpCodes = batchEvents.map((e) => e.corpCode);

          // 배치별 입력 맵 (라이브와 동일 피처 — 신규 수집·AI 0).
          const [existing, revenueMap, insiderMap, growthMap, filedFactMap] = await Promise.all([
            this.prisma.tradingSignal.findMany({
              where: { rcpNo: { in: batchRcpNos } },
              select: { rcpNo: true, persona: true },
            }),
            this.loadRevenueMap(batchCorpCodes),
            this.loadInsiderMap(batchCorpCodes),
            this.loadGrowthMap(batchCorpCodes),
            this.loadFiledFactMap(batchRcpNos),
          ]);
          const existingSet = new Set(existing.map((s) => `${s.rcpNo}::${s.persona}`));

          for (const ev of batchEvents) {
            const stockCode = ev.company!.stockCode!;
            // ★as-of 거래일 = 공시 접수일(YYYYMMDD). 이후 데이터 미참조.
            const asOf = this.rcpDtToTradeDate(ev.disclosure.rcpDt);

            const stockKey = `${stockCode}::${asOf}`;
            let stockCtx = stockCtxCache.get(stockKey);
            if (!stockCtx) {
              stockCtx = await this.loadStockContextAsOf(stockCode, asOf);
              stockCtxCache.set(stockKey, stockCtx);
            }
            let marketCtx = marketCtxCache.get(asOf);
            if (!marketCtx) {
              marketCtx = await this.loadMarketContextAsOf(asOf);
              marketCtxCache.set(asOf, marketCtx);
            }

            const marketType = ev.company?.market ?? 'ALL';
            const esrStats = this.resolveEventStudy(esrMaps, ev, marketType);
            const monthKey = ev.disclosure.rcpDt.slice(0, 6);

            for (const persona of personas) {
              const key = `${ev.rcpNo}::${persona}`;
              const exists = existingSet.has(key);
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
                // signalSummary 생략: 과거 신호는 표시 요약 불필요 + 캐시 요약이 미래 시점일 수
                //   있어 point-in-time 정직성 위해 미참조(buyScore 무관 — 표시값일 뿐).
                undefined,
                revenueMap.get(ev.corpCode) ?? null,
                insiderMap.get(ev.corpCode) ?? { trades: [] },
                {
                  growth: growthMap.get(ev.corpCode) ?? null,
                  filedFacts: filedFactMap.get(ev.rcpNo) ?? null,
                },
              );
              const result = this.buySignal.computeBuyScore(params);

              // ★calibration 미적용 — calibratedConfidence = buyScore (lookahead 0).
              const calibratedConfidence = result.buyScore;

              try {
                await this.prisma.tradingSignal.upsert({
                  where: {
                    corpCode_rcpNo_eventType_persona: {
                      corpCode: ev.corpCode,
                      rcpNo: ev.rcpNo,
                      eventType: ev.eventType,
                      persona,
                    },
                  },
                  create: this.toCreateData(result, calibratedConfidence),
                  update: this.toUpdateData(result, calibratedConfidence),
                  select: { id: true },
                });
                if (exists) {
                  updated++;
                } else {
                  created++;
                  existingSet.add(key);
                  monthlyDist[monthKey] = (monthlyDist[monthKey] ?? 0) + 1;
                  // ★통지 enqueue 없음 — 과거 신호는 푸시 알림 대상이 아니다.
                }
                gradeDist[result.signal] = (gradeDist[result.signal] ?? 0) + 1;
              } catch (err) {
                if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
                  skipped++;
                  continue;
                }
                throw err;
              }
            }
          }
        }

        processedEvents += page.length;
        if (maxEvents !== undefined && processedEvents >= maxEvents) {
          this.logger.log(
            `[SignalGen:Backfill] maxEvents=${maxEvents} 도달 — 중단(이어실행 가능).`,
          );
          break;
        }
        if (page.length < batchSize) break;
        if (throttleMs > 0) await this.sleep(throttleMs);
      }

      this.logger.log(
        `[SignalGen:Backfill] 완료 candidates=${candidates} created=${created} updated=${updated} skipped=${skipped} batches=${batches} monthly=${JSON.stringify(monthlyDist)}`,
      );
      return {
        candidates,
        created,
        updated,
        skipped,
        gradeDist,
        triggeredBy: 'BACKFILL',
        batches,
        monthlyDist,
      };
    } finally {
      this.isRunning = false;
    }
  }

  /** YYYYMMDD[HHmmss] 접수일시 → as-of 거래일 YYYYMMDD (앞 8자리). */
  private rcpDtToTradeDate(rcpDt: string): string {
    return rcpDt.slice(0, 8);
  }

  /** 배치 간 스로틀 sleep. */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /** 종목별 최신 시세·지표·상태 컨텍스트 (라이브 = as-of 상한 없음 = 최신) */
  private async loadStockContext(stockCode: string): Promise<StockContext> {
    return this.loadStockContextAsOf(stockCode);
  }

  /**
   * 종목별 시세·지표·상태 컨텍스트를 **as-of 거래일 상한** 내에서 적재한다 (DAR-389).
   *
   * ★point-in-time(불가침): asOf(YYYYMMDD)가 주어지면 가격·기술지표를 tradeDate ≤ asOf
   *   로만 조회한다(공시일 이후 데이터 미참조 — 미래 가격으로 점수 부풀리기 차단). asOf 생략
   *   시 상한 없음 = 라이브 '최신' 동작(회귀 0). tradeDate 는 YYYYMMDD 문자열이라 사전식 ≤
   *   비교가 곧 시간순 ≤ 비교다.
   *
   *   ★TB-1 정정(2026-07-03 — 종전 'lookahead 와 무관' 서술은 오류): StockStatus 는 거래일
   *   차원이 없는 단일 '현재' 스냅샷(이력 테이블 부재)이라 as-of 절단이 불가능하다. 이 현재
   *   스냅샷을 백필(과거) 신호의 하드차단에 쓰면 **등급 배정 lookahead** 가 발생한다 —
   *   공시 시점엔 정상이던 종목이 이후(현재) 관리종목/거래정지가 됐다는 미래 정보로 과거
   *   신호가 BLOCKED 로 배정돼, 등급 축 측정(단조성·차단 통계)이 오염된다(가격 점수
   *   인플레이션은 아니지만 등급 축 lookahead 는 맞다). 따라서 **백필(asOf 지정)에서는 상태
   *   플래그 하드차단을 미적용**(조회 생략 → 플래그 false)하고, **라이브(asOf 미지정)는
   *   유지**한다 — 현재 상태는 현재 신호에 정당한 입력이다. 이벤트타입 하드블록 3종
   *   (AUDIT_OPINION_RISK/TRADING_SUSPENSION/DELISTING_RISK, risk-penalty.scorer)은 공시
   *   자신(rcpDt 시점 정보)에서 파생돼 PIT 안전 → 백필에도 유지.
   */
  private async loadStockContextAsOf(stockCode: string, asOf?: string): Promise<StockContext> {
    const priceWhere = asOf ? { stockCode, tradeDate: { lte: asOf } } : { stockCode };
    const tiWhere = asOf ? { stockCode, tradeDate: { lte: asOf } } : { stockCode };
    const [price, ti, status] = await Promise.all([
      this.prisma.stockDailyPrice.findFirst({
        where: priceWhere,
        orderBy: { tradeDate: 'desc' },
      }),
      this.prisma.technicalIndicator.findFirst({
        where: tiWhere,
        orderBy: { tradeDate: 'desc' },
      }),
      // ★TB-1: 백필(asOf 지정)은 현재 상태 스냅샷을 조회·적용하지 않는다(등급 lookahead 차단).
      asOf ? Promise.resolve(null) : this.prisma.stockStatus.findUnique({ where: { stockCode } }),
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
      sourceRefs: {
        price: price
          ? { id: price.id ?? null, stockCode: price.stockCode, tradeDate: price.tradeDate }
          : null,
        technicalIndicator: ti
          ? { id: ti.id ?? null, stockCode: ti.stockCode, tradeDate: ti.tradeDate }
          : null,
        stockStatus: status
          ? {
              stockCode: status.stockCode,
              tradeDate: status.tradeDate,
              updatedAt: status.updatedAt instanceof Date ? status.updatedAt.toISOString() : null,
            }
          : null,
      },
    };
  }

  /** KOSPI/KOSDAQ 전일 대비 변동률 (%) 스냅샷 (라이브 = as-of 상한 없음 = 최신) */
  private async loadMarketContext(): Promise<MarketContext> {
    return this.loadMarketContextAsOf();
  }

  /**
   * KOSPI/KOSDAQ 전일 대비 변동률(%)을 **as-of 거래일 상한** 내에서 적재한다 (DAR-389).
   * asOf 가 주어지면 tradeDate ≤ asOf 의 최근 2거래일로만 변동률을 산출한다(공시일 이후 지수
   * 미참조). asOf 생략 시 라이브 '최신' 동작(회귀 0).
   */
  private async loadMarketContextAsOf(asOf?: string): Promise<MarketContext> {
    const change = async (
      code: string,
    ): Promise<{ value: number | null; tradeDates: readonly string[] }> => {
      const rows = await this.prisma.marketIndex.findMany({
        where: asOf ? { indexCode: code, tradeDate: { lte: asOf } } : { indexCode: code },
        orderBy: { tradeDate: 'desc' },
        take: 2,
      });
      const tradeDates = rows.map((row) => row.tradeDate);
      if (rows.length < 2 || rows[1].closeIndex === 0) return { value: null, tradeDates };
      return {
        value: ((rows[0].closeIndex - rows[1].closeIndex) / rows[1].closeIndex) * 100,
        tradeDates,
      };
    };
    const [kospi, kosdaq] = await Promise.all([change(KOSPI_CODE), change(KOSDAQ_CODE)]);
    return {
      kospiChange1d: kospi.value,
      kosdaqChange1d: kosdaq.value,
      sourceRefs: {
        marketIndices: [
          { indexCode: KOSPI_CODE, tradeDates: kospi.tradeDates },
          { indexCode: KOSDAQ_CODE, tradeDates: kosdaq.tradeDates },
        ],
      },
    };
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
      // DAR-324: READY(n≥30) 에 더해 PRELIMINARY(n∈[10,30)) 도 적재해 소표본을 점진 반영한다.
      // PRELIMINARY 행은 통계가 실제 계산되어 있고, historical-event.scorer 가 sampleCount·
      // isSignificant 로 강한 신뢰 감쇠를 적용하므로 과신 없이 0→완전반영으로 단조 상승한다.
      // INSUFFICIENT(n<10) 은 여전히 미적재(순수 노이즈 차단).
      where: { status: { in: ['READY', 'PRELIMINARY'] } },
      select: {
        eventType: true,
        marketType: true,
        bucketKey: true,
        avgArD5: true,
        // DAR-402: 이상치에 강건한 event edge — winsorized 평균 우선, median 폴백.
        winsorizedMeanArD5: true,
        medianArD5: true,
        isSignificant: true,
        upProbD5: true,
        crashProbD5: true,
        sampleCount: true,
        status: true,
      },
    });

    const bucket = new Map<string, EventStudyStats>();
    // (eventType::marketType) 별 버킷 통계 누적 → 표본가중 평균 산출용
    const groups = new Map<string, EventStudyStats[]>();

    for (const r of rows) {
      const stats: EventStudyStats = {
        avgArD5: r.avgArD5,
        // DAR-402: winsorized 평균 우선 → median → avgArD5(레거시 폴백). 재계산 전 행도 안전.
        robustArD5: r.winsorizedMeanArD5 ?? r.medianArD5 ?? r.avgArD5,
        isSignificant: r.isSignificant,
        upProbD5: r.upProbD5,
        crashProbD5: r.crashProbD5,
        sampleCount: r.sampleCount,
        status: r.status === 'READY' ? 'READY' : 'PRELIMINARY',
      };
      bucket.set(`${r.eventType}::${r.marketType}::${r.bucketKey}`, stats);
      // DAR-325: 부모(coarse) 행은 fine 버킷의 원시 이벤트를 풀링한 것이라 agg(표본가중
      //   평균)에 다시 넣으면 동일 이벤트가 이중 계수된다 → agg 누적에서 제외.
      //   (coarse 는 bucket 맵에만 적재해 래더가 직접 조회한다.)
      if (r.bucketKey === COARSE_BUCKET_KEY) continue;
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
      robustArD5: w((x) => x.robustArD5),
      upProbD5: w((x) => x.upProbD5),
      crashProbD5: w((x) => x.crashProbD5),
      sampleCount: totalN,
      // 버킷 중 하나라도 유의하면 종합 표본은 유의한 것으로 간주
      isSignificant: list.some((x) => x.isSignificant),
    };
  }

  /**
   * 이벤트의 bucketKey 를 도출해 EventStudy 통계를 해석한다 (DAR-70 → DAR-324/325).
   *
   * tier 인식 래더 — "가장 구체적이면서 충분히 강한 증거" 우선:
   *   1. fine READY        `${et}::${mkt}::${bucketKey}` (n≥30)        → FINE_READY
   *   2. coarse READY      `${et}::${mkt}::__ALL__`       (부모 풀링 n≥30) → COARSE_READY
   *   3. fine PRELIMINARY  `${et}::${mkt}::${bucketKey}` (n∈[10,30))    → FINE_PRELIM
   *   4. coarse PRELIMINARY `${et}::${mkt}::__ALL__`      (부모 풀링 n∈[10,30)) → COARSE_PRELIM
   *   5. agg               `${et}::${mkt}` 표본가중 평균 폴백             → AGG
   *   6. fine(ALL)         `${et}::ALL::${bucketKey}`                    → ALL_FINE
   *   7. coarse(ALL)       `${et}::ALL::__ALL__`                          → ALL_COARSE
   *   8. agg(ALL)          `${et}::ALL`                                   → ALL_AGG
   *   9. null — 미산출(historical-event 결측 처리)
   *
   * 부모(coarse)가 fine READY 를 덮어쓰지 않는다(1>2). fine 이 PRELIMINARY 일 뿐이고
   * 부모가 READY 면 부모를 택해(2>3) 통계적으로 더 강한 증거를 쓴다. 둘 다 미달이면
   * 기존 agg/ALL 폴백을 유지(5~8).
   */
  private resolveEventStudy(
    maps: EventStudyMaps,
    ev: { eventType: string; isAmendment: boolean; extractedData: Prisma.JsonValue },
    marketType: string,
  ): EventStudyStats | null {
    const bucketKey = this.deriveBucketKey(ev);
    const et = ev.eventType;
    const fine = maps.bucket.get(`${et}::${marketType}::${bucketKey}`);
    const coarse = maps.bucket.get(`${et}::${marketType}::${COARSE_BUCKET_KEY}`);

    if (fine?.status === 'READY') return tagTier(fine, 'FINE_READY');
    if (coarse?.status === 'READY') return tagTier(coarse, 'COARSE_READY');
    if (fine?.status === 'PRELIMINARY') return tagTier(fine, 'FINE_PRELIM');
    if (coarse?.status === 'PRELIMINARY') return tagTier(coarse, 'COARSE_PRELIM');

    const agg = maps.agg.get(`${et}::${marketType}`);
    if (agg) return tagTier(agg, 'AGG');

    const allFine = maps.bucket.get(`${et}::ALL::${bucketKey}`);
    if (allFine) return tagTier(allFine, 'ALL_FINE');
    const allCoarse = maps.bucket.get(`${et}::ALL::${COARSE_BUCKET_KEY}`);
    if (allCoarse) return tagTier(allCoarse, 'ALL_COARSE');
    const allAgg = maps.agg.get(`${et}::ALL`);
    if (allAgg) return tagTier(allAgg, 'ALL_AGG');

    return null;
  }

  /**
   * DisclosureEvent → bucketKey. Event Study 산출(집계)과 동일한 deriveBucketKeyForEvent
   * 를 써서 조회키 일관성을 보장한다(같은 함수·같은 extractedData → 같은 키). DAR-133:
   * 산출/조회 양측이 같은 함수를 공유하도록 공통 헬퍼로 위임.
   */
  private deriveBucketKey(ev: {
    eventType: string;
    isAmendment: boolean;
    extractedData: Prisma.JsonValue;
  }): string {
    return deriveBucketKeyForEvent(ev.eventType, ev.extractedData, ev.isAmendment);
  }

  /** 기존 캐시된 AI 요약(task=summary) → rcpNo → summary 텍스트 (새 AI 호출 없음) */
  private async loadSummaryMap(rcpNos: string[]): Promise<Map<string, string>> {
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
  private async loadRevenueMap(corpCodes: string[]): Promise<Map<string, number>> {
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
      this.logger.warn(`[SignalGen] 매출 맵 로드 실패 — 절대금액 폴백: ${(err as Error).message}`);
    }
    return map;
  }

  /**
   * DAR-88: corpCode → 최근 내부자/대량보유 동향(InsiderInput) 맵.
   * DAR-87 이 적재한 InsiderHoldingChange 를 최근 윈도우(기본 90일)로 묶어 insider scorer 입력으로 연결.
   * 조회 실패/부재 시 빈 맵 → insider 버킷 결측(재정규화 제외, 회귀 0). 신규 수집 없음.
   */
  private async loadInsiderMap(corpCodes: string[]): Promise<Map<string, InsiderInput>> {
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
  private async loadGrowthMap(corpCodes: string[]): Promise<Map<string, FundamentalGrowthInput>> {
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
      const numOrNull = (v: number | null): number | null => (v != null && isFinite(v) ? v : null);
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
        const entry = map.get(r.rcpNo) ?? { contractToSalesRatio: null, dilutionRate: null };
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
            // DAR-402: 산술평균 대신 이상치에 강건한 event edge 를 baseScore 입력으로 쓴다.
            robustArD5: esrStats.robustArD5,
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
   * AOS A3-2 legacy adapter: 실제 BuyScoreParams를 그대로 point-in-time snapshot으로 동결한다.
   * 플래그 OFF에서는 payload 조립조차 하지 않아 기존 런타임 비용을 보존한다.
   */
  private async maybeFreezeFeatureSnapshot(input: {
    event: {
      id?: string;
      rcpNo: string;
      corpCode: string;
      eventType: string;
      polarity: string;
      isAmendment: boolean;
      extractedData: Prisma.JsonValue;
      extractedAt?: Date;
      disclosure?: { rcpDt: string };
      company: { stockCode: string | null; market: string | null } | null;
    };
    params: BuyScoreParams;
    stockContext: StockContext;
    marketContext: MarketContext;
    eventStudy: EventStudyStats | null;
    marketType: string;
    asOf: Date;
  }): Promise<void> {
    const writer = this.featureSnapshotDualWrite;
    if (!writer?.isEnabled()) return;

    const features = {
      ...input.params,
      // JSON 계약은 undefined/Date를 허용하지 않는다. 선택 필드도 명시적으로 고정한다.
      subCategory: input.params.subCategory ?? null,
      signalSummary: input.params.signalSummary ?? null,
      validUntil: input.params.validUntil?.toISOString() ?? null,
    };
    const eventStudyBucket = this.deriveBucketKey(input.event);
    const sourceRefs = {
      adapter: 'LEGACY_TRADING_SIGNAL_V1',
      disclosureEvent: {
        id: input.event.id ?? null,
        rcpNo: input.event.rcpNo,
        rcpDt: input.event.disclosure?.rcpDt ?? null,
        extractedAt:
          input.event.extractedAt instanceof Date ? input.event.extractedAt.toISOString() : null,
      },
      stock: input.stockContext.sourceRefs,
      market: input.marketContext.sourceRefs,
      eventStudy: input.eventStudy
        ? {
            eventType: input.event.eventType,
            marketType: input.marketType,
            requestedBucketKey: eventStudyBucket,
            tier: input.eventStudy.esrTier ?? null,
          }
        : null,
      lookupKeys: {
        disclosureAnalysis: { rcpNo: input.event.rcpNo, task: 'summary' },
        companyFinancial: {
          corpCode: input.event.corpCode,
          selectionPolicy: 'LATEST_BSNS_YEAR_REPRT_CODE_ASC',
        },
        insiderHoldingChanges: {
          corpCode: input.event.corpCode,
          lookbackDays: 90,
        },
        dartFiledFacts: {
          rcpNo: input.event.rcpNo,
          factKeys: ['CONTRACT_TO_SALES_RATIO', 'DILUTION_RATE'],
        },
      },
    };

    try {
      await writer.tryFreeze({
        corpCode: input.event.corpCode,
        stockCode: input.params.stockCode,
        asOf: input.asOf,
        marketSessionDate:
          input.stockContext.sourceRefs.price?.tradeDate ?? formatKstDateCompact(input.asOf),
        schemaVersion: 'legacy-buy-score.v1',
        features,
        sourceRefs,
        quality: {
          missingFeatureKeys: collectMissingFeatureKeys(features).filter(
            (key) => key !== 'subCategory' && key !== 'signalSummary' && key !== 'validUntil',
          ),
          // stale 기준은 승인된 feature contract가 생길 때까지 추정하지 않는다.
          staleFeatureKeys: [],
          validationErrors: [],
        },
      });
    } catch (error) {
      // 실제 writer도 fail-open이지만 mock/향후 adapter 오류까지 이중 격리한다.
      const name = error instanceof Error && error.name ? error.name : 'UnknownError';
      this.logger.warn(
        `[SignalGen] FeatureSnapshot dual-write 예외 격리 — legacy signal 유지: ${name}`,
      );
    }
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
   * DAR-85 / F4: 신규 매수신호 통지 enqueue. STRONG_BUY_CANDIDATE/BUY_CANDIDATE 만 대상.
   * producer 미주입/큐 미설정/실패는 graceful — 신호 생성 트랜잭션을 깨지 않는다.
   * notifiedDisclosures 가 주어지면 (corpCode,rcpNo) 공시단위로 dedup 한다.
   */
  private async maybeEnqueueSignal(
    signalId: string,
    r: BuySignalResult,
    stockCode?: string | null,
    notifiedDisclosures?: Set<string>,
  ): Promise<void> {
    if (!this.notifyProducer) return;
    if (!SignalGenerationService.NOTIFY_GRADES.has(r.signal as SignalGrade)) return;
    // F4: 공시단위 통지 dedup — 동일 (corpCode,rcpNo) 는 첫 자격 신호 1회만 통지.
    if (notifiedDisclosures) {
      const key = `${r.corpCode}::${r.rcpNo}`;
      if (notifiedDisclosures.has(key)) return;
      notifiedDisclosures.add(key);
    }
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
      // DAR-323: '왜 강한 신호가 아닌지' 억제 사유 enum 영속(scoreBreakdown 옆).
      suppressionReason: r.suppressionReason ?? null,
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
      // DAR-323: 재채점 시에도 억제 사유 재반영(omittedBuckets·등급 변동 추종).
      suppressionReason: r.suppressionReason ?? null,
      validUntil: r.validUntil ?? null,
    };
  }
}
