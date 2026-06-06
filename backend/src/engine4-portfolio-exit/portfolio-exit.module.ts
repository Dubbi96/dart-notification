/**
 * PortfolioExitModule — Engine 4 Portfolio & Exit 엔진 (M7~M8, DAR-11~12, DAR-34)
 *
 * AI 금지영역: Thesis 생성·평가·Exit Score·트리거·5액션은 순수 Rule 기반. AI 개입 절대 금지.
 * 설계: docs/roadmap/phase-07-position-thesis.md, phase-08-portfolio-exit.md
 *
 * 영속화(DAR-34): 리포지토리 provider를 InMemory* → Prisma* 로 교체.
 *   - POSITION_THESIS_REPOSITORY → PrismaPositionThesisRepository
 *   - EXIT_SIGNAL_REPOSITORY      → PrismaExitSignalRepository
 * InMemory 구현체는 삭제하지 않고 폴백·테스트용으로 provider에 유지한다.
 */

import { Module } from '@nestjs/common';
import { PositionThesisService } from './services/position-thesis.service';
import { POSITION_THESIS_REPOSITORY } from './repositories/position-thesis.repository';
import { EXIT_SIGNAL_REPOSITORY } from './repositories/exit-signal.repository';
import { PrismaPositionThesisRepository } from './repositories/prisma-position-thesis.repository';
import { PrismaExitSignalRepository } from './repositories/prisma-exit-signal.repository';
import { InMemoryPositionThesisRepository } from './repositories/in-memory-position-thesis.repository';
import { InMemoryExitSignalRepository } from './repositories/in-memory-exit-signal.repository';
import { ExitEngineService } from './services/exit-engine.service';
import { PrismaModule } from '../prisma/prisma.module';
import { PortfolioController } from './portfolio/portfolio.controller';
import { PortfolioService } from './portfolio/portfolio.service';
import { PositionThesisController } from './portfolio/position-thesis.controller';
import { PositionThesisService as PortfolioPositionThesisService } from './portfolio/position-thesis.service';
import { NotificationProducerModule } from '../notifications/notification-producer.module';

@Module({
  imports: [PrismaModule, NotificationProducerModule],
  controllers: [PortfolioController, PositionThesisController],
  providers: [
    PositionThesisService,
    // 영속화 어댑터 — DI 토큰을 Prisma 구현체로 바인딩 (InMemory → Prisma 교체)
    { provide: POSITION_THESIS_REPOSITORY, useClass: PrismaPositionThesisRepository },
    { provide: EXIT_SIGNAL_REPOSITORY, useClass: PrismaExitSignalRepository },
    // 폴백·테스트용 인메모리 구현체 유지 (삭제 금지)
    InMemoryPositionThesisRepository,
    InMemoryExitSignalRepository,
    ExitEngineService,
    PortfolioService,
    PortfolioPositionThesisService,
  ],
  exports: [
    PositionThesisService,
    POSITION_THESIS_REPOSITORY,
    EXIT_SIGNAL_REPOSITORY,
    InMemoryPositionThesisRepository,
    InMemoryExitSignalRepository,
    ExitEngineService,
  ],
})
export class PortfolioExitModule {}
