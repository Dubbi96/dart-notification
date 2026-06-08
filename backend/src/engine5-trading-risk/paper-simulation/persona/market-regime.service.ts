/**
 * MarketRegimeService — 현재 장(시장 레짐) 산출 (DAR-130, P-D)
 *
 * DB에 적재된 시장지수(MarketIndex, KOSPI)와 최근 공시 이벤트 극성(DisclosureEvent.polarity)을
 * 읽어 순수 Rule(market-regime.ts)로 추세·변동성·이벤트분포 레짐을 분류한다.
 *
 * ★ read-only — 신규 수집·체결·AI 0. 데이터 결측 시 graceful(빈 표본 → dataLimited=true).
 * 분류 로직 자체는 결정론적 순수 함수(detectMarketRegime)에 위임 → 단위 테스트로 검증.
 */

import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import {
  detectMarketRegime,
  EventPolarityCounts,
  MarketRegime,
} from './market-regime';

@Injectable()
export class MarketRegimeService {
  private readonly logger = new Logger(MarketRegimeService.name);

  /** KOSPI 지수코드(MarketIndex.indexCode). */
  static readonly KOSPI_INDEX_CODE = '0001';
  /** 레짐 분류 지수 윈도(최근 거래일 수). 유의 표본(30) 이상 확보 목표. */
  static readonly INDEX_WINDOW = 40;
  /** 이벤트 극성 집계 윈도(최근 거래일 수, tradeDate 문자열 정렬 기준 근사). */
  static readonly EVENT_WINDOW_DAYS = 30;

  constructor(private readonly prisma: PrismaService) {}

  /** 현재 시장 레짐 — 지수 시계열 + 공시 극성 분포 기반 결정론적 분류. */
  async getCurrentRegime(): Promise<MarketRegime> {
    const indexCloses = await this.loadIndexCloses();
    const eventPolarity = await this.loadEventPolarity();
    const asOf = await this.latestIndexDate();
    return detectMarketRegime({ indexCloses, eventPolarity, asOf });
  }

  /** 최근 KOSPI 종가 시계열(오름차순). 결측이면 빈 배열. */
  private async loadIndexCloses(): Promise<number[]> {
    try {
      const rows = await this.prisma.marketIndex.findMany({
        where: { indexCode: MarketRegimeService.KOSPI_INDEX_CODE },
        orderBy: { tradeDate: 'desc' },
        take: MarketRegimeService.INDEX_WINDOW,
        select: { closeIndex: true },
      });
      // desc 조회 → 오름차순(과거→현재)으로 뒤집어 반환.
      return rows.map((r) => r.closeIndex).reverse();
    } catch (e) {
      this.logger.warn(`[Regime] 지수 조회 실패: ${(e as Error).message}`);
      return [];
    }
  }

  /** 최근 공시 이벤트 극성 분포. 결측이면 모두 0. */
  private async loadEventPolarity(): Promise<EventPolarityCounts> {
    const empty: EventPolarityCounts = {
      positive: 0,
      negative: 0,
      mixed: 0,
      unknown: 0,
    };
    try {
      const cutoff = this.eventCutoffDate();
      const grouped = await this.prisma.disclosureEvent.groupBy({
        by: ['polarity'],
        where: { extractedAt: { gte: cutoff } },
        _count: true,
      });
      const counts = { ...empty };
      for (const g of grouped) {
        const n = g._count;
        switch (g.polarity) {
          case 'POSITIVE':
            counts.positive += n;
            break;
          case 'NEGATIVE':
            counts.negative += n;
            break;
          case 'MIXED':
            counts.mixed += n;
            break;
          default:
            counts.unknown += n;
            break;
        }
      }
      return counts;
    } catch (e) {
      this.logger.warn(`[Regime] 이벤트 극성 조회 실패: ${(e as Error).message}`);
      return empty;
    }
  }

  /** 이벤트 집계 시작 시각 — 현재 기준 EVENT_WINDOW_DAYS 일 전. */
  private eventCutoffDate(): Date {
    const d = new Date();
    d.setDate(d.getDate() - MarketRegimeService.EVENT_WINDOW_DAYS);
    return d;
  }

  /** 가장 최근 지수 거래일(YYYYMMDD). 결측이면 null. */
  private async latestIndexDate(): Promise<string | null> {
    try {
      const row = await this.prisma.marketIndex.findFirst({
        where: { indexCode: MarketRegimeService.KOSPI_INDEX_CODE },
        orderBy: { tradeDate: 'desc' },
        select: { tradeDate: true },
      });
      return row?.tradeDate ?? null;
    } catch {
      return null;
    }
  }
}
