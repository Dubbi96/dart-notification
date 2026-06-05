import { Injectable } from '@nestjs/common';
import { calcAllIndicators } from './indicators';
import {
  InMemoryStockPriceRepository,
  InMemoryTechnicalIndicatorRepository,
  StoredIndicator,
} from './in-memory-indicator.repository';

export interface BatchItem {
  stockCode: string;
  corpCode: string;
  tradeDate: string;
  historyFrom: string;
  historyTo: string;
  disclosureIdx?: number;
}

/**
 * 기술지표 배치 계산 서비스.
 * 인메모리 포트를 통해 시세 조회 → 순수 함수 계산 → 저장.
 * KRX/DB 어댑터로 교체 가능한 포트 구조.
 */
@Injectable()
export class IndicatorBatchService {
  constructor(
    private readonly priceRepo: InMemoryStockPriceRepository,
    private readonly indicatorRepo: InMemoryTechnicalIndicatorRepository,
  ) {}

  async computeAndSave(item: BatchItem): Promise<StoredIndicator> {
    const candles = await this.priceRepo.findByStockCodeAndDateRange(
      item.stockCode,
      item.historyFrom,
      item.historyTo,
    );

    const allIndicators = calcAllIndicators(
      candles,
      item.disclosureIdx ?? null,
    );

    const stored: StoredIndicator = {
      stockCode: item.stockCode,
      corpCode: item.corpCode,
      tradeDate: item.tradeDate,
      ...allIndicators,
    };

    await this.indicatorRepo.save(stored);
    return stored;
  }

  async computeBatch(items: BatchItem[]): Promise<StoredIndicator[]> {
    return Promise.all(items.map((item) => this.computeAndSave(item)));
  }
}
