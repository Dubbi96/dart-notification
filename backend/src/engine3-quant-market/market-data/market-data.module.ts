import { Module } from '@nestjs/common';
import { MarketDataService } from './market-data.service';
import { StockQuoteService } from './stock-quote.service';
import { CandleHistoryService } from './candle-history.service';
import { KrxApiService } from './krx-api.service';
import { KrxMarketDataScheduler } from './krx-market-data.scheduler';
import { DartStockStatusService } from './dart-stock-status.service';
import { MarketDataController } from './market-data.controller';
import { StockStatusController } from './stock-status.controller';
import { PrismaModule } from '../../prisma/prisma.module';
import { KisApiService } from './kis-api.service';
import { KisRealtimePoller } from './kis-realtime.poller';
import { StockMinutePriceCollector } from './stock-minute-price.collector';
import { KisEtfDailySource } from './kis-etf-daily.source';
import { EtfDailyPriceCollector } from './etf-daily-price.collector';
import { EtfDailyBackfillService } from './etf-daily-backfill.service';
import { KrxInvestorFlowSource } from './krx-investor-flow.source';
import { KisInvestorFlowSource } from './kis-investor-flow.source';
import { InvestorFlowCollector } from './investor-flow.collector';
import { InvestorFlowQueryService } from './investor-flow.query.service';
import { RealtimeQuoteModule } from './realtime-quote.module';

@Module({
  // RealtimeQuoteModule(@Global): RealtimeQuoteCache 단일 인스턴스를 폴러↔모의평가가 공유(DAR-140).
  imports: [PrismaModule, RealtimeQuoteModule],
  controllers: [MarketDataController, StockStatusController],
  providers: [
    MarketDataService,
    StockQuoteService,
    // DAR-378: TimescaleDB 분봉/일봉 구간 조회(하이퍼테이블+연속집계, read-only).
    CandleHistoryService,
    KrxApiService,
    KrxMarketDataScheduler,
    DartStockStatusService,
    // DAR-140: KIS 실시간 어댑터 + 폴러(키 미설정 시 graceful no-op).
    KisApiService,
    KisRealtimePoller,
    // DAR-377: 분봉 forward 축적 수집기(장중 10분 cron, 키 미설정 시 graceful no-op).
    StockMinutePriceCollector,
    // DAR-484: ETF 일봉 소스 어댑터(KIS) + 증분 수집기(EOD 19:10 cron, 키 미설정 시 graceful no-op).
    KisEtfDailySource,
    EtfDailyPriceCollector,
    // DAR-490: ETF 과거 일봉 백필 서비스(수동 러너 전용 — 상시 크론 아님. S3 원본 보관 + 커버리지 리포트).
    EtfDailyBackfillService,
    // 갭분석 W16: 수급·공매도 소스 어댑터(KRX 1차=인터페이스만·KIS 폴백) + EOD 수집기(평일
    //   07:40/20:00/21:30 cron, 소스 미설정 시 graceful no-op) + 조회 서비스(SHADOW — 표면 전용).
    KrxInvestorFlowSource,
    KisInvestorFlowSource,
    InvestorFlowCollector,
    InvestorFlowQueryService,
  ],
  exports: [
    MarketDataService,
    StockQuoteService,
    CandleHistoryService,
    KrxApiService,
    KrxMarketDataScheduler,
    DartStockStatusService,
    KisApiService,
    StockMinutePriceCollector,
    // DAR-484: Wave1 전략(P12~P15)이 ETF 일봉 소스·수집기를 소비.
    KisEtfDailySource,
    EtfDailyPriceCollector,
    // DAR-490: 수동 러너(app.get)가 백필 서비스를 해석할 수 있도록 export.
    EtfDailyBackfillService,
  ],
})
export class MarketDataModule {}
