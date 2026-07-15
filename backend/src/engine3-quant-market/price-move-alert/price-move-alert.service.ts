import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import { KisApiService } from '../market-data/kis-api.service';
import { NotificationProducerService } from '../../notifications/notification-producer.service';
import { formatKstDateCompact, isKstRegularMarketHours } from '../../common/time/kst';
import {
  PRICE_MOVE_THRESHOLD_PCT,
  computeChangePct,
  isPriceMoveTriggered,
  priceMoveRefId,
  naverStockNewsUrl,
  evaluateSectorCoMove,
  buildPriceMoveTitle,
  buildPriceMoveBody,
  PriceMoveFactCheck,
  SectorCoMoveResult,
  MarketStatusFlags,
} from './price-move.domain';

/**
 * PriceMoveAlertService — 갭분석 W7·W6: 관심종목 급변동 감시 + 무공시 변동 브리핑.
 *
 * 장중 5분 틱(스케줄러)마다 WatchList distinct 종목의 현재가(KIS inquire-price)를 조회해
 * 전일 종가(StockDailyPrice) 대비 ±5% 이상이면 NOTIFY 큐로 PRICE_MOVE 알림을 발행한다.
 * 본문에 당일 공시 유무를 병기하고(원인 오귀인 방지), 공시 0건(48h)이면 보유 데이터만으로
 * 팩트체크 근거(시장조치·업종 동반 변동 z-score·시황변동 조회공시)를 병기한다(W6).
 *
 * ★매매 루프 우선(M10 측정 무오염 가드):
 *  - 독립 킬스위치: env PRICE_MOVE_ALERT_ENABLED=false 로 이 알림 폴링만 차단 가능.
 *  - 배치 상한(기본 20종목/틱) + 초과분 다음 틱 이월 — 모의매매 틱과 KIS 유량 경합 최소화.
 *  - 순차 호출(병렬 burst 없음) — 기존 KIS 레이트리밋 하드닝(EGW00201 재시도) 인프라 재사용.
 * ★조회·계측·알림 계층 전용 — engine5·체결·Buy Score 코드 무접점, AI 0.
 */

/** 틱 실행 결과(스케줄러 CronRunLog 기록·스펙 검증용). */
export interface PriceMoveTickResult {
  /** 실제 평가가 돌았는지(장외·킬스위치·키 미설정·겹침이면 false — CronRunLog 미기록). */
  ran: boolean;
  /** 미가동 사유(관측용). */
  skipReason?: 'DISABLED' | 'KIS_NOT_CONFIGURED' | 'OFF_HOURS' | 'OVERLAP';
  /** 이번 틱에서 현재가를 조회한 종목 수. */
  scanned: number;
  /** 발화(알림 enqueue)한 종목 수. */
  fired: number;
  /** 배치 상한 초과로 다음 틱으로 이월된 종목 수. */
  carried: number;
}

/** 배치 상한 기본값 — 5분 틱당 KIS 현재가 조회 종목 수(초과분 이월). */
export const PRICE_MOVE_DEFAULT_BATCH_SIZE = 20;

/** 무공시 팩트체크: 업종 피어 실시간 표본 수 상한(발화 시에만 추가 조회 — 저빈도). */
export const SECTOR_PEER_SAMPLE = 8;

/** 시황변동 조회공시 룩백 일수(요구/답변 존재 확인 창). */
export const INQUIRY_LOOKBACK_DAYS = 7;

@Injectable()
export class PriceMoveAlertService {
  private readonly logger = new Logger(PriceMoveAlertService.name);

  /** 틱 겹침 가드(5분 틱이 이전 틱 미완료 시 스킵). */
  private inFlight = false;

  /** 인메모리 1차 쿨다운 — 오늘(KST) 발화한 refId(`<stockCode>-<YYYYMMDD>`) 집합. */
  private readonly firedKeys = new Set<string>();
  /** firedKeys 가 어느 거래일 것인지(날짜 롤오버 시 리셋). */
  private firedTradeDate: string | null = null;

  /** 배치 상한 초과분 이월 큐(stockCode) — 다음 틱 우선 처리. */
  private carryover: string[] = [];

  constructor(
    private readonly prisma: PrismaService,
    private readonly kis: KisApiService,
    private readonly producer: NotificationProducerService,
    private readonly config: ConfigService,
  ) {}

  /** 독립 킬스위치 — env PRICE_MOVE_ALERT_ENABLED=false|0|off 면 알림 폴링만 차단. */
  get isEnabled(): boolean {
    const raw = this.config.get<string>('PRICE_MOVE_ALERT_ENABLED');
    if (raw === undefined || raw === null || raw === '') return true;
    return !['false', '0', 'off'].includes(String(raw).trim().toLowerCase());
  }

  /** 틱당 KIS 현재가 조회 상한(env PRICE_MOVE_ALERT_BATCH_SIZE, 기본 20). */
  get batchSize(): number {
    const raw = Number(this.config.get<string>('PRICE_MOVE_ALERT_BATCH_SIZE'));
    return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : PRICE_MOVE_DEFAULT_BATCH_SIZE;
  }

  /**
   * 5분 틱 1회 실행 — 게이트(킬스위치·KIS 키·정규장·겹침) → 유니버스 수집 → 배치 평가 → 발화.
   * @param now 현재 시각(테스트 주입 가능). 미지정 시 실제 시각.
   */
  async runTick(now: Date = new Date()): Promise<PriceMoveTickResult> {
    const skip = (skipReason: PriceMoveTickResult['skipReason']): PriceMoveTickResult => ({
      ran: false,
      skipReason,
      scanned: 0,
      fired: 0,
      carried: this.carryover.length,
    });

    if (!this.isEnabled) return skip('DISABLED');
    if (!this.kis.isConfigured) return skip('KIS_NOT_CONFIGURED');
    // 정규장(평일 09:00~15:30)만 — cron 이 15:55 까지 발화해도 메서드 게이트가 정본
    // (paper-simulation.scheduler 의 장외 스킵 패턴과 동일).
    if (!isKstRegularMarketHours(now)) return skip('OFF_HOURS');
    if (this.inFlight) return skip('OVERLAP');

    this.inFlight = true;
    try {
      return await this.evaluate(now);
    } finally {
      this.inFlight = false;
    }
  }

  private async evaluate(now: Date): Promise<PriceMoveTickResult> {
    const tradeDate = formatKstDateCompact(now);
    this.resetFiredKeysIfDateChanged(tradeDate);

    // 유니버스: WatchList distinct corpCode → 상장(stockCode 보유) 기업만.
    const watched = await this.prisma.watchList.findMany({
      select: { corpCode: true },
      distinct: ['corpCode'],
    });
    const corpCodes = watched.map((w) => w.corpCode);
    if (corpCodes.length === 0) {
      return { ran: true, scanned: 0, fired: 0, carried: 0 };
    }
    const companies = await this.prisma.company.findMany({
      where: { corpCode: { in: corpCodes }, stockCode: { not: null } },
      select: { corpCode: true, corpName: true, stockCode: true },
    });

    // 오늘 이미 발화한 종목 제외 → 이월분 우선 정렬 → 배치 절단(초과분 이월).
    const eligible = companies
      .filter((c) => c.stockCode && !this.firedKeys.has(priceMoveRefId(c.stockCode, tradeDate)))
      .sort((a, b) => (a.stockCode! < b.stockCode! ? -1 : 1));
    const carrySet = new Set(this.carryover);
    const ordered = [
      ...eligible.filter((c) => carrySet.has(c.stockCode!)),
      ...eligible.filter((c) => !carrySet.has(c.stockCode!)),
    ];
    const batch = ordered.slice(0, this.batchSize);
    this.carryover = ordered.slice(this.batchSize).map((c) => c.stockCode!);

    if (batch.length === 0) {
      return { ran: true, scanned: 0, fired: 0, carried: this.carryover.length };
    }

    // 전일 종가 일괄 조회(종목별 오늘 미만 최신 일봉 1행).
    const prevCloseByStock = await this.fetchLatestPrevCloses(
      batch.map((c) => c.stockCode!),
      tradeDate,
    );

    let scanned = 0;
    let fired = 0;
    for (const company of batch) {
      const stockCode = company.stockCode!;
      const prevClose = prevCloseByStock.get(stockCode);
      if (prevClose === undefined) continue; // 일봉 미보유 — 판정 불가(정직 스킵).

      // 순차 호출 — KIS 유량 경합 최소화(매매 루프 우선). 실패는 null(graceful) 로 스킵.
      const quote = await this.kis.fetchCurrentPrice(stockCode);
      scanned += 1;
      if (!quote || quote.price <= 0) continue;

      const changePct = computeChangePct(quote.price, prevClose);
      if (!isPriceMoveTriggered(changePct, PRICE_MOVE_THRESHOLD_PCT)) continue;

      const refId = priceMoveRefId(stockCode, tradeDate);
      if (this.firedKeys.has(refId)) continue; // 인메모리 쿨다운(종목당 1일 1회).

      const fact = await this.buildFactCheck(company.corpCode, stockCode, tradeDate, changePct!, now);
      const title = buildPriceMoveTitle(company.corpName, changePct!);
      const body = buildPriceMoveBody(changePct!, fact);

      await this.producer.enqueuePriceMove({
        refId,
        corpCode: company.corpCode,
        stockCode,
        corpName: company.corpName,
        tradeDate,
        changePct: changePct!,
        price: quote.price,
        prevClose,
        title,
        body,
        deepLink: `/company/${company.corpCode}`,
        newsUrl: naverStockNewsUrl(stockCode),
      });
      this.firedKeys.add(refId);
      fired += 1;
      this.logger.log(
        `[PriceMove] 발화 ${stockCode}(${company.corpName}) ${changePct!.toFixed(2)}% ` +
          `(현재 ${quote.price} / 전일 ${prevClose}) 공시오늘=${fact.disclosureCountToday}건`,
      );
    }

    return { ran: true, scanned, fired, carried: this.carryover.length };
  }

  /**
   * 팩트체크 컨텍스트(W7 공시 병기 + W6 무공시 근거) — 발화 확정 종목에만 조회(저빈도).
   *  - 오늘 공시 N건 / 48h 공시 유무: engine1 Disclosure(백필 제외) — rcpDt 는 YYYYMMDD(+HHmmss)
   *    문자열이라 사전식 비교가 시간 순서와 일치한다.
   *  - 무공시(48h 0건)일 때만: (a) StockStatusDaily 시장조치 (b) 업종 동반 변동 z-score
   *    (c) 시황변동 조회공시(요구/답변) 존재 — 전부 기보유 데이터(신규 수집 0).
   */
  private async buildFactCheck(
    corpCode: string,
    stockCode: string,
    tradeDate: string,
    changePct: number,
    now: Date,
  ): Promise<PriceMoveFactCheck> {
    const disclosureCountToday = await this.prisma.disclosure.count({
      where: { corpCode, isBackfill: false, rcpDt: { startsWith: tradeDate } },
    });

    const from48h = formatKstDateCompact(new Date(now.getTime() - 48 * 3600 * 1000));
    const count48h =
      disclosureCountToday > 0
        ? disclosureCountToday
        : await this.prisma.disclosure.count({
            where: { corpCode, isBackfill: false, rcpDt: { gte: from48h } },
          });
    const hasDisclosure48h = count48h > 0;

    if (hasDisclosure48h) {
      return {
        disclosureCountToday,
        hasDisclosure48h,
        status: null,
        sector: null,
        hasInquiryDisclosure: false,
      };
    }

    // ── 무공시 변동 브리핑(W6) — 팩트체크 근거 수집 ──────────────────────────
    const [status, sector, hasInquiryDisclosure] = await Promise.all([
      this.fetchMarketStatus(stockCode),
      this.evaluateSector(corpCode, stockCode, tradeDate, changePct),
      this.hasRecentInquiryDisclosure(corpCode, now),
    ]);

    return { disclosureCountToday, hasDisclosure48h, status, sector, hasInquiryDisclosure };
  }

  /** (a) KRX/DART 종목상태 최신 스냅샷 — 투자주의·이상급등·거래정지 플래그. */
  private async fetchMarketStatus(stockCode: string): Promise<MarketStatusFlags | null> {
    const row = await this.prisma.stockStatusDaily.findFirst({
      where: { stockCode },
      orderBy: { tradeDate: 'desc' },
      select: {
        isTradingSuspended: true,
        isInvestmentCaution: true,
        isAbnormalSurge: true,
      },
    });
    return row ?? null;
  }

  /**
   * (b) 업종 동반 변동 — CompanyOverview.industryCode 동종 피어 표본(≤8)의 당일 등락률로
   * cross-sectional z-score 를 계산한다. 피어 현재가는 KIS 순차 조회(발화 시에만 — 저빈도),
   * 전일 종가는 축적 일봉(StockDailyPrice). 표본 부족이면 null(정직 보류 — 과잉 라벨 방지).
   */
  private async evaluateSector(
    corpCode: string,
    stockCode: string,
    tradeDate: string,
    targetChangePct: number,
  ): Promise<SectorCoMoveResult | null> {
    const overview = await this.prisma.companyOverview.findUnique({
      where: { corpCode },
      select: { industryCode: true },
    });
    if (!overview?.industryCode) return null;

    const peerOverviews = await this.prisma.companyOverview.findMany({
      where: { industryCode: overview.industryCode, corpCode: { not: corpCode } },
      select: { corpCode: true },
      take: 40, // stockCode 결측 대비 여유 표본
    });
    if (peerOverviews.length === 0) return null;

    const peerCompanies = await this.prisma.company.findMany({
      where: {
        corpCode: { in: peerOverviews.map((p) => p.corpCode) },
        stockCode: { not: null },
      },
      select: { stockCode: true },
      take: SECTOR_PEER_SAMPLE,
    });
    const peerCodes = peerCompanies
      .map((p) => p.stockCode!)
      .filter((code) => code !== stockCode);
    if (peerCodes.length === 0) return null;

    const prevCloses = await this.fetchLatestPrevCloses(peerCodes, tradeDate);
    const peerChangePcts: number[] = [];
    for (const code of peerCodes) {
      const prevClose = prevCloses.get(code);
      if (prevClose === undefined) continue;
      const quote = await this.kis.fetchCurrentPrice(code); // 순차 — 유량 보호
      if (!quote || quote.price <= 0) continue;
      const pct = computeChangePct(quote.price, prevClose);
      if (pct !== null) peerChangePcts.push(pct);
    }

    return evaluateSectorCoMove(targetChangePct, peerChangePcts);
  }

  /** (c) 시황변동 조회공시(요구/답변) — 최근 7일 내 reportName '조회공시' 포함 공시 존재 여부. */
  private async hasRecentInquiryDisclosure(corpCode: string, now: Date): Promise<boolean> {
    const from = formatKstDateCompact(
      new Date(now.getTime() - INQUIRY_LOOKBACK_DAYS * 24 * 3600 * 1000),
    );
    const found = await this.prisma.disclosure.findFirst({
      where: { corpCode, rcpDt: { gte: from }, reportName: { contains: '조회공시' } },
      select: { rcpNo: true },
    });
    return Boolean(found);
  }

  /** 종목별 '오늘 미만 최신 일봉 종가' 일괄 조회 — groupBy(max tradeDate) → 해당 행 fetch. */
  private async fetchLatestPrevCloses(
    stockCodes: string[],
    tradeDate: string,
  ): Promise<Map<string, number>> {
    const result = new Map<string, number>();
    if (stockCodes.length === 0) return result;

    const grouped = await this.prisma.stockDailyPrice.groupBy({
      by: ['stockCode'],
      where: { stockCode: { in: stockCodes }, tradeDate: { lt: tradeDate } },
      _max: { tradeDate: true },
    });
    const pairs = grouped
      .filter((g) => g._max.tradeDate)
      .map((g) => ({ stockCode: g.stockCode, tradeDate: g._max.tradeDate! }));
    if (pairs.length === 0) return result;

    const rows = await this.prisma.stockDailyPrice.findMany({
      where: { OR: pairs },
      select: { stockCode: true, closePrice: true },
    });
    for (const row of rows) {
      if (row.closePrice > 0) result.set(row.stockCode, row.closePrice);
    }
    return result;
  }

  /** 날짜 롤오버 시 인메모리 쿨다운 리셋(전일 발화 키가 오늘을 막지 않도록). */
  private resetFiredKeysIfDateChanged(tradeDate: string): void {
    if (this.firedTradeDate !== tradeDate) {
      this.firedKeys.clear();
      this.firedTradeDate = tradeDate;
    }
  }
}
