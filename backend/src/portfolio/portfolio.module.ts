import { Module } from '@nestjs/common';
import { PortfolioController } from './portfolio.controller';
import { PortfolioService } from './portfolio.service';
import { PositionThesisController } from './position-thesis.controller';
import { PositionThesisService } from './position-thesis.service';

@Module({
  controllers: [PortfolioController, PositionThesisController],
  providers: [PortfolioService, PositionThesisService],
  exports: [PortfolioService, PositionThesisService],
})
export class PortfolioModule {}
