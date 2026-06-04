/**
 * PortfolioExitModule — Engine 4 Portfolio & Exit 엔진 (M7~M8, DAR-11~12)
 *
 * AI 금지영역: Thesis 생성·평가·Exit Score·트리거·5액션은 순수 Rule 기반. AI 개입 절대 금지.
 * 설계: docs/roadmap/phase-07-position-thesis.md, phase-08-portfolio-exit.md
 */

import { Module } from '@nestjs/common';
import { PositionThesisService } from './services/position-thesis.service';
import { InMemoryPositionThesisRepository } from './repositories/in-memory-position-thesis.repository';
import { InMemoryExitSignalRepository } from './repositories/in-memory-exit-signal.repository';
import { ExitEngineService } from './services/exit-engine.service';
import { PrismaModule } from '../prisma/prisma.module';
import { PortfolioController } from './portfolio/portfolio.controller';
import { PortfolioService } from './portfolio/portfolio.service';
import { PositionThesisController } from './portfolio/position-thesis.controller';
import { PositionThesisService as PortfolioPositionThesisService } from './portfolio/position-thesis.service';

@Module({
  imports: [PrismaModule],
  controllers: [PortfolioController, PositionThesisController],
  providers: [
    PositionThesisService,
    InMemoryPositionThesisRepository,
    InMemoryExitSignalRepository,
    ExitEngineService,
    PortfolioService,
    PortfolioPositionThesisService,
  ],
  exports: [
    PositionThesisService,
    InMemoryPositionThesisRepository,
    InMemoryExitSignalRepository,
    ExitEngineService,
  ],
})
export class PortfolioExitModule {}
