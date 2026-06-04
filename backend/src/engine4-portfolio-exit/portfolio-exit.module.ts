/**
 * PortfolioExitModule — Engine 4 Position Thesis 엔진 (M7, DAR-11)
 *
 * AI 금지영역: Thesis 생성·평가는 순수 Rule 기반. AI 개입 절대 금지.
 * 설계: docs/roadmap/phase-07-position-thesis.md
 */

import { Module } from '@nestjs/common';
import { PositionThesisService } from './services/position-thesis.service';
import { InMemoryPositionThesisRepository } from './repositories/in-memory-position-thesis.repository';

@Module({
  providers: [PositionThesisService, InMemoryPositionThesisRepository],
  exports: [PositionThesisService, InMemoryPositionThesisRepository],
})
export class PortfolioExitModule {}
