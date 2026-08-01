import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';

import { PrismaModule } from '../../prisma/prisma.module';
import { TradingRiskModule } from '../../engine5-trading-risk/trading-risk.module';
import { AosExecutionModule } from '../execution/aos-execution.module';
import { StrategyVersionActivationService } from '../strategy-management/services/strategy-version-activation.service';
import { AosAllocationModule } from '../allocation/aos-allocation.module';
import { AosOperatorController } from './aos-operator.controller';
import { OperatorAccessGuard } from './guards/operator-access.guard';
import { OperatorStepUpGuard } from './guards/operator-step-up.guard';
import { AosOperatorCommandService } from './services/aos-operator-command.service';
import { AosOperatorQueryService } from './services/aos-operator-query.service';
import { AosStepUpService } from './services/aos-step-up.service';

@Module({
  imports: [
    ConfigModule,
    JwtModule.register({}),
    PrismaModule,
    TradingRiskModule,
    AosExecutionModule,
    AosAllocationModule,
  ],
  controllers: [AosOperatorController],
  providers: [
    OperatorAccessGuard,
    OperatorStepUpGuard,
    AosStepUpService,
    AosOperatorQueryService,
    AosOperatorCommandService,
    StrategyVersionActivationService,
  ],
})
export class AosOperatorModule {}
