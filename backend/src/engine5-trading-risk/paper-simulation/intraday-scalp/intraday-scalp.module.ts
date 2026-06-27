/**
 * IntradayScalpModule — 분봉 단타 모의전략 (DAR-411)
 *
 * AI 금지영역: 진입·청산·체결·리스크는 순수 Rule. engine2/AI import 0.
 *   진입 신호 정의는 engine3(intraday-scalp-signal, 순수 함수) 호출만.
 * RealtimeQuoteCache 는 @Global(MarketDataModule) — @Optional 주입(미설정 시 분봉 종가 폴백).
 */

import { Module } from '@nestjs/common';
import { PrismaModule } from '../../../prisma/prisma.module';
import { MarketDataModule } from '../../../engine3-quant-market/market-data/market-data.module';
import { NotificationProducerModule } from '../../../notifications/notification-producer.module';
import { TradingRiskModule } from '../../trading-risk.module';
import { IntradayScalpService } from './intraday-scalp.service';
import { IntradayScalpController } from './intraday-scalp.controller';
import { IntradayScalpScheduler } from './intraday-scalp.scheduler';

@Module({
  // DAR-424: NotificationProducerModule — 체결 알림(TRADE_ENTRY/TRADE_EXIT) 발행.
  // F5(2026-06-27): TradingRiskModule — 공유 KillSwitchManager 싱글톤 주입(별도 인스턴스 금지:
  //   in-memory 발동 상태가 전파되지 않으면 우회 버그가 재발).
  imports: [PrismaModule, MarketDataModule, NotificationProducerModule, TradingRiskModule],
  controllers: [IntradayScalpController],
  providers: [IntradayScalpService, IntradayScalpScheduler],
  exports: [IntradayScalpService],
})
export class IntradayScalpModule {}
