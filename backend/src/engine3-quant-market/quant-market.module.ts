import { Module } from '@nestjs/common';
import { MarketDataModule } from './market-data/market-data.module';
import { IndicatorsModule } from './indicators/indicators.module';
import { EventStudyModule } from './event-study/event-study.module';
import { BuySignalModule } from './buy-signal/buy-signal.module';
import { MarketDataService } from './market-data/market-data.service';
import { TechnicalIndicatorService } from './indicators/technical-indicator.service';
import { EventStudyService } from './event-study/event-study.service';
import { BuySignalService } from './buy-signal/buy-signal.service';

/**
 * Engine 3 — Quant Market Engine (M4 스캐폴딩).
 * 시세 수집·기술지표·이벤트스터디·매수신호 도메인.
 * 데이터 소스: KRX 데이터마켓플레이스 1차 (Phase 5 M5에서 실제 연동).
 *
 * AI 금지영역: Buy Score 계산·주문 수량·하드룰에 AI 개입 절대 금지.
 * 설계: docs/roadmap/cc-engine-architecture.md §3·§4-5, phase-05
 */
@Module({
  imports: [MarketDataModule, IndicatorsModule, EventStudyModule, BuySignalModule],
  exports: [
    MarketDataService,
    TechnicalIndicatorService,
    EventStudyService,
    BuySignalService,
  ],
})
export class QuantMarketModule {}
