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
 * ★TB-2(2026-07-03): 표본 = rcpDt 기간(from/to, 기본 최근 12개월) 내
 *   (rcpNo,eventType) dedup + 월별 층화 — persona 4배 유사복제·최근 쏠림 편향 교정.
 */
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { calcAR, PriceWindow } from '../event-study/utils/abnormal-return';
import { calcD0 } from '../event-study/utils/d0-calculator';
import {
  buildSignalAccuracyReport,
  dedupByDisclosureEvent,
  defaultAccuracyWindow,
  stratifySampleByMonth,
  SignalAccuracyReport,
  SignalRealizedReturn,
} from './signal-accuracy';
import { buildCalibrationReport, CalibrationReport } from './calibration';
import {
  buildFeatureAbReport,
  FeatureAbInput,
  FeatureAbReport,
  ScoreBreakdownLike,
} from './signal-feature-ab';

const KOSPI_CODE = '0001';
const KOSDAQ_CODE = '1001';

/** D+5 산출에 필요한 최소 가격 포인트(D0..D+5 = 6개) */
const MIN_POINTS_D5 = 6;
/** D+20 산출에 필요한 최소 가격 포인트(D0..D+20 = 21개) */
const MIN_POINTS_D20 = 21;

/** 가격 윈도우 조회 종료일 여유(D0 + 이 일수). D+20 거래일 확보용 달력 여유. */
const WINDOW_CALENDAR_DAYS = 45;

/**
 * 층화 전 후보 행 적재 상한(메모리 방어). persona dedup(4행→1행) 전 원행 기준 —
 * limit 최대 5000 × persona 4 = 20000 이면 표본 상한을 온전히 커버한다.
 * (기간 내 후보가 이를 넘으면 rcpNo 오름차순 앞쪽부터 절단 — 결정론 유지.)
 */
const MAX_CANDIDATE_ROWS = 20000;

export interface SignalAccuracyParams {
  /** 층화 표본 상한 — (rcpNo,eventType) dedup 후 기준. 과도한 조회 방지 기본값 1000. */
  limit?: number;
  /** 특정 eventType 만 필터(선택) */
  eventType?: string;
  /** 특정 signalGrade 만 필터(선택) */
  signalGrade?: string;
  /** 집계 기간 하한 — 공시 접수일 rcpDt YYYYMMDD(포함). 미지정/무효 시 기본(최근 12개월) (TB-2) */
  from?: string;
  /** 집계 기간 상한 — 공시 접수일 rcpDt YYYYMMDD(포함). 미지정/무효 시 오늘(KST) (TB-2) */
  to?: string;
}

@Injectable()
export class SignalAccuracyService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * 신호 사후검증 정밀도 리포트.
   * 가격 데이터로 D+20 까지 실현 가능한(충분히 과거의) 신호만 자연 포함된다.
   *
   * ★TB-2 표본 설계(2026-07-03): 종전 '최신순 take(limit)' 표본은 ① 동일 공시이벤트가
   *   persona 4행으로 복제돼 실현수익이 4배 가중(유사복제), ② 최근 공시일 쏠림(단일 장세
   *   측정) 편향이 있었다. rcpDt 기간 필터(from/to, 기본 최근 12개월) + (rcpNo,eventType)
   *   dedup(대표 = 사전순 첫 persona 행) + 월별 층화(기간 내 접수월 균등 추출)로 교정.
   *   파라미터 미지정 시 새 기본 동작(최근 12개월 층화) — 응답 스키마 불변.
   */
  async getSignalAccuracy(params: SignalAccuracyParams = {}): Promise<SignalAccuracyReport> {
    const limit = Math.min(Math.max(params.limit ?? 1000, 1), 5000);
    const window = this.resolveWindow(params);

    // 정렬 (rcpNo,eventType,persona) ASC — dedup 대표행(첫 행)을 사전순 첫 persona 로
    // 결정론 고정한다(createdAt 최신순의 재실행 비결정성·최근 쏠림 제거).
    const rows = await this.prisma.tradingSignal.findMany({
      where: {
        ...(params.eventType ? { eventType: params.eventType } : {}),
        ...(params.signalGrade ? { signal: params.signalGrade as never } : {}),
        // rcpDt 는 YYYYMMDD[HHmmss] — 종일 포함 위해 상한에 999999 부가(백필 경로와 동일 규약).
        disclosure: { rcpDt: { gte: window.from, lte: `${window.to}999999` } },
      },
      orderBy: [{ rcpNo: 'asc' }, { eventType: 'asc' }, { persona: 'asc' }],
      take: MAX_CANDIDATE_ROWS,
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

    // ① (rcpNo,eventType) 대표 1행 — persona 유사복제 제거(실현수익은 persona 무관 공통).
    const deduped = dedupByDisclosureEvent(
      rows.map((s) => ({
        rcpNo: s.rcpNo,
        eventType: s.eventType,
        stockCode: s.stockCode,
        buyScore: s.buyScore,
        signal: s.signal,
        rcpDt: s.disclosure?.rcpDt ?? null,
        market: s.company?.market ?? null,
      })),
    );
    // ② 월별 층화 — 기간 내 접수월(YYYYMM) 균등 추출로 limit 표본 구성.
    const sampled = stratifySampleByMonth(deduped, limit);

    const returns: SignalRealizedReturn[] = [];
    for (const s of sampled) {
      const realized = await this.computeRealizedReturn(
        s.stockCode,
        s.rcpDt,
        s.market,
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
   * from/to 정규화 (TB-2) — YYYYMMDD 8자리만 인정, 무효/미지정은 기본 기간(최근 12개월,
   * KST 오늘 포함) 폴백. 기존 호출부(파라미터 없음)는 자동으로 새 기본 동작을 얻는다.
   */
  private resolveWindow(params: SignalAccuracyParams): { from: string; to: string } {
    const def = defaultAccuracyWindow(new Date());
    const valid = (v?: string): string | null =>
      v && /^\d{8}$/.test(v) ? v : null;
    return {
      from: valid(params.from) ?? def.from,
      to: valid(params.to) ?? def.to,
    };
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
   * 피처 A/B 백테스트 리포트(DAR-101): '성장률/DartFiledFact/내부자 피처 포함 vs 미포함'
   * 두 가중치 구성으로 동일 과거 신호셋을 재채점 → 매수등급 부분집합의 D+5/D+20 적중률·
   * median AR·등급별 정밀도를 비교하고 피처별 delta 로 적중률 기여를 증거화한다.
   * ★ read-only — 저장 scoreBreakdown 을 재정규화 가중치로 재조합할 뿐, 가중치를 변경하지
   *   않는다(휴먼 PR 전용). getSignalAccuracy 와 동일한 실현수익 산식을 재사용한다.
   */
  async getFeatureAbReport(
    params: SignalAccuracyParams = {},
  ): Promise<FeatureAbReport> {
    const limit = Math.min(Math.max(params.limit ?? 1000, 1), 5000);

    const signals = await this.prisma.tradingSignal.findMany({
      where: {
        ...(params.eventType ? { eventType: params.eventType } : {}),
        ...(params.signalGrade ? { signal: params.signalGrade as never } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
      select: {
        stockCode: true,
        eventType: true,
        signal: true,
        riskPenalty: true,
        scoreBreakdown: true,
        disclosure: { select: { rcpDt: true } },
        company: { select: { market: true } },
      },
    });

    const inputs: FeatureAbInput[] = [];
    for (const s of signals) {
      const realized = await this.computeRealizedReturn(
        s.stockCode,
        s.disclosure?.rcpDt ?? null,
        s.company?.market ?? null,
      );
      inputs.push({
        breakdown: coerceBreakdown(s.scoreBreakdown),
        riskPenalty: s.riskPenalty ?? 0,
        originalGrade: s.signal,
        eventType: s.eventType,
        arD5: realized.arD5,
        arD20: realized.arD20,
      });
    }

    return buildFeatureAbReport(inputs);
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

/** 단일 숫자 강제(비유한·비숫자 → 0). 저장 JSON 의 결측/이상치 graceful 처리. */
function num(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

/**
 * 저장된 scoreBreakdown(Json) → 9버킷 ScoreBreakdownLike.
 * 과거(DAR-88/100 이전) 신호는 insider/fundamental 키가 부재 → 0 으로 안전 처리.
 */
function coerceBreakdown(json: unknown): ScoreBreakdownLike {
  const b = (json ?? {}) as Record<string, unknown>;
  return {
    disclosureEvent: num(b.disclosureEvent),
    keyMetric: num(b.keyMetric),
    personaFit: num(b.personaFit),
    historicalEvent: num(b.historicalEvent),
    chart: num(b.chart),
    volumeLiquidity: num(b.volumeLiquidity),
    marketSector: num(b.marketSector),
    insider: num(b.insider),
    fundamental: num(b.fundamental),
  };
}
