import { Injectable } from '@nestjs/common';
import { Candle, AllIndicators } from './indicators';

export interface StoredPrice extends Candle {
  stockCode: string;
  corpCode: string;
}

export interface StoredIndicator extends AllIndicators {
  stockCode: string;
  corpCode: string;
  tradeDate: string;
}

/** 포트 인터페이스 — 시세 저장소 */
export interface IStockPriceRepository {
  findByStockCodeAndDateRange(
    stockCode: string,
    from: string,
    to: string,
  ): Promise<StoredPrice[]>;
  saveMany(prices: StoredPrice[]): Promise<void>;
}

/** 포트 인터페이스 — 기술지표 저장소 */
export interface ITechnicalIndicatorRepository {
  save(indicator: StoredIndicator): Promise<void>;
  findByStockCodeAndDate(
    stockCode: string,
    date: string,
  ): Promise<StoredIndicator | null>;
}

/** 인메모리 시세 저장소 (테스트·로컬 배치용) */
@Injectable()
export class InMemoryStockPriceRepository implements IStockPriceRepository {
  private readonly store = new Map<string, StoredPrice>();

  async findByStockCodeAndDateRange(
    stockCode: string,
    from: string,
    to: string,
  ): Promise<StoredPrice[]> {
    return Array.from(this.store.values())
      .filter((p) => p.stockCode === stockCode && p.date >= from && p.date <= to)
      .sort((a, b) => a.date.localeCompare(b.date));
  }

  async saveMany(prices: StoredPrice[]): Promise<void> {
    for (const p of prices) {
      this.store.set(`${p.stockCode}_${p.date}`, p);
    }
  }

  /** 테스트 헬퍼: 저장된 전체 데이터 반환 */
  getAll(): StoredPrice[] {
    return Array.from(this.store.values());
  }
}

/** 인메모리 기술지표 저장소 (테스트·로컬 배치용) */
@Injectable()
export class InMemoryTechnicalIndicatorRepository
  implements ITechnicalIndicatorRepository
{
  private readonly store = new Map<string, StoredIndicator>();

  async save(indicator: StoredIndicator): Promise<void> {
    this.store.set(`${indicator.stockCode}_${indicator.tradeDate}`, indicator);
  }

  async findByStockCodeAndDate(
    stockCode: string,
    date: string,
  ): Promise<StoredIndicator | null> {
    return this.store.get(`${stockCode}_${date}`) ?? null;
  }

  /** 테스트 헬퍼 */
  getAll(): StoredIndicator[] {
    return Array.from(this.store.values());
  }
}
