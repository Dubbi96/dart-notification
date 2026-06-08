/**
 * event-study-calculation.service.ts — Event Study 산출 오케스트레이터 (DAR-133)
 *
 * 흐름: DisclosureEvent(SUCCESS) → 종목/시장 가격 윈도우 → 관측치 → 버킷 집계 → EventStudyResult 영속.
 *
 * 설계 원칙
 * ─────────
 * 1. baseline 전체 사용: 백필(isBackfill=true)·실데이터 모두 통계 표본에 포함한다.
 *    (라이브 신호 격리는 signal-generation 측 백필 제외로 유지 — 여기서는 통계/Buy Score 입력만 생산)
 * 2. 성숙 이벤트만: D+20 전향 거래일이 확보된(=시장반응이 다 나온) 공시만 표본에 넣는다.
 *    아직 D+20 미경과인 최신 공시는 자동 제외 → 라이브 신호가 통계로 새지 않는다.
 * 3. 버킷 키 일관성: signal-generation 조회와 동일한 deriveBucketKeyForEvent 를 사용한다.
 * 4. 표본<30 → status='INSUFFICIENT' 로도 영속(데이터한계 표식). loadEventStudyMap·
 *    GET(default) 은 READY 만 읽으므로 Buy Score 오염 없음.
 *
 * 트리거: 수동(POST /event-study/calculate). cron 미등록 — 이중집행/자율실행 방지.
 */
import { Inject, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import {
  EventStudyService,
  EventObservationInput,
  AggregatedResult,
} from './event-study.service';
import { calcD0 } from './utils/d0-calculator';
import { deriveBucketKeyForEvent } from './utils/bucket-classifier';
import { PriceWindow } from './utils/abnormal-return';
import {
  IStockPricePort,
  IStockDailyPrice,
  STOCK_PRICE_PORT,
} from './ports/stock-price.port';
import {
  IMarketIndexPort,
  IMarketIndexPrice,
  MARKET_INDEX_PORT,
} from './ports/market-index.port';

/** 시장명 → MarketIndex.indexCode */
const INDEX_CODE_BY_MARKET: Record<string, string> = {
  KOSPI: '0001',
  KOSDAQ: '1001',
};

/** AR 윈도우 확보용 달력일 패딩 (거래일 20일 ≈ 28달력일 → 여유 45) */
const DEFAULT_WINDOW_PAD_DAYS = 45;
/** 표본 편입 최소 전향 거래일 (D+20 성숙 요건) */
const DEFAULT_MIN_FORWARD_DAYS = 20;

export interface EventStudyCalcOptions {
  /** 집계 대상 공시 접수일 하한 (YYYYMMDD, 포함). 미지정 시 전체 */
  fromDate?: string;
  /** 집계 대상 공시 접수일 상한 (YYYYMMDD, 포함). 미지정 시 전체 */
  toDate?: string;
  /** 가격 윈도우 패딩(달력일). 기본 45 */
  windowPadDays?: number;
  /** 표본 편입 최소 전향 거래일. 기본 20 (D+20 성숙) */
  minForwardDays?: number;
}

export interface EventStudyCalcSummary {
  eventsScanned: number;
  observationsBuilt: number;
  skipped: {
    noStockOrMarket: number;
    noPrices: number;
    immatureOrUnaligned: number;
  };
  groupsAggregated: number;
  readyCount: number;
  insufficientCount: number;
}

/** DisclosureEvent + 조인 결과의 산출용 슬림 표현 */
export interface EventStudyRawRow {
  eventId: string;
  rcpNo: string;
  corpCode: string;
  stockCode: string;
  market: string; // 'KOSPI' | 'KOSDAQ'
  eventType: string;
  isAmendment: boolean;
  extractedData: unknown;
  rcpDt: string;
}

// ─── 순수 헬퍼 (DB 무관, 단위 테스트 대상) ─────────────────────────

/** YYYYMMDD 에 n일(음수 가능)을 더한 YYYYMMDD */
export function shiftYmd(date: string, n: number): string {
  const y = parseInt(date.slice(0, 4), 10);
  const m = parseInt(date.slice(4, 6), 10) - 1;
  const d = parseInt(date.slice(6, 8), 10);
  const dt = new Date(y, m, d);
  dt.setDate(dt.getDate() + n);
  const yy = dt.getFullYear().toString();
  const mm = (dt.getMonth() + 1).toString().padStart(2, '0');
  const dd = dt.getDate().toString().padStart(2, '0');
  return `${yy}${mm}${dd}`;
}

/**
 * 가격 윈도우로 단일 관측치를 만든다. 표본 부적격이면 null.
 *
 * - D0: calcD0(rcpDt) 이후 종목·시장 양쪽에 모두 존재하는 첫 거래일로 스냅.
 * - 성숙 요건: 종목·시장 모두 D0 이후 minForwardDays 거래일 이상 + 직전 1거래일 이상.
 */
export function buildObservation(
  row: EventStudyRawRow,
  stockWin: IStockDailyPrice[],
  indexWin: IMarketIndexPrice[],
  minForwardDays = DEFAULT_MIN_FORWARD_DAYS,
): EventObservationInput | null {
  if (stockWin.length === 0 || indexWin.length === 0) return null;

  const d0Target = calcD0(row.rcpDt);
  const indexDates = new Set(indexWin.map(p => p.tradeDate));

  // D0 스냅: target 이후 종목·시장 공통 첫 거래일
  let d0Idx = -1;
  for (let i = 0; i < stockWin.length; i++) {
    if (stockWin[i].tradeDate >= d0Target && indexDates.has(stockWin[i].tradeDate)) {
      d0Idx = i;
      break;
    }
  }
  if (d0Idx < 0) return null;

  const d0Date = stockWin[d0Idx].tradeDate;

  // 성숙·정렬 요건: 종목 전향 거래일 + 직전 1거래일
  const stockForward = stockWin.length - 1 - d0Idx;
  if (d0Idx < 1 || stockForward < minForwardDays) return null;

  // 시장도 동일 전향 거래일 확보(미확보 시 AR 후반부가 시장수익률 0으로 왜곡)
  const mD0Idx = indexWin.findIndex(p => p.tradeDate === d0Date);
  if (mD0Idx < 1 || indexWin.length - 1 - mD0Idx < minForwardDays) return null;

  const bucketKey = deriveBucketKeyForEvent(
    row.eventType,
    row.extractedData,
    row.isAmendment,
  );

  const stockPrices: PriceWindow[] = stockWin.map(p => ({
    date: p.tradeDate,
    closePrice: p.closePrice,
  }));
  const marketPrices: PriceWindow[] = indexWin.map(p => ({
    date: p.tradeDate,
    closePrice: p.closeIndex,
  }));
  const volumes: PriceWindow[] = stockWin.map(p => ({
    date: p.tradeDate,
    closePrice: p.volume,
  }));
  // 기준 거래량: D-5~D-1 (없으면 가능한 만큼)
  const baselineVolumes: PriceWindow[] = stockWin
    .slice(Math.max(0, d0Idx - 5), d0Idx)
    .map(p => ({ date: p.tradeDate, closePrice: p.volume }));

  return {
    eventId: row.eventId,
    rcpNo: row.rcpNo,
    corpCode: row.corpCode,
    stockCode: row.stockCode,
    eventType: row.eventType,
    bucketKey,
    d0Date,
    stockPrices,
    marketPrices,
    volumes,
    baselineVolumes,
  };
}

interface ObsGroup {
  eventType: string;
  bucketKey: string;
  marketType: string;
  observations: EventObservationInput[];
}

@Injectable()
export class EventStudyCalculationService {
  private readonly logger = new Logger(EventStudyCalculationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly engine: EventStudyService,
    @Inject(STOCK_PRICE_PORT) private readonly stockPort: IStockPricePort,
    @Inject(MARKET_INDEX_PORT) private readonly indexPort: IMarketIndexPort,
  ) {}

  /**
   * 전체 산출 실행: 적격 공시 이벤트를 모아 버킷별 EventStudyResult 를 upsert 한다.
   */
  async run(options: EventStudyCalcOptions = {}): Promise<EventStudyCalcSummary> {
    const windowPad = options.windowPadDays ?? DEFAULT_WINDOW_PAD_DAYS;
    const minForward = options.minForwardDays ?? DEFAULT_MIN_FORWARD_DAYS;

    const rows = await this.loadEvents(options);

    const summary: EventStudyCalcSummary = {
      eventsScanned: rows.length,
      observationsBuilt: 0,
      skipped: { noStockOrMarket: 0, noPrices: 0, immatureOrUnaligned: 0 },
      groupsAggregated: 0,
      readyCount: 0,
      insufficientCount: 0,
    };

    // (eventType::marketType::bucketKey) → 관측치 묶음. 시장별 + 'ALL' 동시 적재.
    const groups = new Map<string, ObsGroup>();
    const addToGroup = (marketType: string, obs: EventObservationInput) => {
      const key = `${obs.eventType}::${marketType}::${obs.bucketKey}`;
      let g = groups.get(key);
      if (!g) {
        g = { eventType: obs.eventType, bucketKey: obs.bucketKey, marketType, observations: [] };
        groups.set(key, g);
      }
      g.observations.push(obs);
    };

    for (const row of rows) {
      const indexCode = INDEX_CODE_BY_MARKET[row.market];
      if (!row.stockCode || !indexCode) {
        summary.skipped.noStockOrMarket++;
        continue;
      }

      const d0Target = calcD0(row.rcpDt);
      const fromDate = shiftYmd(d0Target, -windowPad);
      const toDate = shiftYmd(d0Target, windowPad);

      const [stockWin, indexWin] = await Promise.all([
        this.stockPort.getPriceWindow(row.stockCode, fromDate, toDate),
        this.indexPort.getIndexWindow(indexCode, fromDate, toDate),
      ]);

      if (stockWin.length === 0 || indexWin.length === 0) {
        summary.skipped.noPrices++;
        continue;
      }

      const obs = buildObservation(row, stockWin, indexWin, minForward);
      if (!obs) {
        summary.skipped.immatureOrUnaligned++;
        continue;
      }

      summary.observationsBuilt++;
      addToGroup(row.market, obs); // KOSPI / KOSDAQ
      addToGroup('ALL', obs); // 시장 미상 폴백·교차시장 풀링
    }

    for (const g of groups.values()) {
      const dates = g.observations.map(o => o.d0Date).sort();
      const agg = this.engine.aggregate({
        eventType: g.eventType,
        bucketKey: g.bucketKey,
        marketType: g.marketType,
        observations: g.observations,
        dataFromDate: dates[0],
        dataToDate: dates[dates.length - 1],
      });
      await this.persist(agg);
      summary.groupsAggregated++;
      if (agg.status === 'READY') summary.readyCount++;
      else summary.insufficientCount++;
    }

    this.logger.log(
      `Event Study 산출 완료: scanned=${summary.eventsScanned} obs=${summary.observationsBuilt} ` +
        `groups=${summary.groupsAggregated} ready=${summary.readyCount} insufficient=${summary.insufficientCount}`,
    );
    return summary;
  }

  /**
   * 적격 DisclosureEvent 적재.
   * - extractionStatus=SUCCESS (추출 완료된 이벤트만)
   * - 상장 종목(stockCode·market 존재)만 — 가격 윈도우 필수
   * - 백필·실데이터 **모두 포함** (isBackfill 미필터): Event Study 는 baseline 전체 사용
   */
  private async loadEvents(options: EventStudyCalcOptions): Promise<EventStudyRawRow[]> {
    const { fromDate, toDate } = options;
    const events = await this.prisma.disclosureEvent.findMany({
      where: {
        extractionStatus: 'SUCCESS',
        company: { stockCode: { not: null }, market: { not: null } },
      },
      select: {
        id: true,
        rcpNo: true,
        corpCode: true,
        eventType: true,
        isAmendment: true,
        extractedData: true,
        company: { select: { stockCode: true, market: true } },
        disclosure: { select: { rcpDt: true } },
      },
    });

    const result: EventStudyRawRow[] = [];
    for (const e of events) {
      const rcpDt = e.disclosure?.rcpDt;
      if (!rcpDt) continue;
      const ymd = rcpDt.slice(0, 8);
      if (fromDate && ymd < fromDate) continue;
      if (toDate && ymd > toDate) continue;
      result.push({
        eventId: e.id,
        rcpNo: e.rcpNo,
        corpCode: e.corpCode,
        stockCode: e.company!.stockCode!,
        market: e.company!.market!,
        eventType: e.eventType,
        isAmendment: e.isAmendment,
        extractedData: e.extractedData,
        rcpDt,
      });
    }
    return result;
  }

  /** AggregatedResult → EventStudyResult upsert (자연키 eventType+bucketKey+marketType) */
  private async persist(agg: AggregatedResult): Promise<void> {
    const data = {
      sampleCount: agg.sampleCount,
      isSignificant: agg.isSignificant,
      tStatistic: agg.tStatistic,
      pValue: agg.pValue,
      variance: agg.variance,
      avgReturnD1: agg.avgReturnD1,
      avgReturnD3: agg.avgReturnD3,
      avgReturnD5: agg.avgReturnD5,
      avgReturnD20: agg.avgReturnD20,
      avgArD1: agg.avgArD1,
      avgArD3: agg.avgArD3,
      avgArD5: agg.avgArD5,
      avgArD20: agg.avgArD20,
      upProbD5: agg.upProbD5,
      crashProbD5: agg.crashProbD5,
      avgMaxDrawdown: agg.avgMaxDrawdown,
      avgVolumeRatioD1: agg.avgVolumeRatioD1,
      avgVolumeRatioD3: agg.avgVolumeRatioD3,
      dataFromDate: agg.dataFromDate,
      dataToDate: agg.dataToDate,
      status: agg.status,
      calculatedAt: new Date(),
    };

    await this.prisma.eventStudyResult.upsert({
      where: {
        eventType_bucketKey_marketType: {
          eventType: agg.eventType,
          bucketKey: agg.bucketKey,
          marketType: agg.marketType,
        },
      },
      create: {
        eventType: agg.eventType,
        bucketKey: agg.bucketKey,
        marketType: agg.marketType,
        ...data,
      },
      update: data,
    });
  }
}
