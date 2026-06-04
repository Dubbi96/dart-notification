/**
 * TradingRiskModule — Engine 5 모의투자 엔진 (M10-A, DAR-16)
 *
 * AI 금지영역: 체결·Risk 로직은 순수 Rule 기반. AI/LLM(engine2) 의존성 절대 금지.
 * 설계: docs/roadmap/phase-12-paper-trading.md
 */

import { Module } from '@nestjs/common';
import { PaperTradeService } from './services/paper-trade.service';
import { InMemoryPaperTradeRepository } from './repositories/in-memory-paper-trade.repository';

@Module({
  providers: [
    InMemoryPaperTradeRepository,
    {
      provide: 'IPaperTradeRepository',
      useClass: InMemoryPaperTradeRepository,
    },
    {
      provide: PaperTradeService,
      useFactory: (repo: InMemoryPaperTradeRepository) => new PaperTradeService(repo),
      inject: [InMemoryPaperTradeRepository],
    },
  ],
  exports: [PaperTradeService, InMemoryPaperTradeRepository],
})
export class TradingRiskModule {}
